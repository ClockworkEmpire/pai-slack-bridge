#!/usr/bin/env bun
// PAI Slack Bridge
// Bidirectional Slack <-> Claude Code integration

import { existsSync, readFileSync } from 'fs';

/**
 * Load environment variables from a .env file
 */
function loadEnvFile(path: string): boolean {
  if (!existsSync(path)) return false;

  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      // Don't override existing env vars
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
  console.log(`Loaded environment from ${path}`);
  return true;
}

// Load .env from PAI_DIR (default: ~/.claude)
const paiDir = process.env.PAI_DIR || `${process.env.HOME}/.claude`;
loadEnvFile(`${paiDir}/.env`);

import { App, LogLevel } from '@slack/bolt';
import { handleMessage, handleMention } from './handlers/message';
import { cleanupOldSessions } from './services/session';
import { getFileWatcher } from './services/file-watcher';
import { reloadDesks, startWatching as startDeskWatching, stopWatching as stopDeskWatching } from './services/desk-loader';
import { startBridgeApi } from './services/bridge-api';
import type { SlackFile } from './types/slack';

// Validate environment
const requiredEnvVars = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Optional config
const PORT = parseInt(process.env.BRIDGE_PORT || '3847', 10);
const ALLOWED_CHANNELS = process.env.BRIDGE_ALLOWED_CHANNELS?.split(',').map(s => s.trim()).filter(Boolean) || [];
const ALLOWED_USERS = process.env.BRIDGE_ALLOWED_USERS?.split(',').map(s => s.trim()).filter(Boolean) || [];

console.log('Starting PAI Slack Bridge...');
console.log(`  PAI_DIR: ${paiDir}`);
console.log(`  Claude CWD: ${process.env.BRIDGE_DEFAULT_CWD || paiDir}`);
console.log(`  Allowed channels: ${ALLOWED_CHANNELS.length ? ALLOWED_CHANNELS.join(', ') : 'all'}`);
console.log(`  Allowed users: ${ALLOWED_USERS.length ? ALLOWED_USERS.join(', ') : 'all'}`);

// Initialize Slack app with Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

// Get bot user ID on startup
let botUserId: string | null = null;

/**
 * Check if message is in an allowed channel
 */
function isAllowedChannel(channel: string): boolean {
  if (ALLOWED_CHANNELS.length === 0) return true;
  return ALLOWED_CHANNELS.includes(channel);
}

/**
 * Check if user is allowed to use the bot
 */
function isAllowedUser(userId: string): boolean {
  if (ALLOWED_USERS.length === 0) return true;
  return ALLOWED_USERS.includes(userId);
}

/**
 * Check if message is a DM
 */
function isDM(channelType: string): boolean {
  return channelType === 'im';
}

// Handle direct messages
app.message(async ({ message, say }) => {
  // Type guard for message with required fields
  if (!('text' in message) || !('user' in message) || !('channel' in message)) {
    return;
  }

  const msg = message as {
    type: string;
    subtype?: string;
    text: string;
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
    channel_type?: string;
    files?: SlackFile[];
  };

  // Skip bot messages
  if (msg.bot_id) return;

  // Skip @mentions in channels - they're handled by app_mention
  // (DMs don't have @mentions so always process those)
  const isDirectMessage = isDM(msg.channel_type || '');
  if (!isDirectMessage && botUserId && msg.text.includes(`<@${botUserId}>`)) {
    return; // Will be handled by app_mention handler
  }

  // Check if user is allowed
  if (!isAllowedUser(msg.user)) {
    console.log(`[Bridge] Ignoring message from non-allowed user: ${msg.user}`);
    return;
  }

  // Check if DM or allowed channel
  if (!isDirectMessage && !isAllowedChannel(msg.channel)) {
    console.log(`[Bridge] Ignoring message in non-allowed channel: ${msg.channel}`);
    return;
  }

  try {
    await handleMessage({ ...msg, files: msg.files });
  } catch (error) {
    console.error('[Bridge] Error handling message:', error);
  }
});

// Handle @mentions
app.event('app_mention', async ({ event }) => {
  const { text, user, channel, ts, thread_ts } = event;

  // Ensure we have a user
  if (!user) {
    console.log('[Bridge] Ignoring mention without user');
    return;
  }

  // Check if user is allowed
  if (!isAllowedUser(user)) {
    console.log(`[Bridge] Ignoring mention from non-allowed user: ${user}`);
    return;
  }

  // Allow mentions in any channel where the bot is invited
  console.log(`[Bridge] Mentioned by ${user} in ${channel}`);

  try {
    await handleMention(text, user, channel, ts, thread_ts ?? undefined);
  } catch (error) {
    console.error('[Bridge] Error handling mention:', error);
  }
});

// Track button selections per thread (for multi-question flows)
const pendingSelections: Map<string, string[]> = new Map();

// Handle interactive button clicks
app.action(/.*/, async ({ action, body, ack }) => {
  await ack();

  if (action.type === 'button' && 'value' in action) {
    const buttonAction = action as { value: string; action_id: string };
    const messageBody = body as any;
    const channel = messageBody.channel?.id;
    const threadTs = messageBody.message?.thread_ts || messageBody.message?.ts;
    const userId = messageBody.user?.id;
    const threadKey = `${channel}:${threadTs}`;

    if (!channel || !threadTs || !buttonAction.value) return;

    console.log(`[Bridge] Button clicked: "${buttonAction.value}" by ${userId}`);

    try {
      // Multi-question answer selection (Q1: ..., Q2: ...)
      if (buttonAction.value.match(/^Q\d+: /)) {
        const selections = pendingSelections.get(threadKey) || [];
        // Replace any existing answer for this question number
        const qNum = buttonAction.value.match(/^(Q\d+):/)?.[1];
        const qIndex = qNum ? parseInt(qNum.slice(1)) - 1 : -1;
        const selectedLabel = buttonAction.value.replace(/^Q\d+: /, '');
        const filtered = selections.filter(s => !s.startsWith(`${qNum}:`));
        filtered.push(buttonAction.value);
        pendingSelections.set(threadKey, filtered);

        // Update the message blocks to highlight the selected answer (keep buttons clickable)
        const msgTs = messageBody.message?.ts;
        const currentBlocks = messageBody.message?.blocks || [];
        if (msgTs && currentBlocks.length > 0) {
          const updatedBlocks = currentBlocks.map((block: any) => {
            if (block.type === 'actions' && block.elements) {
              const hasThisQ = block.elements.some((el: any) =>
                el.value?.startsWith(`${qNum}:`)
              );
              if (hasThisQ) {
                // Update button text to show which is selected, but keep all buttons clickable
                return {
                  ...block,
                  elements: block.elements.map((el: any) => {
                    const elLabel = el.value?.replace(/^Q\d+: /, '') || '';
                    const isSelected = elLabel === selectedLabel;
                    return {
                      ...el,
                      text: {
                        ...el.text,
                        text: isSelected ? `✅ ${elLabel}` : elLabel.replace(/^✅ /, ''),
                      },
                    };
                  }),
                };
              }
            }
            return block;
          });

          try {
            await app.client.chat.update({
              channel,
              ts: msgTs,
              text: messageBody.message?.text || '',
              blocks: updatedBlocks,
            });
          } catch (e) {
            console.error('[Bridge] Failed to update button highlight:', e);
          }
        }
        return;
      }

      // Submit all answers
      if (buttonAction.value === '__SUBMIT_ANSWERS__') {
        const selections = pendingSelections.get(threadKey) || [];
        pendingSelections.delete(threadKey);

        const answersText = selections.length > 0
          ? selections.sort().join('\n')
          : 'No selections made';

        const submitMsg = await app.client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `:white_check_mark: *Answers submitted:*\n${answersText}`,
        });

        await handleMessage({
          type: 'message',
          text: answersText,
          user: userId || 'unknown',
          channel,
          ts: submitMsg.ts || threadTs,
          thread_ts: threadTs,
        });
        return;
      }

      // Simple single-question button or generic button
      const selMsg = await app.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `:white_check_mark: Selected: *${buttonAction.value}*`,
      });

      await handleMessage({
        type: 'message',
        text: buttonAction.value,
        user: userId || 'unknown',
        channel,
        ts: selMsg.ts || threadTs,
        thread_ts: threadTs,
      });
    } catch (error) {
      console.error('[Bridge] Error handling button click:', error);
    }
  }
});

// Periodic cleanup of old sessions (every hour)
setInterval(() => {
  const removed = cleanupOldSessions(24);
  if (removed > 0) {
    console.log(`[Bridge] Cleaned up ${removed} old sessions`);
  }
}, 60 * 60 * 1000);

// Start the app
(async () => {
  try {
    await app.start(PORT);
    console.log(`PAI Slack Bridge is running on port ${PORT}`);

    // Get bot user ID
    const authResult = await app.client.auth.test();
    botUserId = authResult.user_id || null;
    console.log(`Bot user ID: ${botUserId}`);

    // Start file watcher for asset uploads
    const fileWatcher = getFileWatcher();
    await fileWatcher.start();
    console.log(`File watcher active: ${fileWatcher.getWatchedDirectories().join(', ')}`);

    // Start Bridge API server (for Claude → Slack file/message/button sending)
    const bridgeApi = startBridgeApi();
    console.log(`Bridge API running on port ${bridgeApi.port}`);

    // Load desk definitions and start watching for changes
    reloadDesks();
    startDeskWatching();

  } catch (error) {
    console.error('Failed to start bridge:', error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  getFileWatcher().stop();
  stopDeskWatching();
  await app.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  getFileWatcher().stop();
  stopDeskWatching();
  await app.stop();
  process.exit(0);
});
