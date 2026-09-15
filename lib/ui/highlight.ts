export interface HighlightPart {
  text: string;
  highlighted: boolean;
}

export function splitHighlightedText(text: string, rawQuery: string): HighlightPart[] {
  const query = rawQuery.trim();
  if (!query) return [{ text, highlighted: false }];

  const searchableText = text.toLocaleLowerCase();
  const searchableQuery = query.toLocaleLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = searchableText.indexOf(searchableQuery, cursor);
    if (matchIndex === -1) {
      parts.push({ text: text.slice(cursor), highlighted: false });
      break;
    }
    if (matchIndex > cursor) {
      parts.push({ text: text.slice(cursor, matchIndex), highlighted: false });
    }
    const matchEnd = matchIndex + query.length;
    parts.push({ text: text.slice(matchIndex, matchEnd), highlighted: true });
    cursor = matchEnd;
  }

  return parts.length > 0 ? parts : [{ text, highlighted: false }];
}
