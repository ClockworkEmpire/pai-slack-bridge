// Desk definition loader - loads and caches YAML desk definitions
import { readFileSync, existsSync, readdirSync, watch, type FSWatcher } from 'fs';
import { join, basename } from 'path';
import { parse as parseYaml } from 'yaml';
import type { DeskDefinition, DeskDefaults } from '../types/desk';

const paiDir = process.env.PAI_DIR || `${process.env.HOME}/.claude`;
const DESKS_DIR = `${paiDir}/MEMORY/desks`;

// Cache for desk definitions
let deskCache: Map<string, DeskDefinition> = new Map();
let defaultsCache: DeskDefaults | null = null;
let watcher: FSWatcher | null = null;

/**
 * Expand ~ to home directory in paths
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return path.replace('~/', `${process.env.HOME}/`);
  }
  return path;
}

/**
 * Expand all paths in an array
 */
function expandPaths(paths: string[] | undefined): string[] {
  return (paths || []).map(expandPath);
}

/**
 * Load defaults from _defaults.yaml
 */
function loadDefaults(): DeskDefaults {
  const defaultsPath = join(DESKS_DIR, '_defaults.yaml');

  if (!existsSync(defaultsPath)) {
    console.log('[DeskLoader] No _defaults.yaml found, using empty defaults');
    return {};
  }

  try {
    const content = readFileSync(defaultsPath, 'utf-8');
    const defaults = parseYaml(content) as DeskDefaults;

    // Expand paths in defaults
    if (defaults.boundaries) {
      defaults.boundaries.writable = expandPaths(defaults.boundaries.writable);
      defaults.boundaries.readable = expandPaths(defaults.boundaries.readable);
      defaults.boundaries.blocked = expandPaths(defaults.boundaries.blocked);
    }

    return defaults;
  } catch (error) {
    console.error('[DeskLoader] Error loading defaults:', error);
    return {};
  }
}

/**
 * Merge defaults into a desk definition
 */
function applyDefaults(desk: DeskDefinition, defaults: DeskDefaults): DeskDefinition {
  return {
    ...desk,
    composition: desk.composition || defaults.composition || { traits: ['helpful'] },
    boundaries: {
      writable: expandPaths(desk.boundaries?.writable) || [],
      readable: expandPaths(desk.boundaries?.readable) || [],
      blocked: [
        ...expandPaths(defaults.boundaries?.blocked || []),
        ...expandPaths(desk.boundaries?.blocked || []),
      ],
    },
    knowledge: {
      always_load: [
        ...expandPaths(defaults.knowledge?.always_load || []),
        ...expandPaths(desk.knowledge?.always_load || []),
      ],
      on_mention: {
        ...defaults.knowledge?.on_mention,
        ...desk.knowledge?.on_mention,
      },
    },
    system_prompt_suffix: [
      defaults.system_prompt_suffix || '',
      desk.system_prompt_suffix || '',
    ].filter(Boolean).join('\n\n'),
    persistence: {
      ...defaults.persistence,
      ...desk.persistence,
    },
  };
}

/**
 * Load a single desk definition from file
 */
function loadDeskFile(filePath: string): DeskDefinition | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const desk = parseYaml(content) as DeskDefinition;

    // Validate required fields
    if (!desk.name || !desk.slug) {
      console.error(`[DeskLoader] Invalid desk definition (missing name/slug): ${filePath}`);
      return null;
    }

    // Ensure routing exists
    desk.routing = desk.routing || { mentions: [], channel: null };

    return desk;
  } catch (error) {
    console.error(`[DeskLoader] Error loading ${filePath}:`, error);
    return null;
  }
}

/**
 * Reload all desk definitions from disk
 */
export function reloadDesks(): void {
  console.log('[DeskLoader] Reloading desk definitions...');

  deskCache.clear();
  defaultsCache = loadDefaults();

  if (!existsSync(DESKS_DIR)) {
    console.warn(`[DeskLoader] Desks directory not found: ${DESKS_DIR}`);
    return;
  }

  const files = readdirSync(DESKS_DIR).filter(
    f => f.endsWith('.yaml') && !f.startsWith('_')
  );

  for (const file of files) {
    const filePath = join(DESKS_DIR, file);
    const desk = loadDeskFile(filePath);

    if (desk) {
      const merged = applyDefaults(desk, defaultsCache);
      deskCache.set(desk.slug, merged);
      console.log(`[DeskLoader] Loaded desk: ${desk.slug} (mentions: ${desk.routing.mentions.join(', ') || 'none'})`);
    }
  }

  console.log(`[DeskLoader] Loaded ${deskCache.size} desks`);
}

/**
 * Get all loaded desk definitions
 */
export function getAllDesks(): DeskDefinition[] {
  if (deskCache.size === 0) {
    reloadDesks();
  }
  return Array.from(deskCache.values());
}

/**
 * Get a desk by slug
 */
export function getDeskBySlug(slug: string): DeskDefinition | null {
  if (deskCache.size === 0) {
    reloadDesks();
  }
  return deskCache.get(slug) || null;
}

/**
 * Get the default desk (no @mention required)
 */
export function getDefaultDesk(): DeskDefinition | null {
  const desks = getAllDesks();
  return desks.find(d => d.routing.mentions.length === 0) || null;
}

/**
 * Start watching for desk definition changes
 */
export function startWatching(): void {
  if (watcher) return;

  if (!existsSync(DESKS_DIR)) {
    console.warn(`[DeskLoader] Cannot watch - directory not found: ${DESKS_DIR}`);
    return;
  }

  watcher = watch(DESKS_DIR, (eventType, filename) => {
    if (filename?.endsWith('.yaml')) {
      console.log(`[DeskLoader] Desk file changed: ${filename}, reloading...`);
      reloadDesks();
    }
  });

  console.log('[DeskLoader] Watching for desk definition changes');
}

/**
 * Stop watching for changes
 */
export function stopWatching(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[DeskLoader] Stopped watching for changes');
  }
}
