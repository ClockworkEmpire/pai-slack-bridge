// Convert GitHub-flavored markdown to Slack mrkdwn
// Copied from $PAI_DIR/hooks/lib/markdown-to-slack.ts

/**
 * Convert GitHub markdown to Slack mrkdwn format
 *
 * Conversions:
 * - **bold** → *bold*
 * - *italic* or _italic_ → _italic_
 * - ~~strike~~ → ~strike~
 * - `code` → `code` (unchanged)
 * - [text](url) → <url|text>
 * - # Header → *Header*
 * - Code blocks → preserved
 */
export function markdownToSlack(text: string): string {
  const NULL = '\x00';

  // Preserve code blocks
  const codeBlocks: string[] = [];
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `${NULL}CODEBLOCK${codeBlocks.length - 1}${NULL}`;
  });

  // Preserve inline code
  const inlineCode: string[] = [];
  text = text.replace(/`[^`]+`/g, (match) => {
    inlineCode.push(match);
    return `${NULL}INLINECODE${inlineCode.length - 1}${NULL}`;
  });

  // Convert **bold** to placeholder
  const boldTexts: string[] = [];
  text = text.replace(/\*\*([^*]+)\*\*/g, (_match, content) => {
    boldTexts.push(content);
    return `${NULL}BOLD${boldTexts.length - 1}${NULL}`;
  });

  // Convert __bold__ to placeholder
  text = text.replace(/__([^_]+)__/g, (_match, content) => {
    boldTexts.push(content);
    return `${NULL}BOLD${boldTexts.length - 1}${NULL}`;
  });

  // Convert *italic* to _italic_
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '_$1_');

  // Convert ~~strike~~ to ~strike~
  text = text.replace(/~~([^~]+)~~/g, '~$1~');

  // Convert [text](url) to <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Convert headers to bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Restore placeholders
  boldTexts.forEach((content, i) => {
    text = text.replace(`${NULL}BOLD${i}${NULL}`, `*${content}*`);
  });

  inlineCode.forEach((code, i) => {
    text = text.replace(`${NULL}INLINECODE${i}${NULL}`, code);
  });

  codeBlocks.forEach((block, i) => {
    text = text.replace(`${NULL}CODEBLOCK${i}${NULL}`, block);
  });

  return text;
}

/**
 * Strip system-reminder tags from text
 */
export function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/**
 * Truncate text for Slack (40k char limit) with ellipsis
 */
export function truncateForSlack(text: string, maxLength = 39000): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\n\n... _(truncated)_';
}

/**
 * Split long text into chunks for multiple messages
 */
export function splitForSlack(text: string, maxLength = 3500): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a double newline (paragraph break)
    let splitPoint = remaining.lastIndexOf('\n\n', maxLength);
    if (splitPoint < maxLength / 2) {
      // Try single newline
      splitPoint = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitPoint < maxLength / 2) {
      // No good newline found, split at space
      splitPoint = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitPoint < maxLength / 2) {
      // No good split point, just cut
      splitPoint = maxLength;
    }

    chunks.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(splitPoint).trim();
  }

  return chunks;
}
