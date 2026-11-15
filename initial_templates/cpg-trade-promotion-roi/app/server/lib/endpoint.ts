/**
 * Streaming text helpers.
 *
 * The Databricks serving-endpoints streaming gateway occasionally returns
 * UTF-8 bytes the HTTP layer then re-decodes as Latin-1, which looks like
 * mojibake to the user ("â€“" for "–"). Re-decode ONLY when the delta looks
 * like that: every char is in the Latin-1 range, at least one is non-ASCII,
 * and re-decoding yields valid UTF-8. A correctly-decoded delta ("–", "’",
 * "§", "°") is returned untouched — unconditionally re-decoding it destroys
 * every non-ASCII character (a lone "§" / "°" is not valid UTF-8 on its own,
 * and anything above U+00FF can't be Latin-1 mojibake at all).
 */
export function fixMojibake(s: string): string {
  if (!s) return s;
  let nonAscii = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return s; // outside Latin-1 → already correctly decoded
    if (c >= 0x80) nonAscii = true;
  }
  if (!nonAscii) return s;
  const out = Buffer.from(s, 'latin1').toString('utf8');
  // Not valid UTF-8 once re-encoded (e.g. a lone "§") → it wasn't mojibake.
  return out.includes(String.fromCharCode(0xfffd)) ? s : out;
}
