// Handle incoming Slack messages
import { getOrCreateSession } from '../services/session';
import { executeClaudeStreaming, extractText, type StreamEvent } from '../services/claude';
import { postMessage, addReaction, removeReaction, getToolEmoji, MessageUpdater, updateMessage } from '../services/slack';
import { splitForSlack, markdownToSlack, stripSystemReminders } from '../lib/markdown-to-slack';
import { getChannelConfig, isChannelEnabled } from '../services/channel-config';
import { checkRateLimits, recordUsage } from '../services/usage-tracker';
import { classifyRequest, isRequestAllowed, getCategoryDisplayName } from '../middleware/classifier';
import { buildGuardrailedPrompt, validateMessage, buildRejectionMessage, buildRateLimitMessage } from '../services/prompt-builder';
import { getFileWatcher, getPendingFiles, clearPendingFiles } from '../services/file-watcher';
import { uploadFilesToThread, filterAllowedFiles } from '../services/file-uploader';

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
}

/**
 * Handle an incoming Slack message
 */
export async function handleMessage(message: SlackMessage): Promise<void> {
  // Skip bot messages and message edits
  if (message.bot_id || message.subtype) {
    return;
  }

  const { channel, text, user, ts, thread_ts } = message;

  // Use thread_ts if in a thread, otherwise use the message ts (starts new thread)
  const threadTs = thread_ts || ts;

  console.log(`[Handler] Message from ${user} in ${channel}: ${text.slice(0, 50)}...`);

  // Check if channel has team mode config
  const channelConfig = getChannelConfig(channel);
  const isTeamMode = isChannelEnabled(channel);

  let messageToSend = text;
  let classificationResult = null;

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

  // Post initial "thinking" message
  const initialMessage = await postMessage(
    channel,
    ':thinking_face: Processing...',
    threadTs
  );

  // Add thinking reaction to user's message
  await addReaction(channel, ts, 'hourglass_flowing_sand');

  // Create message updater for streaming
  const updater = new MessageUpdater(channel, initialMessage.ts);

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

  try {
    let fullText = '';
    let toolsUsed: Set<string> = new Set();

    // Execute Claude and stream responses
    for await (const event of executeClaudeStreaming(messageToSend, {
      resumeId: isNew ? undefined : session.sessionId,
      sessionId: isNew ? session.sessionId : undefined,
    })) {
      await processStreamEvent(event, updater, initialMessage, channel, toolsUsed);

      // Accumulate text
      if (event.type === 'assistant' && event.message?.content) {
        const newText = extractText(event.message.content);
        if (newText) {
          fullText = newText; // Claude sends full message each time in stream-json
          updater.setText(fullText);
          await updater.append(''); // Trigger update check
        }
      }

      // Capture cost from result event
      if (event.type === 'result' && event.cost_usd) {
        costUsd = event.cost_usd;
      }
    }

    // Handle long responses by splitting into multiple messages
    const finalText = updater.getText();

    if (!finalText) {
      await updateMessage(channel, initialMessage.ts, ':warning: No response received from Claude');
    } else {
      const processedText = markdownToSlack(stripSystemReminders(finalText));

      if (processedText.length > MAX_SLACK_MESSAGE_LENGTH) {
        console.log(`[Handler] Response too long (${processedText.length} chars), splitting into multiple messages`);
        const chunks = splitForSlack(processedText, MAX_SLACK_MESSAGE_LENGTH);

        // Update first message with first chunk
        await updateMessage(channel, initialMessage.ts, chunks[0], true);

        // Post remaining chunks as follow-up messages
        for (let i = 1; i < chunks.length; i++) {
          await postMessage(channel, chunks[i], threadTs, true);
        }
      } else {
        await updateMessage(channel, initialMessage.ts, processedText, true);
      }
    }

    // Remove thinking reaction, add checkmark
    await removeReaction(channel, ts, 'hourglass_flowing_sand');
    await addReaction(channel, ts, 'white_check_mark');

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
