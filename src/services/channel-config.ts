// Channel configuration service - load/save channel configs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ChannelConfig, ChannelStore } from '../types/config';
import { DEFAULT_CHANNEL_CONFIG } from '../types/config';

const PAI_DIR = process.env.PAI_DIR || `${process.env.HOME}/.claude`;
const DATA_DIR = `${PAI_DIR}/bridge/data`;
const CONFIG_PATH = `${DATA_DIR}/channels.json`;

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadChannelStore(): ChannelStore {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (error) {
    console.error('[ChannelConfig] Error loading config:', error);
  }
  return { channels: {}, defaultConfig: DEFAULT_CHANNEL_CONFIG };
}

function saveChannelStore(store: ChannelStore): void {
  ensureDataDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(store, null, 2));
}

/**
 * Get configuration for a channel
 */
export function getChannelConfig(channelId: string): ChannelConfig {
  const store = loadChannelStore();

  if (store.channels[channelId]) {
    return store.channels[channelId];
  }

  // Return default config with channel ID
  const defaultConfig = store.defaultConfig || DEFAULT_CHANNEL_CONFIG;
  return {
    channelId,
    channelName: 'unknown',
    enabled: defaultConfig.enabled ?? false,
    capabilities: defaultConfig.capabilities ?? [],
    rateLimits: {
      requestsPerHour: defaultConfig.rateLimits?.requestsPerHour ?? 5,
      requestsPerDay: defaultConfig.rateLimits?.requestsPerDay ?? 20,
      tokensPerDay: defaultConfig.rateLimits?.tokensPerDay ?? 50000,
    },
    maxCostPerRequest: defaultConfig.maxCostPerRequest ?? 0.10,
    maxCostPerDay: defaultConfig.maxCostPerDay ?? 5.00,
    autoUploadAssets: defaultConfig.autoUploadAssets ?? false,
    allowedFileTypes: defaultConfig.allowedFileTypes ?? [],
    maxFileSizeMb: defaultConfig.maxFileSizeMb ?? 5,
  };
}

/**
 * Check if channel is enabled for the bridge
 */
export function isChannelEnabled(channelId: string): boolean {
  const config = getChannelConfig(channelId);
  return config.enabled;
}

/**
 * Check if a capability is enabled for a channel
 */
export function isCapabilityEnabled(
  channelId: string,
  capability: string
): boolean {
  const config = getChannelConfig(channelId);
  const cap = config.capabilities.find((c) => c.name === capability);
  return cap?.enabled ?? false;
}

/**
 * Update channel configuration
 */
export function updateChannelConfig(
  channelId: string,
  updates: Partial<ChannelConfig>
): ChannelConfig {
  const store = loadChannelStore();
  const existing = store.channels[channelId] || getChannelConfig(channelId);

  store.channels[channelId] = {
    ...existing,
    ...updates,
    channelId,
  };

  saveChannelStore(store);
  return store.channels[channelId];
}

/**
 * Get all configured channels
 */
export function getAllChannels(): ChannelConfig[] {
  const store = loadChannelStore();
  return Object.values(store.channels);
}

/**
 * Delete channel configuration
 */
export function deleteChannelConfig(channelId: string): boolean {
  const store = loadChannelStore();
  if (store.channels[channelId]) {
    delete store.channels[channelId];
    saveChannelStore(store);
    return true;
  }
  return false;
}
