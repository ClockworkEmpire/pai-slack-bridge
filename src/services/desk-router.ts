// Desk router - detects @mentions and routes to appropriate desks
import { getAllDesks, getDefaultDesk } from './desk-loader';
import type { DeskDefinition, DeskRouteResult } from '../types/desk';

/**
 * Extract all @mentions from a message
 * Looks for patterns like @backend, @api, etc. (not Slack user mentions)
 */
export function extractMentions(message: string): string[] {
  // Match @word patterns that aren't Slack user IDs (<@U...>)
  const mentionPattern = /@([a-zA-Z][a-zA-Z0-9_-]*)/g;
  const mentions: string[] = [];
  let match;

  while ((match = mentionPattern.exec(message)) !== null) {
    mentions.push(`@${match[1].toLowerCase()}`);
  }

  return [...new Set(mentions)]; // Dedupe
}

/**
 * Route a message to matching desks based on @mentions
 * Returns all desks that match any @mention in the message
 */
export function routeMessage(message: string): DeskRouteResult[] {
  const mentions = extractMentions(message);
  const desks = getAllDesks();
  const results: DeskRouteResult[] = [];

  // Check each desk for matching mentions
  for (const desk of desks) {
    for (const deskMention of desk.routing.mentions) {
      const normalizedDeskMention = deskMention.toLowerCase();

      for (const messageMention of mentions) {
        if (messageMention === normalizedDeskMention) {
          results.push({
            desk,
            matchedMention: messageMention,
          });
          break; // Only match once per desk
        }
      }
    }
  }

  return results;
}

/**
 * Get desks for a message, falling back to default if no @mentions
 */
export function getDesksForMessage(message: string): DeskRouteResult[] {
  const routed = routeMessage(message);

  // If no specific desks matched, try default desk
  if (routed.length === 0) {
    const defaultDesk = getDefaultDesk();
    if (defaultDesk) {
      return [{
        desk: defaultDesk,
        matchedMention: '',
      }];
    }
  }

  return routed;
}

/**
 * Check if a message contains any desk @mentions
 */
export function hasDeskMention(message: string): boolean {
  const mentions = extractMentions(message);
  const desks = getAllDesks();

  for (const mention of mentions) {
    for (const desk of desks) {
      if (desk.routing.mentions.some(m => m.toLowerCase() === mention)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Remove desk @mentions from a message (for cleaner prompts)
 */
export function removeDeskMentions(message: string, desks: DeskRouteResult[]): string {
  let cleaned = message;

  for (const { matchedMention } of desks) {
    if (matchedMention) {
      // Remove the @mention with optional surrounding whitespace
      const pattern = new RegExp(`\\s*${matchedMention}\\s*`, 'gi');
      cleaned = cleaned.replace(pattern, ' ');
    }
  }

  return cleaned.trim();
}
