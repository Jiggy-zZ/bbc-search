const UNICODE_APOSTROPHES = /[‘’ʼ＇]/gu;
const REPEATED_WHITESPACE = /\s+/gu;

function normalizeWhitespaceAndApostrophes(value: string): string {
  return value
    .replace(UNICODE_APOSTROPHES, "'")
    .replace(REPEATED_WHITESPACE, " ")
    .trim();
}

export function normalizeEnglishSearchText(value: string): string {
  return normalizeWhitespaceAndApostrophes(value).toLowerCase();
}

export function normalizeChineseSearchText(value: string): string {
  return normalizeWhitespaceAndApostrophes(value);
}

export function normalizeSearchQuery(value: string): string {
  return normalizeEnglishSearchText(value);
}

export function normalizedCharacterCount(value: string): number {
  return Array.from(value).length;
}
