// File watcher service - monitors directories for new files during Claude execution
import { watch, type FSWatcher } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import { randomUUID } from 'crypto';
import type { PendingFile } from '../types/files';
import { getMimeType } from '../types/files';

interface FileWatcherOptions {
  directories: string[];
  extensions: string[];
  onFileDetected: (file: PendingFile) => void;
}

interface SessionContext {
  channelId: string;
  threadTs: string;
  sessionId: string;
}

/**
 * File watcher that monitors directories for new files
 * during Claude execution
 */
export class FileWatcher {
  private watchers: FSWatcher[] = [];
  private seenFiles: Set<string> = new Set();
  private options: FileWatcherOptions;
  private activeSession: SessionContext | null = null;
  private isRunning = false;

  constructor(options: FileWatcherOptions) {
    this.options = options;
  }

  /**
   * Start watching directories
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    // Snapshot existing files to avoid picking up old files
    await this.snapshotExistingFiles();

    for (const dir of this.options.directories) {
      try {
        const watcher = watch(dir, { persistent: true }, (eventType, filename) => {
          if (filename) {
            this.handleFileEvent(dir, filename);
          }
        });

        watcher.on('error', (error) => {
          console.error(`[FileWatcher] Error watching ${dir}:`, error);
        });

        this.watchers.push(watcher);
        console.log(`[FileWatcher] Watching: ${dir}`);
      } catch (error) {
        console.error(`[FileWatcher] Failed to watch ${dir}:`, error);
      }
    }

    this.isRunning = true;
    console.log(`[FileWatcher] Started watching ${this.watchers.length} directories`);
  }

  /**
   * Stop watching
   */
  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    this.isRunning = false;
    console.log('[FileWatcher] Stopped');
  }

  /**
   * Set the active session context for file attribution
   */
  setActiveSession(channelId: string, threadTs: string, sessionId: string): void {
    this.activeSession = { channelId, threadTs, sessionId };
    console.log(`[FileWatcher] Session active: ${sessionId.slice(0, 8)}...`);
  }

  /**
   * Clear active session (execution complete)
   */
  clearActiveSession(): void {
    this.activeSession = null;
    console.log('[FileWatcher] Session cleared');
  }

  /**
   * Check if watcher is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get list of watched directories
   */
  getWatchedDirectories(): string[] {
    return [...this.options.directories];
  }

  /**
   * Manually trigger a scan for new files (useful for polling mode)
   */
  async scanForNewFiles(): Promise<PendingFile[]> {
    if (!this.activeSession) return [];

    const newFiles: PendingFile[] = [];

    for (const dir of this.options.directories) {
      try {
        const files = await readdir(dir);
        for (const filename of files) {
          const fullPath = join(dir, filename);
          if (!this.seenFiles.has(fullPath)) {
            const ext = extname(filename).toLowerCase().slice(1);
            if (this.options.extensions.includes(ext)) {
              const pendingFile = await this.createPendingFile(fullPath, filename);
              if (pendingFile) {
                newFiles.push(pendingFile);
                this.seenFiles.add(fullPath);
              }
            }
          }
        }
      } catch {
        // Directory might not exist
      }
    }

    return newFiles;
  }

  private async snapshotExistingFiles(): Promise<void> {
    for (const dir of this.options.directories) {
      try {
        const files = await readdir(dir);
        for (const file of files) {
          this.seenFiles.add(join(dir, file));
        }
        console.log(`[FileWatcher] Snapshotted ${files.length} existing files in ${dir}`);
      } catch {
        // Directory might not exist, that's fine
      }
    }
  }

  private async handleFileEvent(dir: string, filename: string): Promise<void> {
    const fullPath = join(dir, filename);
    const ext = extname(filename).toLowerCase().slice(1);

    // Check if extension is watched
    if (!this.options.extensions.includes(ext)) return;

    // Check if already processed
    if (this.seenFiles.has(fullPath)) return;

    // Check if there's an active session
    if (!this.activeSession) {
      console.log(`[FileWatcher] File detected but no active session: ${filename}`);
      return;
    }

    // Small delay to ensure file is fully written
    await new Promise((resolve) => setTimeout(resolve, 100));

    const pendingFile = await this.createPendingFile(fullPath, filename);
    if (pendingFile) {
      this.seenFiles.add(fullPath);
      this.options.onFileDetected(pendingFile);
    }
  }

  private async createPendingFile(
    fullPath: string,
    filename: string
  ): Promise<PendingFile | null> {
    try {
      const stats = await stat(fullPath);
      if (!stats.isFile()) return null;

      const ext = extname(filename).toLowerCase().slice(1);

      return {
        id: randomUUID(),
        path: fullPath,
        filename: basename(filename),
        mimeType: getMimeType(ext),
        sizeBytes: stats.size,
        detectedAt: new Date().toISOString(),
        channelId: this.activeSession!.channelId,
        threadTs: this.activeSession!.threadTs,
        sessionId: this.activeSession!.sessionId,
        status: 'pending',
      };
    } catch {
      // File might have been deleted
      return null;
    }
  }
}

// Global file watcher instance
let globalFileWatcher: FileWatcher | null = null;

/**
 * Get or create the global file watcher
 */
export function getFileWatcher(): FileWatcher {
  if (!globalFileWatcher) {
    const homeDir = process.env.HOME || '/tmp';
    const downloadsDir = `${homeDir}/Downloads`;
    const paiDir = process.env.PAI_DIR || `${homeDir}/.claude`;
    const kbDir = `${paiDir}/kb`;

    globalFileWatcher = new FileWatcher({
      directories: [downloadsDir, kbDir],
      extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'md', 'txt'],
      onFileDetected: (file) => {
        console.log(`[FileWatcher] New file detected: ${file.filename} (${file.sizeBytes} bytes)`);
        // Files will be collected by the message handler
        pendingFilesQueue.push(file);
      },
    });
  }
  return globalFileWatcher;
}

// Queue for files detected during execution
export const pendingFilesQueue: PendingFile[] = [];

/**
 * Clear the pending files queue
 */
export function clearPendingFiles(): void {
  pendingFilesQueue.length = 0;
}

/**
 * Get and clear pending files
 */
export function getPendingFiles(): PendingFile[] {
  const files = [...pendingFilesQueue];
  clearPendingFiles();
  return files;
}
