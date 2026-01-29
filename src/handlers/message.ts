// Handle incoming Slack messages
import { getOrCreateSession } from '../services/session';
import { executeClaudeStreaming, extractText, type StreamEvent, type ContentBlock } from '../services/claude';
import { postMessage, addReaction, removeReaction, getToolEmoji, MessageUpdater, updateMessage } from '../services/slack';
import { splitForSlack, markdownToSlack, stripSystemReminders } from '../lib/markdown-to-slack';
import { getChannelConfig, isChannelEnabled } from '../services/channel-config';
import { checkRateLimits, recordUsage } from '../services/usage-tracker';
import { classifyRequest, isRequestAllowed, getCategoryDisplayName } from '../middleware/classifier';
import { buildGuardrailedPrompt, validateMessage, buildRejectionMessage, buildRateLimitMessage } from '../services/prompt-builder';
import { getFileWatcher, getPendingFiles, clearPendingFiles } from '../services/file-watcher';
import { uploadFilesToThread, filterAllowedFiles } from '../services/file-uploader';
import { getDesksForMessage, removeDeskMentions } from '../services/desk-router';
import { createDeskManifest } from '../services/session-manifest';
import { downloadMessageFiles, buildFilePrefix, cleanupSessionFiles } from '../services/slack-files';
import type { DeskDefinition, DeskRouteResult } from '../types/desk';
import type { SlackFile } from '../types/slack';

const MAX_SLACK_MESSAGE_LENGTH = 3500;

interface SlackMessage {
  type: string;
  subtype?: string;
  text: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  files?: SlackFile[];
}

/**
 * Handle an incoming Slack message
 */
export async function handleMessage(message: SlackMessage): Promise<void> {
  // Skip bot messages and non-useful subtypes (but allow file_share)
  if (message.bot_id) return;
  if (message.subtype && message.subtype !== 'file_share') return;

  const { channel, text, user, ts, thread_ts } = message;

  // Use thread_ts if in a thread, otherwise use the message ts (starts new thread)
  const threadTs = thread_ts || ts;

  console.log(`[Handler] Message from ${user} in ${channel}: ${text.slice(0, 50)}...`);
  if (message.files?.length) {
    console.log(`[Handler] Message has ${message.files.length} file(s): ${message.files.map(f => `${f.name} (${f.mimetype})`).join(', ')}`);
  }

  // Route to desks based on @mentions
  const deskRoutes = getDesksForMessage(text);
  const hasDesks = deskRoutes.length > 0 && deskRoutes[0].matchedMention !== '';

  if (hasDesks) {
    console.log(`[Handler] Desk routing: ${deskRoutes.map(r => r.desk.slug).join(', ')}`);
  }

  // Check if channel has team mode config
  const channelConfig = getChannelConfig(channel);
  const isTeamMode = isChannelEnabled(channel);

  let messageToSend = text;
  let classificationResult = null;

  // For desk-routed messages, clean the @mentions from the text
  if (hasDesks) {
    messageToSend = removeDeskMentions(text, deskRoutes);
    console.log(`[Handler] Cleaned message: ${messageToSend.slice(0, 50)}...`);
  }

  // Team mode: apply classification, guardrails, and rate limits
  if (isTeamMode) {
    console.log(`[Handler] Team mode active for channel ${channelConfig.channelName}`);

    // Classify the request
    classificationResult = classifyRequest(text);
    console.log(`[Handler] Classified as: ${classificationResult.category} (${(classificationResult.confidence * 100).toFixed(0)}% confidence)`);

    // Check if request type is allowed for this channel
    const allowCheck = isRequestAllowed(classificationResult, channelConfig.capabilities);
    if (!allowCheck.allowed) {
      await postMessage(channel, buildRejectionMessage(allowCheck.reason!), threadTs);
      return;
    }

    // Check rate limits
    const rateCheck = checkRateLimits(user, channel, channelConfig);
    if (!rateCheck.allowed) {
      await postMessage(channel, buildRateLimitMessage(rateCheck.reason!), threadTs);
      return;
    }

    // Validate against blocked patterns
    const validation = validateMessage(text, channelConfig.blockedPatterns || []);
    if (!validation.valid) {
      await postMessage(
        channel,
        buildRejectionMessage(`Request contains blocked patterns: ${validation.violations.join(', ')}`),
        threadTs
      );
      return;
    }

    // Build guardrailed prompt
    messageToSend = buildGuardrailedPrompt({
      channelConfig,
      taskCategory: classificationResult.category,
      userName: user,
      originalMessage: text,
    });

    console.log(`[Handler] Using guardrailed prompt for ${getCategoryDisplayName(classificationResult.category)} task`);
  }

  // Get or create session for this thread
  const { session, isNew } = getOrCreateSession(channel, threadTs, user);
  console.log(`[Handler] Session: ${session.sessionId} (${isNew ? 'new' : 'existing'})`);

  // Download any attached files
  if (message.files && message.files.length > 0) {
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken) {
      console.log(`[Handler] Downloading ${message.files.length} attached file(s)`);
      const { paths, warnings } = await downloadMessageFiles(message.files, session.sessionId, botToken);
      const filePrefix = buildFilePrefix(paths, warnings);
      if (filePrefix) {
        messageToSend = filePrefix + messageToSend;
      }
    }
  }

  // Post initial "thinking" message
  const initialMessage = await postMessage(
    channel,
    ':thinking_face: Processing...',
    threadTs
  );

  // Add thinking reaction to user's message
  await addReaction(channel, ts, 'hourglass_flowing_sand');

  // Create message updater for streaming
  let updater = new MessageUpdater(channel, initialMessage.ts);

  const startTime = Date.now();
  let costUsd = 0;
  let uploadedFileIds: string[] = [];

  // Set up file watcher if auto-upload is enabled for this channel
  const fileWatcher = getFileWatcher();
  if (isTeamMode && channelConfig.autoUploadAssets) {
    clearPendingFiles();
    fileWatcher.setActiveSession(channel, threadTs, session.sessionId);
    console.log('[Handler] File watcher activated for this request');
  }

  // Create session manifest for desk-routed sessions
  const primaryDesk = hasDesks ? deskRoutes[0].desk : null;
  if (primaryDesk && isNew) {
    createDeskManifest(session.sessionId, primaryDesk);
    console.log(`[Handler] Created manifest for desk: ${primaryDesk.slug}`);
  }

  try {
    let currentTurnText = '';
    let turnCount = 0;
    let toolsUsed: Set<string> = new Set();
    let lastEventWasTool = false;
    let currentMsgTs = initialMessage.ts; // Track which message we're updating
    let askedQuestions = false; // Track if AskUserQuestion was posted (dedup across events)

    // Execute Claude and stream responses
    for await (const event of executeClaudeStreaming(messageToSend, {
      resumeId: isNew ? undefined : session.sessionId,
      sessionId: isNew ? session.sessionId : undefined,
      desk: primaryDesk || undefined,
    })) {
      await processStreamEvent(event, updater, initialMessage, channel, toolsUsed);

      // Post tool activity as separate messages in the thread
      if (event.type === 'assistant' && event.message?.content) {
        const content = event.message.content;
        const toolBlocks = content.filter((b: ContentBlock) => b.type === 'tool_use');
        // Only extract text if there are NO tool blocks and we're not waiting for question answers
        const newText = (toolBlocks.length === 0 && !askedQuestions) ? extractText(content) : '';

        console.log(`[Handler] Assistant event: ${toolBlocks.length} tools, ${newText.length} chars text`);

        // Deduplicate AskUserQuestion across the entire stream (not just per-event)
        const uniqueToolBlocks = toolBlocks.filter((b: any) => {
          const name = b.name || 'unknown';
          if (name === 'AskUserQuestion') {
            if (askedQuestions) return false; // Already posted questions — skip duplicate
          }
          return true;
        });

        // Post tool use notifications as individual messages
        for (const tool of uniqueToolBlocks) {
          const toolName = (tool as any).name || 'Tool';
          const emoji = getToolEmoji(toolName);
          const toolInput = (tool as any).input || {};

          // Special handling: AskUserQuestion → render as Slack buttons
          if (toolName === 'AskUserQuestion' && toolInput.questions) {
            const questions = toolInput.questions as Array<{
              question: string;
              header?: string;
              options: Array<{ label: string; description?: string }>;
            }>;

            const allBlocks: any[] = [];
            const questionCount = questions.length;

            for (let qi = 0; qi < questions.length; qi++) {
              const q = questions[qi];

              // Section with the question text
              allBlocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: `*${q.header || `Question ${qi + 1}`}:* ${q.question}` },
              });

              // Buttons for this question — each stores "Q#: answer" as value
              const buttons = q.options.map((opt: { label: string }, oi: number) => ({
                type: 'button',
                text: { type: 'plain_text', text: opt.label, emoji: true },
                action_id: `askq_${qi}_${oi}_${Date.now()}`,
                value: `Q${qi + 1}: ${opt.label}`,
              }));

              allBlocks.push({ type: 'actions', elements: buttons });

              // Add divider between questions
              if (qi < questionCount - 1) {
                allBlocks.push({ type: 'divider' });
              }
            }

            // If multiple questions, add a Submit button
            if (questionCount > 1) {
              allBlocks.push({ type: 'divider' });
              allBlocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: '_Select your answers above, then click Submit._' },
              });
              allBlocks.push({
                type: 'actions',
                elements: [{
                  type: 'button',
                  text: { type: 'plain_text', text: 'Submit Answers', emoji: true },
                  action_id: `ask_submit_${Date.now()}`,
                  value: '__SUBMIT_ANSWERS__',
                  style: 'primary',
                }],
              });
            }

            const client = (await import('../services/slack')).getSlackClient();
            await client.chat.postMessage({
              channel,
              thread_ts: threadTs,
              text: questions.map(q => q.question).join('\n'),
              blocks: allBlocks,
            });
            askedQuestions = true;
            console.log(`[Handler] Posted AskUserQuestion with ${questionCount} question(s)`);
            continue; // Skip normal tool message posting
          }

          // Build a human-friendly description of what the tool is doing
          let toolMsg = '';
          if (toolName === 'Read' && toolInput.file_path) {
            const filename = String(toolInput.file_path).split('/').pop();
            toolMsg = `:${emoji}: Reading \`${filename}\``;
          } else if (toolName === 'Write' && toolInput.file_path) {
            const filename = String(toolInput.file_path).split('/').pop();
            toolMsg = `:${emoji}: Writing \`${filename}\``;
          } else if (toolName === 'Edit' && toolInput.file_path) {
            const filename = String(toolInput.file_path).split('/').pop();
            toolMsg = `:${emoji}: Editing \`${filename}\``;
          } else if (toolName === 'Bash' && toolInput.command) {
            const cmd = String(toolInput.command).slice(0, 60);
            toolMsg = `:${emoji}: Running command...`;
          } else if (toolName === 'Glob' && toolInput.pattern) {
            toolMsg = `:${emoji}: Searching for files matching \`${toolInput.pattern}\``;
          } else if (toolName === 'Grep' && toolInput.pattern) {
            toolMsg = `:${emoji}: Searching code for \`${toolInput.pattern}\``;
          } else if (toolName === 'WebSearch' && toolInput.query) {
            toolMsg = `:${emoji}: Searching the web for "${toolInput.query}"`;
          } else if (toolName === 'WebFetch' && toolInput.url) {
            toolMsg = `:${emoji}: Fetching web page...`;
          } else if (toolName === 'Task') {
            toolMsg = `:${emoji}: ${toolInput.description || 'Running subtask...'}`;
          } else {
            toolMsg = `:${emoji}: Using ${toolName}...`;
          }
          await postMessage(channel, toolMsg, threadTs, true);
          console.log(`[Handler] Posted tool activity: ${toolMsg.slice(0, 60)}`);
        }

        if (newText) {
          // If we had tool use before this text and have previous text, post it
          if (lastEventWasTool && currentTurnText) {
            const prevProcessed = markdownToSlack(stripSystemReminders(currentTurnText));
            await postMessage(channel, prevProcessed, threadTs, true);
            turnCount++;
            currentTurnText = '';
          }

          lastEventWasTool = false;
          currentTurnText = newText; // Accumulate — only posted at end or next boundary
        }

        if (toolBlocks.length > 0) {
          lastEventWasTool = true;
        }
      }

      // Track tool results as boundaries too
      if (event.type === 'user') {
        lastEventWasTool = true;
      }

      // Capture cost and final text from result event
      if (event.type === 'result') {
        if (event.cost_usd) costUsd = event.cost_usd;
        // The result event contains the final response text
        if (event.result && !currentTurnText) {
          currentTurnText = event.result;
          console.log(`[Handler] Got final text from result event (${currentTurnText.length} chars)`);
        }
      }
    }

    // Finalize: update processing message to done, post final response as new message
    const finalText = currentTurnText || updater.getText();

    if (askedQuestions) {
      // Waiting for user to answer questions — don't finalize
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      await updateMessage(channel, initialMessage.ts, `:hourglass: Waiting for your answers... (${duration}s)`, true);
      await removeReaction(channel, ts, 'hourglass_flowing_sand');
      await addReaction(channel, ts, 'question');
      console.log(`[Handler] Finalize skipped — waiting for question answers`);
    } else {
      // Normal completion
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      await updateMessage(channel, initialMessage.ts, `:white_check_mark: Completed in ${duration}s`, true);

      console.log(`[Handler] Finalize: finalText=${finalText?.length || 0} chars, turns=${turnCount}`);

      if (!finalText) {
        console.log('[Handler] No final text — tools may have handled everything');
      } else {
        const processedText = markdownToSlack(stripSystemReminders(finalText));

        if (processedText.length > MAX_SLACK_MESSAGE_LENGTH) {
          console.log(`[Handler] Response too long (${processedText.length} chars), splitting into multiple messages`);
          const chunks = splitForSlack(processedText, MAX_SLACK_MESSAGE_LENGTH);

          for (const chunk of chunks) {
            await postMessage(channel, chunk, threadTs, true);
          }
        } else {
          await postMessage(channel, processedText, threadTs, true);
        }
      }

      // Remove thinking reaction, add checkmark
      await removeReaction(channel, ts, 'hourglass_flowing_sand');
      await addReaction(channel, ts, 'white_check_mark');
    }

    // Upload any files generated during execution
    if (isTeamMode && channelConfig.autoUploadAssets) {
      fileWatcher.clearActiveSession();

      // Small delay to catch any final file writes
      await new Promise((resolve) => setTimeout(resolve, 200));

      const pendingFiles = getPendingFiles();
      if (pendingFiles.length > 0) {
        console.log(`[Handler] Found ${pendingFiles.length} files to upload`);

        // Filter by allowed types
        const { allowed, rejected } = filterAllowedFiles(pendingFiles, channelConfig);
        if (rejected.length > 0) {
          console.log(`[Handler] Rejected ${rejected.length} files (type/size restrictions)`);
        }

        if (allowed.length > 0) {
          // Add uploading indicator
          await addReaction(channel, initialMessage.ts, 'file_folder');

          const results = await uploadFilesToThread(allowed, channelConfig);

          // Collect successful file IDs
          for (const [fileId, result] of results) {
            if (result.success && result.slackFileId) {
              uploadedFileIds.push(result.slackFileId);
            }
          }

          await removeReaction(channel, initialMessage.ts, 'file_folder');
        }
      }
    }

    // Record usage for team mode
    if (isTeamMode && classificationResult) {
      recordUsage({
        userId: user,
        channelId: channel,
        timestamp: new Date().toISOString(),
        category: classificationResult.category,
        tokensUsed: 0, // TODO: extract from Claude response if available
        costUsd,
        sessionId: session.sessionId,
        filesUploaded: uploadedFileIds,
        duration: Date.now() - startTime,
      });
      console.log(`[Handler] Usage recorded: $${costUsd.toFixed(4)}, ${Date.now() - startTime}ms, ${uploadedFileIds.length} files`);
    }

  } catch (error) {
    console.error('[Handler] Error:', error);

    // Update message with error
    updater.setText(`:x: Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    await updater.flush();

    // Remove thinking reaction, add error reaction
    await removeReaction(channel, ts, 'hourglass_flowing_sand');
    await addReaction(channel, ts, 'x');

  } finally {
    updater.cleanup();
    // Always clear file watcher session
    if (isTeamMode && channelConfig.autoUploadAssets) {
      fileWatcher.clearActiveSession();
      clearPendingFiles();
    }
  }
}

/**
 * Process a stream event
 */
async function processStreamEvent(
  event: StreamEvent,
  updater: MessageUpdater,
  responseMessage: { ts: string; channel: string },
  channel: string,
  toolsUsed: Set<string>
): Promise<void> {
  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') {
        console.log(`[Handler] Session initialized: ${event.session_id}`);
      }
      break;

    case 'tool_use':
      if (event.tool && !toolsUsed.has(event.tool)) {
        toolsUsed.add(event.tool);
        const emoji = getToolEmoji(event.tool);
        await addReaction(channel, responseMessage.ts, emoji);
        console.log(`[Handler] Tool: ${event.tool}`);
      }
      break;

    case 'result':
      if (event.cost_usd) {
        console.log(`[Handler] Cost: $${event.cost_usd.toFixed(4)}`);
      }
      break;
  }
}

/**
 * Handle @mention in a channel
 */
export async function handleMention(
  text: string,
  user: string,
  channel: string,
  ts: string,
  threadTs?: string
): Promise<void> {
  // Remove the @mention from the text
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!cleanText) {
    await postMessage(channel, "Hi! Send me a message and I'll help you out.", threadTs || ts);
    return;
  }

  // Treat as a regular message
  await handleMessage({
    type: 'message',
    text: cleanText,
    user,
    channel,
    ts,
    thread_ts: threadTs,
  });
}
