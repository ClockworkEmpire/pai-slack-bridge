// Request classifier - categorize incoming messages by task type
import type { TaskCapability } from '../types/config';

export type TaskCategory = 'copy' | 'briefs' | 'visuals' | 'research' | 'general';

export interface ClassificationResult {
  category: TaskCategory;
  confidence: number; // 0-1
  keywords: string[];
  suggestedSkills: string[];
}

interface CategoryConfig {
  patterns: RegExp[];
  keywords: string[];
  skills: string[];
}

const CATEGORY_PATTERNS: Record<Exclude<TaskCategory, 'general'>, CategoryConfig> = {
  copy: {
    patterns: [
      /\b(write|draft|copy|text|headline|tagline|email|subject line|cta|call to action)\b/i,
      /\b(rewrite|edit|revise|polish|refine)\b.*\b(copy|text|content)\b/i,
      /\b(blog post|article|press release|newsletter|ad copy|social media post)\b/i,
      /\b(caption|description|bio|about us|slogan)\b/i,
    ],
    keywords: ['write', 'draft', 'copy', 'text', 'headline', 'tagline', 'email', 'cta', 'blog', 'article', 'newsletter'],
    skills: ['ContentAssets'],
  },
  briefs: {
    patterns: [
      /\b(brief|outline|plan|strategy|framework|structure)\b/i,
      /\b(content brief|creative brief|project brief|campaign brief)\b/i,
      /\b(topic brief|synthesis|summarize topic)\b/i,
      /\b(planning|roadmap|proposal)\b/i,
    ],
    keywords: ['brief', 'outline', 'plan', 'strategy', 'framework', 'synthesis', 'proposal', 'roadmap'],
    skills: ['ContentAssets', 'KnowledgeBase'],
  },
  visuals: {
    patterns: [
      /\b(infographic|diagram|visual|image|illustration|graphic)\b/i,
      /\b(create|generate|make)\b.*\b(image|visual|diagram|infographic)\b/i,
      /\b(lead magnet|pdf|multi-page)\b/i,
      /\b(chalkboard|whiteboard|pencil sketch|colored pencil)\b.*\bstyle\b/i,
      /\b(chart|flowchart|process diagram|architecture diagram)\b/i,
    ],
    keywords: ['infographic', 'diagram', 'visual', 'image', 'illustration', 'graphic', 'lead magnet', 'chart', 'flowchart'],
    skills: ['Art'],
  },
  research: {
    patterns: [
      /\b(research|find|search|look up|investigate)\b/i,
      /\b(kb search|knowledge base|find related|similar)\b/i,
      /\b(what do we know about|summarize|analyze)\b/i,
      /\b(competitor|market|industry)\b.*\b(analysis|research|intel)\b/i,
      /\b(find out|discover|explore)\b/i,
    ],
    keywords: ['research', 'find', 'search', 'investigate', 'analyze', 'summarize', 'discover', 'explore', 'analysis'],
    skills: ['KnowledgeBase'],
  },
};

/**
 * Classify user request into task category
 */
export function classifyRequest(text: string): ClassificationResult {
  const normalizedText = text.toLowerCase();
  const results: { category: TaskCategory; score: number; keywords: string[] }[] = [];

  for (const [category, config] of Object.entries(CATEGORY_PATTERNS)) {
    let score = 0;
    const matchedKeywords: string[] = [];

    // Check patterns (weighted higher)
    for (const pattern of config.patterns) {
      if (pattern.test(normalizedText)) {
        score += 2;
      }
    }

    // Check keywords
    for (const keyword of config.keywords) {
      if (normalizedText.includes(keyword)) {
        score += 1;
        matchedKeywords.push(keyword);
      }
    }

    if (score > 0) {
      results.push({
        category: category as TaskCategory,
        score,
        keywords: matchedKeywords,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  if (results.length === 0) {
    return {
      category: 'general',
      confidence: 0,
      keywords: [],
      suggestedSkills: [],
    };
  }

  const best = results[0];
  const config = CATEGORY_PATTERNS[best.category as Exclude<TaskCategory, 'general'>];
  const maxPossibleScore = config.patterns.length * 2 + config.keywords.length;

  return {
    category: best.category,
    confidence: Math.min(best.score / maxPossibleScore, 1),
    keywords: best.keywords,
    suggestedSkills: config.skills,
  };
}

/**
 * Check if request is allowed for channel capabilities
 */
export function isRequestAllowed(
  classification: ClassificationResult,
  capabilities: TaskCapability[]
): { allowed: boolean; reason?: string } {
  // General requests are always allowed (no specific category detected)
  if (classification.category === 'general') {
    return { allowed: true };
  }

  const capability = capabilities.find((c) => c.name === classification.category);

  if (!capability) {
    return {
      allowed: false,
      reason: `This channel is not configured for ${classification.category} requests. Available: ${capabilities.filter(c => c.enabled).map(c => c.name).join(', ') || 'none'}.`,
    };
  }

  if (!capability.enabled) {
    return {
      allowed: false,
      reason: `${classification.category} requests are disabled in this channel.`,
    };
  }

  return { allowed: true };
}

/**
 * Get human-readable category name
 */
export function getCategoryDisplayName(category: TaskCategory): string {
  const names: Record<TaskCategory, string> = {
    copy: 'Copywriting',
    briefs: 'Content Briefs',
    visuals: 'Visual Content',
    research: 'Research',
    general: 'General',
  };
  return names[category];
}
