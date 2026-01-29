// Download Slack file attachments to local temp directory for Claude processing
import { mkdirSync, existsSync, unlinkSync, rmSync } from 'fs';
import { extname } from 'path';
import type { SlackFile } from '../types/slack';
import { SUPPORTED_INBOUND_EXTENSIONS, MAX_INBOUND_FILE_SIZE } from '../types/slack';

const TEMP_BASE = '/tmp/slack-bridge-files';

/**
 * Get the download URL for a Slack file.
 * Always use url_private_download or url_private — thumbnail URLs don't accept Bearer auth.
 */
function getDownloadUrl(file: SlackFile): string {
  return file.url_private_download || file.url_private;
}

/**
 * Get file extension from a SlackFile
 */
function getExtension(file: SlackFile): string {
  if (file.filetype) return file.filetype.toLowerCase();
  const ext = extname(file.name).replace('.', '').toLowerCase();
  return ext;
}

/**
 * Check if a file is supported for download
 */
function isSupported(file: SlackFile): { supported: boolean; reason?: string } {
  const ext = getExtension(file);
  if (!SUPPORTED_INBOUND_EXTENSIONS.has(ext)) {
    return { supported: false, reason: `unsupported type: .${ext}` };
  }
  if (file.size > MAX_INBOUND_FILE_SIZE) {
    return { supported: false, reason: `too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 10MB)` };
  }
  return { supported: true };
}

/**
 * Download a single Slack file to the session temp directory
 */
export async function downloadSlackFile(
  file: SlackFile,
  destDir: string,
  botToken: string
): Promise<{ path: string } | { skipped: true; reason: string }> {
  const check = isSupported(file);
  if (!check.supported) {
    console.log(`[SlackFiles] Skipping ${file.name}: ${check.reason}`);
    return { skipped: true, reason: check.reason! };
  }

  // Ensure dest directory exists
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const url = getDownloadUrl(file);
  const destPath = `${destDir}/${file.name}`;

  console.log(`[SlackFiles] Downloading ${file.name} from: ${url.slice(0, 80)}...`);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${botToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const buffer = await response.arrayBuffer();

    // Verify we got actual file content, not an HTML page
    const firstBytes = new Uint8Array(buffer.slice(0, 15));
    const firstChars = new TextDecoder().decode(firstBytes);
    if (firstChars.startsWith('<!DOCTYPE') || firstChars.startsWith('<html')) {
      throw new Error(`Got HTML instead of file content (content-type: ${contentType})`);
    }

    await Bun.write(destPath, buffer);

    console.log(`[SlackFiles] Downloaded ${file.name} (${(buffer.byteLength / 1024).toFixed(1)}KB, ${contentType}) -> ${destPath}`);
    return { path: destPath };
  } catch (error) {
    console.error(`[SlackFiles] Failed to download ${file.name}:`, error);
    return { skipped: true, reason: `download failed: ${error instanceof Error ? error.message : 'unknown'}` };
  }
}

/**
 * Download all supported files from a Slack message
 * Returns array of local file paths and any skip reasons
 */
export async function downloadMessageFiles(
  files: SlackFile[],
  sessionId: string,
  botToken: string
): Promise<{ paths: string[]; warnings: string[] }> {
  const destDir = `${TEMP_BASE}/${sessionId}`;
  const paths: string[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const result = await downloadSlackFile(file, destDir, botToken);
    if ('path' in result) {
      paths.push(result.path);
    } else {
      warnings.push(`${file.name}: ${result.reason}`);
    }
  }

  return { paths, warnings };
}

/**
 * Build a text prefix describing attached files for Claude
 */
export function buildFilePrefix(paths: string[], warnings: string[]): string {
  const parts: string[] = [];

  if (paths.length > 0) {
    parts.push(paths.map(p => `[Attached: ${p}]`).join('\n'));
  }

  if (warnings.length > 0) {
    parts.push(`[Skipped attachments: ${warnings.join('; ')}]`);
  }

  return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
}

/**
 * Clean up temp files for a session
 */
export function cleanupSessionFiles(sessionId: string): void {
  const dir = `${TEMP_BASE}/${sessionId}`;
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      console.log(`[SlackFiles] Cleaned up temp files for session ${sessionId}`);
    }
  } catch (error) {
    console.error(`[SlackFiles] Cleanup failed for ${sessionId}:`, error);
  }
}
