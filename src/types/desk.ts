// Type definitions for desk system

/**
 * Desk routing configuration
 */
export interface DeskRouting {
  /** @mentions that trigger this desk (e.g., ["@backend", "@api"]) */
  mentions: string[];
  /** Optional channel restriction (null = any channel) */
  channel: string | null;
}

/**
 * Desk composition - how to build the desk's personality
 */
export interface DeskComposition {
  /** Reference to an existing named agent (e.g., "Marcus Webb") */
  named_agent?: string;
  /** AgentFactory traits for dynamic composition */
  traits?: string[];
  /** Custom template path */
  template?: string;
}

/**
 * Desk boundary configuration for sandboxing
 */
export interface DeskBoundaries {
  /** Paths the desk can write to (glob patterns) */
  writable?: string[];
  /** Paths the desk can read (glob patterns) */
  readable?: string[];
  /** Paths the desk cannot access at all (glob patterns) */
  blocked?: string[];
}

/**
 * Knowledge context for the desk
 */
export interface DeskKnowledge {
  /** Files to always load at session start */
  always_load?: string[];
  /** Files to load based on @mention keywords */
  on_mention?: Record<string, string>;
}

/**
 * Session persistence configuration
 */
export interface DeskPersistence {
  /** How long to keep the session alive (hours) */
  ttl_hours?: number;
  /** Maximum concurrent sessions for this desk */
  max_concurrent?: number;
}

/**
 * Complete desk definition (as stored in YAML)
 */
export interface DeskDefinition {
  name: string;
  slug: string;
  description: string;
  routing: DeskRouting;
  composition: DeskComposition;
  boundaries: DeskBoundaries;
  knowledge: DeskKnowledge;
  system_prompt_suffix?: string;
  persistence: DeskPersistence;
}

/**
 * Defaults configuration (from _defaults.yaml)
 */
export interface DeskDefaults {
  composition?: DeskComposition;
  boundaries?: DeskBoundaries;
  knowledge?: DeskKnowledge;
  system_prompt_suffix?: string;
  persistence?: DeskPersistence;
}

/**
 * Session manifest for enforcing boundaries
 */
export interface SessionManifest {
  session_id: string;
  desk_slug: string;
  created_at: string;
  writable_paths: string[];
  readable_paths: string[];
  blocked_paths: string[];
}

/**
 * Result of desk routing
 */
export interface DeskRouteResult {
  /** The matched desk definition */
  desk: DeskDefinition;
  /** The specific @mention that matched */
  matchedMention: string;
}
