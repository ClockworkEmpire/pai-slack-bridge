// Usage tracking types for rate limiting and cost control

export interface UsageRecord {
  userId: string;
  channelId: string;
  timestamp: string; // ISO8601
  category: string;
  tokensUsed: number;
  costUsd: number;
  sessionId: string;
  filesUploaded: string[];
  duration: number; // ms
}

export interface ChannelUsage {
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  byUser: Record<string, ChannelUsage>;
  byChannel: Record<string, ChannelUsage>;
}

export interface UsageStore {
  records: UsageRecord[];
  dailySummaries: Record<string, DailyUsage>;
  hourlyBuckets: Record<string, number>; // "channelId:YYYY-MM-DDTHH" -> count
}

export const EMPTY_USAGE_STORE: UsageStore = {
  records: [],
  dailySummaries: {},
  hourlyBuckets: {},
};
