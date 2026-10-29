import type { ChatAttachment } from "app-types/chat";
import type { RouteSignals, RoutingTaskKey } from "./types";

/**
 * Tool nouns that are not ambiguous: an MCP server, a connector, or a product
 * that a connected server exposes. Checked before the keyword list below and
 * outranking it, because a message naming a bound tool is a tool request
 * whatever else it happens to say.
 *
 * The keyword list is first-match-wins, so a single stray word decided the
 * whole turn. Observed on staging 2026-09-03 12:02:57: "Funktioniert jetzt
 * hier die Aufnahme einwandfrei? ... check mal nach unserem Google Business
 * Profil" matched `coding` on the opening verb "Funktioniert" and routed to
 * claude-sonnet-5; `tool_calling` matched too ("MCP") but sat two entries
 * lower and never got the chance. The follow-up turn lost the same way to
 * `web_search` on "Google".
 *
 * Deliberately narrow. Bare `tools` and `crm` stay out: "Websuche: beste CRM
 * Tools" is a research request, and the keyword list already handles it.
 *
 * Only trusted when tools are actually bound. With none configured the
 * mention is prose about tools, not a request to use one.
 */
const EXPLICIT_TOOL_PATTERN =
  /\b(mcp|connectors?|konnektor\w*|gmail|hubspot|notion|slack|todoist|composio|open-?seo|search\s?console|business\s?profil\w*|google\s+(?:business|analytics|ads?|drive|docs?|sheets?|slides?|kalender|calendar|maps?|tasks?|forms?|workspace|meet|photos?))\b/i;

// Ordered list \u2014 first match wins, so specificity decides placement:
// document/table work before web_search ("extrahiere ... suche"), website
// building before generic coding keywords, business writing before the
// generic writing bucket, and web_search before tool_calling so research
// phrasing beats tool nouns like "CRM" or "Tools".
const TASK_PATTERNS: Array<{ taskKey: RoutingTaskKey; pattern: RegExp }> = [
  {
    taskKey: "document_extraction",
    pattern:
      /\b(extract\w*|extrahier\w*|auslesen|invoice|contract|vertrag|vertr\u00e4ge|pdf|spreadsheet|tabellenkalkulation|csv|xlsx?|excel|tabellen?|tables?|document|dokument\w*)\b/i,
  },
  {
    taskKey: "web_development",
    pattern:
      /\b(websites?|webseiten?|homepage|landing\s?pages?|landingpages?|web\s?apps?|webshop|onlineshop|html|css|tailwind|frontend)\b/i,
  },
  {
    taskKey: "coding",
    pattern:
      // `funktion(en)?` is bounded on purpose. `funktion\w*` also swallowed
      // "funktioniert" / "funktionieren" / "funktionsfähig" -- among the most
      // common verbs in German -- so any message asking whether something
      // works landed on `coding`. Compounds like "Funktionsname" are lost with
      // it; `functions?` still covers the concept and a rare miss is far
      // cheaper than misrouting every "funktioniert das?".
      /\b(code|coding|programmier\w*|typescript|javascript|python|bugs?|debug\w*|fehlermeldung\w*|refactor\w*|tests?|apis?|sql|skript\w*|scripts?|funktion(?:en)?|functions?)\b/i,
  },
  {
    taskKey: "web_search",
    pattern:
      /\b(websuche|web\s?search|search|such\w*|recherch\w*|google|im\s+internet|aktuelle?[nrs]?\s+(nachrichten|news|infos)|news)\b/i,
  },
  {
    taskKey: "tool_calling",
    pattern:
      /\b(connect|verbinde\w*|calendar|kalender|termin\w*|meetings?|besprechung\w*|appointments?|agenda|schedul\w*|availabilit\w*|verf(?:ü|ue)gbar\w*|inbox|posteingang|gmail|crm|hubspot|notion|slack|todoist|tools?|mcp|integration\w*|connector\w*|workflow\w*)\b/i,
  },
  {
    taskKey: "german_business_writing",
    pattern:
      /\b(deutsch\w*|german|gesch\u00e4ft\w*|geschaeft\w*|angebot\w*|rechnung\w*|kund(?:e|en|in|innen)|anschreiben)\b/i,
  },
  {
    taskKey: "writing",
    pattern:
      /\b(schreib\w*|verfass\w*|formulier\w*|umschreib\w*|texte?\w*|artikel|blog\w*|linkedin|posts?|newsletter|e-?mail|entwurf|zusammenfass\w*|write|draft|rewrite|essay|summar\w*|\u00fcbersetz\w*)\b/i,
  },
  {
    taskKey: "reasoning",
    pattern:
      /\b(analy[sz]\w*|reason\w*|compare|vergleich\w*|strateg\w*|plan\w*|decision|entscheid\w*|bewert\w*|schlussfolger\w*|durchdenk\w*)\b/i,
  },
];

export function extractRouteSignals(input: {
  text: string;
  attachments?: ChatAttachment[];
  toolCount: number;
  minimumContextTokens?: number;
  requiredRegion?: string;
  requiredRetention?: "zero" | "standard";
}): RouteSignals {
  const hasVisionAttachment = input.attachments?.some((attachment) =>
    attachment.mediaType?.startsWith("image/"),
  );

  if (hasVisionAttachment) {
    return {
      taskKey: "vision",
      requiresTools: input.toolCount > 0,
      requiresVision: true,
      minimumContextTokens: input.minimumContextTokens ?? 0,
      requiredRegion: input.requiredRegion,
      requiredRetention: input.requiredRetention,
    };
  }

  const requiresTools = input.toolCount > 0;
  if (requiresTools && EXPLICIT_TOOL_PATTERN.test(input.text)) {
    return {
      taskKey: "tool_calling",
      requiresTools: true,
      requiresVision: false,
      minimumContextTokens: input.minimumContextTokens ?? 0,
      requiredRegion: input.requiredRegion,
      requiredRetention: input.requiredRetention,
    };
  }

  const matched = TASK_PATTERNS.find(({ pattern }) => pattern.test(input.text));

  return {
    taskKey: matched?.taskKey ?? "general_chat",
    requiresTools,
    requiresVision: false,
    minimumContextTokens: input.minimumContextTokens ?? 0,
    requiredRegion: input.requiredRegion,
    requiredRetention: input.requiredRetention,
  };
}
