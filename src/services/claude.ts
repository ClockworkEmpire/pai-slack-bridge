// Claude CLI spawner: executes claude in headless mode and streams output
import { spawn, type Subprocess } from 'bun';

export interface ClaudeOptions {
  sessionId?: string;   // For new sessions
  resumeId?: string;    // For resuming existing sessions
  cwd?: string;
  model?: string;
  permissionMode?: string;
}

export interface StreamEvent {
  type: 'system' | 'assistant' | 'user' | 'tool_use' | 'tool_result' | 'result';
  subtype?: string;
  session_id?: string;
  message?: {
    role?: string;
    content?: ContentBlock[];
  };
  tool?: string;
  tool_input?: unknown;
  result?: string;
  is_error?: boolean;
  cost_usd?: number;
}

export interface ContentBlock {
  type: string;
  text?: string;
  content?: string;
}

/**
 * Extract text from content blocks
 */
export function extractText(content: ContentBlock[] | undefined): string {
  if (!content) return '';
  return content
    .map(block => block.text || block.content || '')
    .join('')
    .trim();
}

/**
 * Execute Claude CLI and yield streaming events
 */
export async function* executeClaudeStreaming(
  message: string,
  options: ClaudeOptions
): AsyncGenerator<StreamEvent> {
  const paiDir = process.env.PAI_DIR || `${process.env.HOME}/.claude`;
  const cwd = options.cwd || process.env.BRIDGE_DEFAULT_CWD || paiDir;

  const settingsPath = `${paiDir}/settings.json`;

  // Reinforce structured output format for Slack responses
  const slackSystemPrompt = `CRITICAL OVERRIDE - SLACK CHANNEL RESPONSE FORMAT:

You are responding via the PAI Slack Bridge. The "short and concise" CLI instruction does NOT apply here.

MANDATORY: Use the CORE structured output format for EVERY response, regardless of complexity:
- Simple questions: USE STRUCTURED FORMAT
- "I can't do that" responses: USE STRUCTURED FORMAT
- Greetings: USE STRUCTURED FORMAT
- Everything: USE STRUCTURED FORMAT

Required sections for ALL responses:
📋 SUMMARY | 🔍 ANALYSIS | ⚡ ACTIONS | ✅ RESULTS | 📊 STATUS | 📁 CAPTURE | ➡️ NEXT | 📖 STORY EXPLANATION | 🎯 COMPLETED

The 🎯 COMPLETED line is spoken aloud via voice synthesis. Keep it 8-12 words, never start with "Completed".

This is a CONSTITUTIONAL requirement. No exceptions.`;

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', options.model || 'sonnet',
    '--permission-mode', options.permissionMode || 'acceptEdits',
    '--settings', settingsPath,
    '--append-system-prompt', slackSystemPrompt,
  ];

  // Session handling: resume existing or start new with specific ID
  if (options.resumeId) {
    args.push('--resume', options.resumeId);
  } else if (options.sessionId) {
    args.push('--session-id', options.sessionId);
  }

  // Add the message
  args.push(message);

  console.log(`[Claude] Spawning: claude ${args.join(' ')}`);
  console.log(`[Claude] CWD: ${cwd}`);
  console.log(`[Claude] PAI_DIR: ${paiDir}`);

  const proc = spawn(['claude', ...args], {
    cwd,
    env: {
      ...process.env,
      PAI_DIR: paiDir,  // Ensure PAI_DIR is set for hooks
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Read stdout line by line
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event: StreamEvent = JSON.parse(line);
          yield event;
        } catch {
          // Skip non-JSON lines (like verbose output)
          console.log(`[Claude] Non-JSON: ${line.slice(0, 100)}`);
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const event: StreamEvent = JSON.parse(buffer);
        yield event;
      } catch {
        console.log(`[Claude] Final non-JSON: ${buffer.slice(0, 100)}`);
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Wait for process to complete
  const exitCode = await proc.exited;
  console.log(`[Claude] Process exited with code: ${exitCode}`);

  // Check stderr for errors
  const stderrReader = proc.stderr.getReader();
  let stderr = '';
  try {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }
  } finally {
    stderrReader.releaseLock();
  }

  if (stderr) {
    console.error(`[Claude] Stderr: ${stderr}`);
  }
}

/**
 * Execute Claude CLI and return full response (non-streaming)
 */
export async function executeClaude(
  message: string,
  options: ClaudeOptions
): Promise<{ text: string; sessionId?: string; costUsd?: number }> {
  let fullText = '';
  let sessionId: string | undefined;
  let costUsd: number | undefined;

  for await (const event of executeClaudeStreaming(message, options)) {
    if (event.type === 'assistant' && event.message?.content) {
      fullText += extractText(event.message.content);
    }
    if (event.session_id) {
      sessionId = event.session_id;
    }
    if (event.type === 'result' && event.cost_usd) {
      costUsd = event.cost_usd;
    }
  }

  return { text: fullText, sessionId, costUsd };
}
