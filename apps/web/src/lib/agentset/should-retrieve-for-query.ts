const CONVERSATIONAL_PATTERNS = [
  /^(hi|hello|hey|hiya|howdy|yo|sup|thanks|thank you|thx|ok|okay|k|yes|no|yep|nope|sure|cool|nice|great|got it|understood|bye|goodbye|see you|cheers|welcome|good morning|good afternoon|good evening)[!.?…]*$/i,
];

const EMOJI_OR_PUNCTUATION_ONLY =
  /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}!?.…,;:()\-—–'"`~]+$/u;

export function shouldRetrieveForQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 3) return false;
  if (EMOJI_OR_PUNCTUATION_ONLY.test(trimmed)) return false;

  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  if (normalized.length <= 20) {
    for (const pattern of CONVERSATIONAL_PATTERNS) {
      if (pattern.test(normalized)) return false;
    }
  }

  return true;
}
