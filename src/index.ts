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
    await handleMessage(msg);
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

  } catch (error) {
    console.error('Failed to start bridge:', error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  getFileWatcher().stop();
  await app.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  getFileWatcher().stop();
  await app.stop();
  process.exit(0);
});
