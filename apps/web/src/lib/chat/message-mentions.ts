export type MessageMentionPart = {
  type: "agent" | "tool" | "workflow";
  name: string;
  text: string;
  start: number;
};

export type MessageTextPart = {
  type: "text";
  text: string;
  start: number;
};

/** Read the labels emitted by the composer without changing the saved text. */
export function parseMessageMentions(
  text: string,
): (MessageTextPart | MessageMentionPart)[] {
  const parts: (MessageTextPart | MessageMentionPart)[] = [];
  // App tools use single quotes; agents, MCP tools and workflows use double
  // quotes. A quote inside a name is not a delimiter unless followed by `)`.
  const pattern = /@(agent|tool|workflow)\((["'])([^\r\n]+?)\2\)/g;
  let offset = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) {
      parts.push({
        type: "text",
        text: text.slice(offset, match.index),
        start: offset,
      });
    }
    parts.push({
      type: match[1] as MessageMentionPart["type"],
      name: match[3],
      text: match[0],
      start: match.index,
    });
    offset = match.index + match[0].length;
  }

  if (offset < text.length) {
    parts.push({ type: "text", text: text.slice(offset), start: offset });
  }
  return parts;
}

/** Keep a mention intact when the collapsed prompt ends inside its label. */
export function truncateMessageMentions(
  text: string,
  maxLength: number,
): string {
  if (text.length <= maxLength) return text;
  const mention = parseMessageMentions(text).find(
    (part) =>
      part.type !== "text" &&
      part.start < maxLength &&
      part.start + part.text.length > maxLength,
  );
  const end = mention ? mention.start + mention.text.length : maxLength;
  return text.slice(0, end) + "...";
}
