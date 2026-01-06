#!/usr/bin/env bun
// Test the Claude spawner independently

import { executeClaude, executeClaudeStreaming, extractText } from './src/services/claude';

const testMessage = process.argv[2] || 'Say hello in 10 words or less';

console.log('Testing Claude spawner...');
console.log(`Message: "${testMessage}"`);
console.log('---');

// Test streaming
console.log('\n=== Streaming Mode ===\n');

let fullText = '';
for await (const event of executeClaudeStreaming(testMessage, { model: 'haiku' })) {
  if (event.type === 'system' && event.subtype === 'init') {
    console.log(`Session: ${event.session_id}`);
  } else if (event.type === 'assistant' && event.message?.content) {
    const text = extractText(event.message.content);
    if (text && text !== fullText) {
      process.stdout.write(`\rResponse: ${text.slice(0, 80)}...`);
      fullText = text;
    }
  } else if (event.type === 'tool_use') {
    console.log(`\n[Tool: ${event.tool}]`);
  } else if (event.type === 'result') {
    console.log(`\n\nCost: $${event.cost_usd?.toFixed(4) || 'unknown'}`);
  }
}

console.log('\n\n=== Final Response ===\n');
console.log(fullText);
