// Handle incoming Slack messages
import { getOrCreateSession } from '../services/session';
import { executeClaudeStreaming, extractText, type StreamEvent } from '../services/claude';
import { postMessage, addReaction, removeReaction, getToolEmoji, MessageUpdater, updateMessage } from '../services/slack';
import { splitForSlack, markdownToSlack, stripSystemReminders } from '../lib/markdown-to-slack';

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

  try {
    let fullText = '';
    let toolsUsed: Set<string> = new Set();

    // Execute Claude and stream responses
    for await (const event of executeClaudeStreaming(text, {
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
    }

    // Handle long responses by splitting into multiple messages
    const finalText = updater.getText();
    const processedText = markdownToSlack(stripSystemReminders(finalText));

    if (processedText.length > MAX_SLACK_MESSAGE_LENGTH) {
      console.log(`[Handler] Response too long (${processedText.length} chars), splitting...`);
      const chunks = splitForSlack(processedText, MAX_SLACK_MESSAGE_LENGTH);

      // Update first message with first chunk (raw=true since already processed)
      await updateMessage(channel, initialMessage.ts, chunks[0], true);

      // Post remaining chunks as follow-up messages (raw=true since already processed)
      for (let i = 1; i < chunks.length; i++) {
        await postMessage(channel, chunks[i], threadTs, true);
      }
    } else {
      // Normal flush for short messages
      await updater.flush();
    }

    // Remove thinking reaction, add checkmark
    await removeReaction(channel, ts, 'hourglass_flowing_sand');
    await addReaction(channel, ts, 'white_check_mark');

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
