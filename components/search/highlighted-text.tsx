import { splitHighlightedText } from "@/lib/ui/highlight";

interface HighlightedTextProps {
  text: string;
  query: string;
}

export function HighlightedText({ text, query }: HighlightedTextProps) {
  return splitHighlightedText(text, query).map((part, index) =>
    part.highlighted ? (
      <mark key={`${index}-${part.text}`}>{part.text}</mark>
    ) : (
      <span key={`${index}-${part.text}`}>{part.text}</span>
    ),
  );
}
