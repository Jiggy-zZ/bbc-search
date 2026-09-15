export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 100;

export type QueryValidity = "empty" | "too-short" | "valid" | "too-long";

export interface PreparedQuery {
  value: string;
  length: number;
  validity: QueryValidity;
}

export function prepareQuery(rawQuery: string): PreparedQuery {
  const value = rawQuery.trim();
  const length = Array.from(value).length;

  if (length === 0) return { value, length, validity: "empty" };
  if (length < SEARCH_QUERY_MIN_LENGTH) return { value, length, validity: "too-short" };
  if (length > SEARCH_QUERY_MAX_LENGTH) return { value, length, validity: "too-long" };
  return { value, length, validity: "valid" };
}
