// Bridge API: lightweight HTTP server for Claude-to-Slack file sending, messages, and buttons
import { getSlackClient } from './slack';
import { getSessionBySessionId } from './session';
import type { SlackBlock } from '../types/slack';

const API_PORT = parseInt(process.env.BRIDGE_API_PORT || '3848', 10);
const API_SECRET = process.env.BRIDGE_API_SECRET || '';

/**
 * Validate the Authorization header
 */
function isAuthorized(request: Request): boolean {
  if (!API_SECRET) return true; // No secret = open (local only)
  const auth = request.headers.get('Authorization');
  return auth === `Bearer ${API_SECRET}`;
}

/**
 * Create a JSON response
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Start the Bridge API HTTP server
 */
export function startBridgeApi(): { server: ReturnType<typeof Bun.serve>; port: number } {
  const server = Bun.serve({
    port: API_PORT,
    async fetch(request) {
      const url = new URL(request.url);
      const method = request.method;

      // Health check
      if (method === 'GET' && url.pathname === '/health') {
        return jsonResponse({ status: 'ok', version: '0.1.0' });
      }

      // Auth check for all other endpoints
      if (!isAuthorized(request)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // POST /send-file — upload a local file to a Slack thread
      if (method === 'POST' && url.pathname === '/send-file') {
        return handleSendFile(request);
      }

      // POST /send-message — post a message (optionally with blocks) to a Slack thread
      if (method === 'POST' && url.pathname === '/send-message') {
        return handleSendMessage(request);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    },
  });

  console.log(`[BridgeAPI] HTTP server running on port ${API_PORT}`);
  return { server, port: API_PORT };
}

/**
 * Handle POST /send-file
 * Body: { sessionId, filePath, comment? }
 */
async function handleSendFile(request: Request): Promise<Response> {
  let body: { sessionId?: string; filePath?: string; comment?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { sessionId, filePath, comment } = body;

  if (!sessionId || !filePath) {
    return jsonResponse({ error: 'Missing required fields: sessionId, filePath' }, 400);
  }

  const session = getSessionBySessionId(sessionId);
  if (!session) {
    return jsonResponse({ error: `Session not found: ${sessionId}` }, 404);
  }

  try {
    const file = Bun.file(filePath);
    if (!await file.exists()) {
      return jsonResponse({ error: `File not found: ${filePath}` }, 404);
    }

    const client = getSlackClient();
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await client.filesUploadV2({
      channel_id: session.channelId,
      thread_ts: session.threadTs,
      file: buffer,
      filename: filePath.split('/').pop() || 'file',
      initial_comment: comment || undefined,
    });

    console.log(`[BridgeAPI] Uploaded file ${filePath} to ${session.channelId}:${session.threadTs}`);
    return jsonResponse({ ok: true, ok_result: true });
  } catch (error) {
    console.error('[BridgeAPI] File upload failed:', error);
    return jsonResponse(
      { error: `Upload failed: ${error instanceof Error ? error.message : 'unknown'}` },
      500
    );
  }
}

/**
 * Handle POST /send-message
 * Body: { sessionId, text?, blocks? }
 */
async function handleSendMessage(request: Request): Promise<Response> {
  let body: { sessionId?: string; text?: string; blocks?: SlackBlock[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { sessionId, text, blocks } = body;

  if (!sessionId) {
    return jsonResponse({ error: 'Missing required field: sessionId' }, 400);
  }

  if (!text && !blocks) {
    return jsonResponse({ error: 'Must provide text or blocks (or both)' }, 400);
  }

  const session = getSessionBySessionId(sessionId);
  if (!session) {
    return jsonResponse({ error: `Session not found: ${sessionId}` }, 404);
  }

  try {
    const client = getSlackClient();
    const result = await client.chat.postMessage({
      channel: session.channelId,
      thread_ts: session.threadTs,
      text: text || '',
      blocks: blocks as any,
    });

    console.log(`[BridgeAPI] Posted message to ${session.channelId}:${session.threadTs}`);
    return jsonResponse({ ok: true, ts: result.ts });
  } catch (error) {
    console.error('[BridgeAPI] Message post failed:', error);
    return jsonResponse(
      { error: `Post failed: ${error instanceof Error ? error.message : 'unknown'}` },
      500
    );
  }
}
