/**
 * Streaming text helpers.
 *
 * The Databricks serving-endpoints streaming gateway occasionally returns
 * UTF-8 bytes the HTTP layer then re-decodes as Latin-1, which looks like
 * mojibake to the user ("â€“" for "–"). Re-decode ONLY when the delta looks
 * like that: every char is in the Latin-1 range, at least one is non-ASCII,
 * and re-decoding yields valid UTF-8. A correctly-decoded delta ("–", "’",
 * "§") is returned untouched — unconditionally re-decoding it destroys every
 * non-ASCII character.
 */
export function fixMojibake(s: string): string {
  if (!s || !/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const out = Buffer.from(s, 'latin1').toString('utf8');
  return out.includes('�') ? s : out;
}
