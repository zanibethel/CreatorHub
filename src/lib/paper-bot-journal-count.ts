/** Parses PostgREST's exact HEAD count (e.g. "0-0/123" or the empty-range form). */
export function parsePostgrestExactCount(contentRange:string|null):number {
  const match=contentRange?.match(/\/(\d+)$/);
  if(!match)throw new Error("Journal count response was missing the exact total.");
  const total=Number(match[1]);
  if(!Number.isSafeInteger(total)||total<0)throw new Error("Journal count was invalid.");
  return total;
}
