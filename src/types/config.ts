// Channel configuration types for the Slack bridge

export interface TaskCapability {
  name: 'copy' | 'briefs' | 'visuals' | 'research';
  enabled: boolean;
  systemPromptAddition?: string;
  allowedSkills?: string[];
}

export interface RateLimits {
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerDay: number;
}

export interface ChannelConfig {
  channelId: string;
  channelName: string;
  enabled: boolean;
  capabilities: TaskCapability[];

  // Guardrails
  systemPromptPrefix?: string;
  systemPromptSuffix?: string;
  blockedPatterns?: string[];
  requireApproval?: boolean;

  // Rate Limiting
  rateLimits: RateLimits;

  // Cost Controls
  maxCostPerRequest: number;
  maxCostPerDay: number;

  // File Upload Settings
  autoUploadAssets: boolean;
  allowedFileTypes: string[];
  maxFileSizeMb: number;
}

export interface ChannelStore {
  channels: Record<string, ChannelConfig>;
  defaultConfig: Partial<ChannelConfig>;
}

export const DEFAULT_CHANNEL_CONFIG: Partial<ChannelConfig> = {
  enabled: false,
  capabilities: [],
  rateLimits: {
    requestsPerHour: 5,
    requestsPerDay: 20,
    tokensPerDay: 50000,
  },
  maxCostPerRequest: 0.10,
  maxCostPerDay: 5.00,
  autoUploadAssets: false,
  allowedFileTypes: [],
  maxFileSizeMb: 5,
};
