// Usage tracking service - rate limiting and cost control
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import type { UsageRecord, UsageStore, ChannelUsage } from '../types/usage';
import { EMPTY_USAGE_STORE } from '../types/usage';
import type { ChannelConfig } from '../types/config';

const PAI_DIR = process.env.PAI_DIR || `${process.env.HOME}/.claude`;
const DATA_DIR = `${PAI_DIR}/bridge/data`;
const USAGE_PATH = `${DATA_DIR}/usage.json`;

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadUsage(): UsageStore {
  try {
    if (existsSync(USAGE_PATH)) {
      return JSON.parse(readFileSync(USAGE_PATH, 'utf-8'));
    }
  } catch (error) {
    console.error('[UsageTracker] Error loading usage data:', error);
  }
  return { ...EMPTY_USAGE_STORE };
}

function saveUsage(store: UsageStore): void {
  ensureDataDir();
  writeFileSync(USAGE_PATH, JSON.stringify(store, null, 2));
}

/**
 * Record a usage event
 */
export function recordUsage(record: UsageRecord): void {
  const store = loadUsage();

  // Add to records
  store.records.push(record);

  // Update daily summary
  const date = record.timestamp.split('T')[0];
  if (!store.dailySummaries[date]) {
    store.dailySummaries[date] = { date, byUser: {}, byChannel: {} };
  }

  const daily = store.dailySummaries[date];

  // Update user stats
  if (!daily.byUser[record.userId]) {
    daily.byUser[record.userId] = { requests: 0, tokens: 0, costUsd: 0 };
  }
  daily.byUser[record.userId].requests++;
  daily.byUser[record.userId].tokens += record.tokensUsed;
  daily.byUser[record.userId].costUsd += record.costUsd;

  // Update channel stats
  if (!daily.byChannel[record.channelId]) {
    daily.byChannel[record.channelId] = { requests: 0, tokens: 0, costUsd: 0 };
  }
  daily.byChannel[record.channelId].requests++;
  daily.byChannel[record.channelId].tokens += record.tokensUsed;
  daily.byChannel[record.channelId].costUsd += record.costUsd;

  // Update hourly bucket
  const hour = record.timestamp.slice(0, 13); // YYYY-MM-DDTHH
  const bucketKey = `${record.channelId}:${hour}`;
  store.hourlyBuckets[bucketKey] = (store.hourlyBuckets[bucketKey] || 0) + 1;

  // Prune old records (keep 30 days)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  store.records = store.records.filter((r) => new Date(r.timestamp) > cutoff);

  // Prune old daily summaries
  const oldDates = Object.keys(store.dailySummaries).filter(
    (d) => new Date(d) < cutoff
  );
  for (const d of oldDates) {
    delete store.dailySummaries[d];
  }

  // Prune old hourly buckets
  const cutoffHour = cutoff.toISOString().slice(0, 13);
  const oldBuckets = Object.keys(store.hourlyBuckets).filter((k) => {
    const bucketHour = k.split(':').slice(1).join(':');
    return bucketHour < cutoffHour;
  });
  for (const k of oldBuckets) {
    delete store.hourlyBuckets[k];
  }

  saveUsage(store);
}

/**
 * Check rate limits for a channel
 */
export function checkRateLimits(
  userId: string,
  channelId: string,
  config: ChannelConfig
): {
  allowed: boolean;
  reason?: string;
  remaining?: { hourly: number; daily: number };
} {
  const store = loadUsage();
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.toISOString().slice(0, 13);

  // Check hourly limit
  const hourlyKey = `${channelId}:${currentHour}`;
  const hourlyCount = store.hourlyBuckets[hourlyKey] || 0;
  if (hourlyCount >= config.rateLimits.requestsPerHour) {
    return {
      allowed: false,
      reason: `Hourly rate limit reached (${config.rateLimits.requestsPerHour}/hour). Try again in a few minutes.`,
    };
  }

  // Check daily limit
  const daily = store.dailySummaries[today];
  const dailyChannelCount = daily?.byChannel[channelId]?.requests || 0;
  if (dailyChannelCount >= config.rateLimits.requestsPerDay) {
    return {
      allowed: false,
      reason: `Daily rate limit reached (${config.rateLimits.requestsPerDay}/day). Try again tomorrow.`,
    };
  }

  // Check daily token limit
  const dailyTokens = daily?.byChannel[channelId]?.tokens || 0;
  if (dailyTokens >= config.rateLimits.tokensPerDay) {
    return {
      allowed: false,
      reason: `Daily token limit reached. Try again tomorrow.`,
    };
  }

  // Check daily cost limit
  const dailyCost = daily?.byChannel[channelId]?.costUsd || 0;
  if (dailyCost >= config.maxCostPerDay) {
    return {
      allowed: false,
      reason: `Daily cost limit reached ($${config.maxCostPerDay.toFixed(2)}). Try again tomorrow.`,
    };
  }

  return {
    allowed: true,
    remaining: {
      hourly: config.rateLimits.requestsPerHour - hourlyCount,
      daily: config.rateLimits.requestsPerDay - dailyChannelCount,
    },
  };
}

/**
 * Get usage summary for a channel
 */
export function getChannelUsageSummary(
  channelId: string,
  days = 7
): {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byDay: { date: string; requests: number; cost: number }[];
} {
  const store = loadUsage();
  const result = {
    totalRequests: 0,
    totalTokens: 0,
    totalCost: 0,
    byDay: [] as { date: string; requests: number; cost: number }[],
  };

  const now = new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const daily = store.dailySummaries[dateStr];
    const channelData = daily?.byChannel[channelId];

    if (channelData) {
      result.totalRequests += channelData.requests;
      result.totalTokens += channelData.tokens;
      result.totalCost += channelData.costUsd;
      result.byDay.push({
        date: dateStr,
        requests: channelData.requests,
        cost: channelData.costUsd,
      });
    }
  }

  return result;
}

/**
 * Get user usage summary
 */
export function getUserUsageSummary(
  userId: string,
  days = 7
): {
  totalRequests: number;
  totalCost: number;
  byDay: { date: string; requests: number; cost: number }[];
} {
  const store = loadUsage();
  const result = {
    totalRequests: 0,
    totalCost: 0,
    byDay: [] as { date: string; requests: number; cost: number }[],
  };

  const now = new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const daily = store.dailySummaries[dateStr];
    const userData = daily?.byUser[userId];

    if (userData) {
      result.totalRequests += userData.requests;
      result.totalCost += userData.costUsd;
      result.byDay.push({
        date: dateStr,
        requests: userData.requests,
        cost: userData.costUsd,
      });
    }
  }

  return result;
}
