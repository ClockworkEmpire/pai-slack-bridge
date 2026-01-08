// File uploader service - uploads files to Slack threads
import { readFile } from 'fs/promises';
import { getSlackClient } from './slack';
import type { PendingFile } from '../types/files';
import type { ChannelConfig } from '../types/config';

interface UploadResult {
  success: boolean;
  slackFileId?: string;
  error?: string;
}

/**
 * Upload a single file to Slack
 */
export async function uploadFileToSlack(
  file: PendingFile,
  channelConfig: ChannelConfig
): Promise<UploadResult> {
  const client = getSlackClient();

  // Validate file size
  const maxBytes = channelConfig.maxFileSizeMb * 1024 * 1024;
  if (file.sizeBytes > maxBytes) {
    return {
      success: false,
      error: `File exceeds maximum size of ${channelConfig.maxFileSizeMb}MB`,
    };
  }

  // Validate file type
  const ext = file.filename.split('.').pop()?.toLowerCase();
  if (ext && !channelConfig.allowedFileTypes.includes(ext)) {
    return {
      success: false,
      error: `File type .${ext} not allowed in this channel`,
    };
  }

  try {
    console.log(`[FileUploader] Uploading ${file.filename} to ${file.channelId}`);

    const fileData = await readFile(file.path);

    // Use files.uploadV2 for better reliability
    const result = await client.files.uploadV2({
      channel_id: file.channelId,
      thread_ts: file.threadTs,
      file: fileData,
      filename: file.filename,
      initial_comment: `Generated: ${file.filename}`,
    });

    // Type the result properly - uploadV2 returns a different structure
    const uploadResult = result as {
      ok: boolean;
      files?: Array<{
        ok?: boolean;
        files?: Array<{ id?: string }>;
      }>;
    };

    // Check for success
    if (uploadResult.ok && uploadResult.files && uploadResult.files.length > 0) {
      const uploadedFile = uploadResult.files[0];
      if (uploadedFile.files && uploadedFile.files.length > 0) {
        const slackFileId = uploadedFile.files[0].id;
        console.log(`[FileUploader] Upload successful: ${slackFileId}`);
        return {
          success: true,
          slackFileId,
        };
      }
    }

    // Fallback - check if upload went through
    if (uploadResult.ok) {
      console.log('[FileUploader] Upload completed but no file ID returned');
      return {
        success: true,
        slackFileId: 'unknown',
      };
    }

    return {
      success: false,
      error: 'Upload failed with unknown error',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown upload error';
    console.error(`[FileUploader] Upload failed: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Upload multiple files to a thread
 */
export async function uploadFilesToThread(
  files: PendingFile[],
  channelConfig: ChannelConfig
): Promise<Map<string, UploadResult>> {
  const results = new Map<string, UploadResult>();

  if (files.length === 0) {
    return results;
  }

  console.log(`[FileUploader] Uploading ${files.length} files`);

  // Upload sequentially to avoid rate limits
  for (const file of files) {
    const result = await uploadFileToSlack(file, channelConfig);
    results.set(file.id, result);

    // Update file status
    file.status = result.success ? 'uploaded' : 'failed';
    if (result.slackFileId) {
      file.slackFileId = result.slackFileId;
    }
    if (result.error) {
      file.error = result.error;
    }

    // Small delay between uploads to respect rate limits
    if (files.indexOf(file) < files.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const successCount = Array.from(results.values()).filter((r) => r.success).length;
  console.log(`[FileUploader] Completed: ${successCount}/${files.length} successful`);

  return results;
}

/**
 * Filter files by allowed types for a channel
 */
export function filterAllowedFiles(
  files: PendingFile[],
  channelConfig: ChannelConfig
): { allowed: PendingFile[]; rejected: PendingFile[] } {
  const allowed: PendingFile[] = [];
  const rejected: PendingFile[] = [];

  for (const file of files) {
    const ext = file.filename.split('.').pop()?.toLowerCase();
    const sizeOk = file.sizeBytes <= channelConfig.maxFileSizeMb * 1024 * 1024;
    const typeOk = ext && channelConfig.allowedFileTypes.includes(ext);

    if (sizeOk && typeOk) {
      allowed.push(file);
    } else {
      rejected.push(file);
    }
  }

  return { allowed, rejected };
}
