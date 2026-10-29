/**
 * Fuzzy search algorithm for filtering and scoring items
 */

export interface SearchItem {
  id: string;
  label: string;
}

export interface ScoredItem<T extends SearchItem> {
  item: T;
  score: number;
}

/**
 * Performs a fuzzy search on items based on a query string
 * Normalizes text, removes special characters, and calculates similarity scores
 */
export function fuzzySearch<T extends SearchItem>(
  items: T[],
  query: string,
): T[] {
  if (!query.trim()) return items;

  const normalizedQuery = query.toLowerCase().replace(/[^\w]/g, ""); // Remove special characters and spaces

  if (!normalizedQuery) return items;

  // Store results with scores for each item
  const scoredItems = items.map((item) => {
    const normalizedId = item.id.toLowerCase().replace(/[^\w]/g, "");
    const normalizedLabel = item.label.toLowerCase().replace(/[^\w]/g, "");

    // Check for exact matches
    const exactIdMatch = normalizedId.includes(normalizedQuery);
    const exactLabelMatch = normalizedLabel.includes(normalizedQuery);

    // Simple string similarity check instead of Levenshtein distance
    let idSimilarity = 0;
    let labelSimilarity = 0;

    // n-gram based similarity check for queries with 2+ characters
    if (normalizedQuery.length >= 2) {
      // Check for matching bigrams in ID
      for (let i = 0; i < normalizedId.length - 1; i++) {
        const bigram = normalizedId.slice(i, i + 2);
        if (normalizedQuery.includes(bigram)) {
          idSimilarity += 1;
        }
      }

      // Check for matching bigrams in label
      for (let i = 0; i < normalizedLabel.length - 1; i++) {
        const bigram = normalizedLabel.slice(i, i + 2);
        if (normalizedQuery.includes(bigram)) {
          labelSimilarity += 1;
        }
      }
    }

    // Calculate score (priority: exact match > similarity)
    let score = 0;

    if (exactIdMatch) score += 100;
    if (exactLabelMatch) score += 80;
    score += idSimilarity * 2;
    score += labelSimilarity;

    return { item, score };
  });

  // Minimum score threshold
  const minScore = 1;

  // Filter by score and sort by highest score first
  return scoredItems
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}
