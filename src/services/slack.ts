// Slack API wrapper: post messages, update them, add reactions
import { WebClient } from '@slack/web-api';
import { markdownToSlack, truncateForSlack, stripSystemReminders } from '../lib/markdown-to-slack';

let client: WebClient | null = null;

/**
 * Get or create Slack client
 */
export function getSlackClient(): WebClient {
  if (!client) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN not set');
    }
    client = new WebClient(token);
  }
  return client;
}

/**
 * Post a new message to a channel/thread
 */
export async function postMessage(
  channel: string,
  text: string,
  threadTs?: string,
  raw = false
): Promise<{ ts: string; channel: string }> {
  const client = getSlackClient();

  const processedText = raw ? text : truncateForSlack(markdownToSlack(stripSystemReminders(text)));

  const result = await client.chat.postMessage({
    channel,
    text: processedText,
    thread_ts: threadTs,
  });

  if (!result.ts || !result.channel) {
    throw new Error('Failed to post message');
  }

  return { ts: result.ts, channel: result.channel };
}

/**
 * Update an existing message
 */
export async function updateMessage(
  channel: string,
  ts: string,
  text: string,
  raw = false
): Promise<void> {
  const client = getSlackClient();
  let processedText = raw ? text : truncateForSlack(markdownToSlack(stripSystemReminders(text)));

  try {
    await client.chat.update({
      channel,
      ts,
      text: processedText,
    });
  } catch (error: unknown) {
    // Handle msg_too_long by aggressive truncation
    if (error && typeof error === 'object' && 'data' in error) {
      const slackError = error as { data?: { error?: string } };
      if (slackError.data?.error === 'msg_too_long') {
        console.log(`[Slack] Message too long (${processedText.length} chars), truncating...`);
        // Aggressively truncate to 3500 chars (safe limit)
        processedText = processedText.slice(0, 3500) + '\n\n... _(message truncated - too long for Slack)_';
        await client.chat.update({
          channel,
          ts,
          text: processedText,
        });
        return;
      }
    }
    throw error;
  }
}

/**
 * Add a reaction to a message
 */
export async function addReaction(
  channel: string,
  ts: string,
  emoji: string
): Promise<void> {
  const client = getSlackClient();

  try {
    await client.reactions.add({
      channel,
      timestamp: ts,
      name: emoji,
    });
  } catch (error: unknown) {
    // Ignore "already_reacted" errors
    if (error && typeof error === 'object' && 'data' in error) {
      const slackError = error as { data?: { error?: string } };
      if (slackError.data?.error === 'already_reacted') return;
    }
    throw error;
  }
}

/**
 * Remove a reaction from a message
 */
export async function removeReaction(
  channel: string,
  ts: string,
  emoji: string
): Promise<void> {
  const client = getSlackClient();

  try {
    await client.reactions.remove({
      channel,
      timestamp: ts,
      name: emoji,
    });
  } catch (error: unknown) {
    // Ignore "no_reaction" errors
    if (error && typeof error === 'object' && 'data' in error) {
      const slackError = error as { data?: { error?: string } };
      if (slackError.data?.error === 'no_reaction') return;
    }
    throw error;
  }
}

/**
 * Tool name to emoji mapping
 */
const TOOL_EMOJIS: Record<string, string> = {
  Bash: 'computer',
  Read: 'eyes',
  Write: 'memo',
  Edit: 'pencil2',
  Glob: 'mag',
  Grep: 'mag_right',
  WebFetch: 'globe_with_meridians',
  WebSearch: 'mag',
  Task: 'robot_face',
};

/**
 * Get emoji for a tool
 */
export function getToolEmoji(toolName: string): string {
  return TOOL_EMOJIS[toolName] || 'gear';
}

/**
 * Debounced message updater for streaming
 */
export class MessageUpdater {
  private pendingText = '';
  private lastUpdateTime = 0;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private minInterval: number;

  constructor(
    private channel: string,
    private ts: string,
    minIntervalMs = 500
  ) {
    this.minInterval = minIntervalMs;
  }

  /**
   * Append text and schedule update
   */
  async append(text: string): Promise<void> {
    this.pendingText += text;

    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;

    if (timeSinceLastUpdate >= this.minInterval) {
      await this.flush();
    } else if (!this.updateTimer) {
      this.updateTimer = setTimeout(async () => {
        await this.flush();
        this.updateTimer = null;
      }, this.minInterval - timeSinceLastUpdate);
    }
  }

  /**
   * Set full text (replaces pending)
   */
  setText(text: string): void {
    this.pendingText = text;
  }

  /**
   * Get current text
   */
  getText(): string {
    return this.pendingText;
  }

  /**
   * Flush pending updates to Slack
   */
  async flush(): Promise<void> {
    if (!this.pendingText) return;

    try {
      await updateMessage(this.channel, this.ts, this.pendingText);
      this.lastUpdateTime = Date.now();
    } catch (error) {
      console.error('[Slack] Update failed:', error);
    }
  }

  /**
   * Clear any pending timer
   */
  cleanup(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
  }
}
