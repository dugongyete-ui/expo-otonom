export function cleanAgentText(raw: string): string {
  return raw
    .replace(/<co>([\s\S]*?)<\/co:[^>]*>/g, "$1")
    .replace(/<\/?co[^>]*>/g, "")
    .replace(/^\[[\w\s()&/]+\]\s+menangani langkah ini[^\n]*/gm, "")
    .replace(/^✓\s+.+$/gm, "")
    .replace(/^\[[\w\s()&/]+\]\s+.*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
