const AGENTSET_FIGURE_URL_RE =
  /!\[[^\]]*\]\((https?:\/\/files\.agentset\.ai[^)]+)\)/g;

export function extractFigureUrls(text: string): string[] {
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  AGENTSET_FIGURE_URL_RE.lastIndex = 0;
  while ((match = AGENTSET_FIGURE_URL_RE.exec(text)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}
