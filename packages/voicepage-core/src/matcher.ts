import { DomTarget, MatchType, VoicePageConfig } from './types.js';
import { normalizeLabel } from './normalize.js';

export interface MatchResult {
  type: 'exact' | 'fuzzy';
  target: DomTarget;
  score: number;
}

export interface ResolutionResult {
  status: 'unique' | 'ambiguous' | 'no_match' | 'misconfiguration';
  matches: MatchResult[];
  details?: unknown;
}

/**
 * Levenshtein distance for fuzzy matching.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzySimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Check for duplicate labels (misconfiguration detection).
 */
function findDuplicateLabels(targets: DomTarget[]): Map<string, DomTarget[]> {
  const labelMap = new Map<string, DomTarget[]>();
  for (const t of targets) {
    const existing = labelMap.get(t.normalizedLabel) ?? [];
    existing.push(t);
    labelMap.set(t.normalizedLabel, existing);
  }
  const dupes = new Map<string, DomTarget[]>();
  for (const [label, group] of labelMap) {
    if (group.length > 1) dupes.set(label, group);
  }
  return dupes;
}

/**
 * Resolve transcript to targets using exact + fuzzy matching.
 */
export function resolveTarget(
  transcript: string,
  targets: DomTarget[],
  config: VoicePageConfig,
): ResolutionResult {
  const normalizedTranscript = normalizeLabel(transcript);

  // Check for misconfiguration first (if policy = error)
  if (config.collisionPolicy === 'error') {
    const dupes = findDuplicateLabels(targets);
    if (dupes.size > 0) {
      return {
        status: 'misconfiguration',
        matches: [],
        details: {
          duplicateLabels: Object.fromEntries(
            Array.from(dupes.entries()).map(([label, ts]) => [
              label,
              ts.map((t) => t.id),
            ]),
          ),
        },
      };
    }
  }

  // 1. Exact match on normalized label or synonyms
  const exactMatches: MatchResult[] = [];
  for (const t of targets) {
    if (t.normalizedLabel === normalizedTranscript) {
      exactMatches.push({ type: 'exact', target: t, score: 1.0 });
    } else if (t.synonyms.includes(normalizedTranscript)) {
      exactMatches.push({ type: 'exact', target: t, score: 1.0 });
    }
  }

  if (exactMatches.length === 1) {
    return { status: 'unique', matches: exactMatches };
  }
  if (exactMatches.length > 1) {
    if (config.collisionPolicy === 'disambiguate') {
      return { status: 'ambiguous', matches: exactMatches };
    }
    return {
      status: 'misconfiguration',
      matches: exactMatches,
      details: { reason: 'duplicate exact matches' },
    };
  }

  // 2. Fuzzy match
  const fuzzyScores: MatchResult[] = [];
  for (const t of targets) {
    let bestScore = fuzzySimilarity(normalizedTranscript, t.normalizedLabel);
    for (const syn of t.synonyms) {
      bestScore = Math.max(bestScore, fuzzySimilarity(normalizedTranscript, syn));
    }
    if (bestScore >= config.fuzzyThreshold) {
      fuzzyScores.push({ type: 'fuzzy', target: t, score: bestScore });
    }
  }

  fuzzyScores.sort((a, b) => b.score - a.score);

  if (fuzzyScores.length === 0) {
    return { status: 'no_match', matches: [] };
  }

  if (fuzzyScores.length === 1) {
    return { status: 'unique', matches: [fuzzyScores[0]] };
  }

  // Check margin between top two
  const margin = fuzzyScores[0].score - fuzzyScores[1].score;
  if (margin >= config.fuzzyMargin) {
    return { status: 'unique', matches: [fuzzyScores[0]] };
  }

  return { status: 'ambiguous', matches: fuzzyScores };
}
