// Session manifest generator - creates boundary enforcement manifests
import { writeFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import type { DeskDefinition, SessionManifest } from '../types/desk';

const paiDir = process.env.PAI_DIR || `${process.env.HOME}/.claude`;
const MANIFESTS_DIR = `${paiDir}/MEMORY/STATE/session-manifests`;

// Ensure manifests directory exists
if (!existsSync(MANIFESTS_DIR)) {
  mkdirSync(MANIFESTS_DIR, { recursive: true });
}

/**
 * Generate a session manifest from a desk definition
 */
export function generateManifest(
  sessionId: string,
  desk: DeskDefinition
): SessionManifest {
  const manifest: SessionManifest = {
    session_id: sessionId,
    desk_slug: desk.slug,
    created_at: new Date().toISOString(),
    writable_paths: desk.boundaries.writable || [],
    readable_paths: desk.boundaries.readable || [],
    blocked_paths: desk.boundaries.blocked || [],
  };

  return manifest;
}

/**
 * Save a session manifest to disk
 */
export function saveManifest(manifest: SessionManifest): string {
  const filePath = `${MANIFESTS_DIR}/${manifest.session_id}.yaml`;

  // Format as YAML manually to avoid dependency
  const yaml = `# Auto-generated session manifest
# DO NOT EDIT - managed by desk system

session_id: "${manifest.session_id}"
desk_slug: "${manifest.desk_slug}"
created_at: "${manifest.created_at}"

writable_paths:
${manifest.writable_paths.map(p => `  - "${p}"`).join('\n') || '  []'}

readable_paths:
${manifest.readable_paths.map(p => `  - "${p}"`).join('\n') || '  []'}

blocked_paths:
${manifest.blocked_paths.map(p => `  - "${p}"`).join('\n') || '  []'}
`;

  writeFileSync(filePath, yaml);
  console.log(`[SessionManifest] Saved: ${filePath}`);

  return filePath;
}

/**
 * Load a session manifest from disk
 */
export function loadManifest(sessionId: string): SessionManifest | null {
  const filePath = `${MANIFESTS_DIR}/${sessionId}.yaml`;

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');

    // Simple YAML parsing for our known structure
    const lines = content.split('\n');
    const manifest: Partial<SessionManifest> = {};
    let currentArray: string[] | null = null;
    let currentKey: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) continue;

      // Key: value
      const kvMatch = trimmed.match(/^(\w+):\s*"?([^"]*)"?$/);
      if (kvMatch) {
        const [, key, value] = kvMatch;
        if (key === 'session_id') manifest.session_id = value;
        if (key === 'desk_slug') manifest.desk_slug = value;
        if (key === 'created_at') manifest.created_at = value;
        currentKey = null;
        currentArray = null;
      }

      // Array key:
      const arrayMatch = trimmed.match(/^(\w+):$/);
      if (arrayMatch) {
        currentKey = arrayMatch[1];
        currentArray = [];
        if (currentKey === 'writable_paths') manifest.writable_paths = currentArray;
        if (currentKey === 'readable_paths') manifest.readable_paths = currentArray;
        if (currentKey === 'blocked_paths') manifest.blocked_paths = currentArray;
      }

      // Array item
      const itemMatch = trimmed.match(/^-\s*"([^"]+)"$/);
      if (itemMatch && currentArray) {
        currentArray.push(itemMatch[1]);
      }
    }

    return manifest as SessionManifest;
  } catch (error) {
    console.error(`[SessionManifest] Error loading ${filePath}:`, error);
    return null;
  }
}

/**
 * Delete a session manifest
 */
export function deleteManifest(sessionId: string): boolean {
  const filePath = `${MANIFESTS_DIR}/${sessionId}.yaml`;

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    unlinkSync(filePath);
    console.log(`[SessionManifest] Deleted: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[SessionManifest] Error deleting ${filePath}:`, error);
    return false;
  }
}

/**
 * Create and save a manifest for a desk session
 */
export function createDeskManifest(
  sessionId: string,
  desk: DeskDefinition
): SessionManifest {
  const manifest = generateManifest(sessionId, desk);
  saveManifest(manifest);
  return manifest;
}
