// File tracking types for asset upload

export type FileStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface PendingFile {
  id: string;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  detectedAt: string; // ISO8601
  channelId: string;
  threadTs: string;
  sessionId: string;
  status: FileStatus;
  slackFileId?: string;
  error?: string;
}

export interface PendingFilesStore {
  files: PendingFile[];
}

export const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  md: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
};

export function getMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}
