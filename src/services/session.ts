// Session manager: maps Slack threads to Claude Code sessions
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export interface SessionMapping {
  sessionId: string;
  channelId: string;
  threadTs: string;
  userId: string;
  createdAt: string;
  lastActivity: string;
}

interface SessionStore {
  sessions: Record<string, SessionMapping>; // key: "channelId:threadTs"
}

// Use BRIDGE_DATA_DIR or default to ./data relative to project
const DATA_DIR = process.env.BRIDGE_DATA_DIR || `${dirname(dirname(Bun.main))}/data`;
const SESSIONS_PATH = `${DATA_DIR}/sessions.json`;

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load sessions from disk
 */
function loadSessions(): SessionStore {
  try {
    if (existsSync(SESSIONS_PATH)) {
      const data = readFileSync(SESSIONS_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading sessions:', error);
  }
  return { sessions: {} };
}

/**
 * Save sessions to disk
 */
function saveSessions(store: SessionStore): void {
  try {
    writeFileSync(SESSIONS_PATH, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error('Error saving sessions:', error);
  }
}

/**
 * Create session key from channel and thread
 */
function sessionKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

/**
 * Get or create a session for a Slack thread
 */
export function getOrCreateSession(
  channelId: string,
  threadTs: string,
  userId: string
): { session: SessionMapping; isNew: boolean } {
  const store = loadSessions();
  const key = sessionKey(channelId, threadTs);

  if (store.sessions[key]) {
    // Update last activity
    store.sessions[key].lastActivity = new Date().toISOString();
    saveSessions(store);
    return { session: store.sessions[key], isNew: false };
  }

  // Create new session
  const session: SessionMapping = {
    sessionId: randomUUID(),
    channelId,
    threadTs,
    userId,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };

  store.sessions[key] = session;
  saveSessions(store);

  return { session, isNew: true };
}

/**
 * Get session by thread
 */
export function getSession(channelId: string, threadTs: string): SessionMapping | null {
  const store = loadSessions();
  const key = sessionKey(channelId, threadTs);
  return store.sessions[key] || null;
}

/**
 * Update session's last activity
 */
export function updateSessionActivity(channelId: string, threadTs: string): void {
  const store = loadSessions();
  const key = sessionKey(channelId, threadTs);

  if (store.sessions[key]) {
    store.sessions[key].lastActivity = new Date().toISOString();
    saveSessions(store);
  }
}

/**
 * Look up a session by its sessionId (for bridge API)
 */
export function getSessionBySessionId(sessionId: string): SessionMapping | null {
  const store = loadSessions();
  for (const session of Object.values(store.sessions)) {
    if (session.sessionId === sessionId) {
      return session;
    }
  }
  return null;
}

/**
 * Clean up old sessions (older than 24 hours of inactivity)
 */
export function cleanupOldSessions(maxAgeHours = 24): number {
  const store = loadSessions();
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  let removed = 0;

  for (const key of Object.keys(store.sessions)) {
    const session = store.sessions[key];
    const lastActivity = new Date(session.lastActivity).getTime();

    if (lastActivity < cutoff) {
      delete store.sessions[key];
      removed++;
    }
  }

  if (removed > 0) {
    saveSessions(store);
  }

  return removed;
}
