const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b[()][0-9A-Za-z]|\x1b[^[]/g;

export function stripAnsi(raw: string): string {
  return raw.replace(ANSI_REGEX, "");
}

export function cleanText(raw: string): string {
  return raw
    .replace(/<co>([\s\S]*?)<\/co:[^>]*>/g, "$1")
    .replace(/<\/?co[^>]*>/g, "")
    .replace(/<citation[^>]*>[\s\S]*?<\/citation>/gi, "")
    .replace(/<\/?citation[^>]*>/gi, "")
    .replace(/<\/[A-Za-z][A-Za-z0-9]*(?::[^>]*)?>|<[A-Za-z][A-Za-z0-9]*(?:\s[^>]*)?>/g, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/^\[[\w\s()&/.\-\u00C0-\u024F\u0080-\uFFFF]+\]\s+menangani langkah ini[^\n]*/gm, "")
    .replace(/^✓\s+.+$/gm, "")
    .replace(/^\[[\w\s()&/.\-\u00C0-\u024F\u0080-\uFFFF]+\]\s+.*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanAgentText(raw: string): string {
  return cleanText(raw);
}

export function truncateSafe(str: string, maxChars: number): string {
  if (str.length <= maxChars) return str;
  const arr = Array.from(str);
  if (arr.length <= maxChars) return str;
  return arr.slice(0, maxChars).join("");
}
