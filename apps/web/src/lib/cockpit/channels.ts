/**
 * Acquisition channels written by the marketing site's first-party collector
 * into `site_events.channel`. Only the vocabulary lives here: the classifier
 * runs on the marketing site, Navigator just reads and labels the rows.
 */

export const CHANNELS = [
  "google_ads",
  "google",
  "bing",
  "linkedin_ads",
  "linkedin",
  "reddit_ads",
  "reddit",
  "meta_ads",
  "meta",
  "x",
  "youtube",
  "chatgpt",
  "perplexity",
  "claude",
  "gemini",
  "copilot",
  "newsletter",
  "referral",
  "direct",
] as const;

export type Channel = (typeof CHANNELS)[number];

/** Brand and product names; identical in every locale. */
export const CHANNEL_LABELS: Record<Channel, string> = {
  google_ads: "Google Ads",
  google: "Google Search",
  bing: "Bing",
  linkedin_ads: "LinkedIn Ads",
  linkedin: "LinkedIn",
  reddit_ads: "Reddit Ads",
  reddit: "Reddit",
  meta_ads: "Meta Ads",
  meta: "Facebook / Instagram",
  x: "X",
  youtube: "YouTube",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  newsletter: "Newsletter / Email",
  referral: "Referral",
  direct: "Direct",
};

/** Channels that come from an AI assistant rather than a search engine. */
export const AI_CHANNELS: readonly Channel[] = [
  "chatgpt",
  "perplexity",
  "claude",
  "gemini",
  "copilot",
];

export function isChannel(value: unknown): value is Channel {
  return (
    typeof value === "string" && (CHANNELS as readonly string[]).includes(value)
  );
}
