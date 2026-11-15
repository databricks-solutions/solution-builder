/**
 * Streaming text helpers.
 *
 * The Databricks serving-endpoints streaming gateway occasionally returns
 * UTF-8 bytes the HTTP layer then re-decodes as Latin-1, which looks like
 * mojibake to the user. Re-encode before forwarding deltas.
 */
export function fixMojibake(s: string): string {
  if (!s) return s;
  // Only re-decode text that LOOKS like mojibake: Latin-1-range chars (0x80-0xFF) and nothing
  // above 0xFF. Correctly decoded text (’, →, emoji…) must pass through untouched — re-encoding
  // it as Latin-1 turns it into U+FFFD / dropped characters.
  if (/[^\u0000-\u00ff]/.test(s) || !/[\u0080-\u00ff]/.test(s)) return s;
  try {
    return Buffer.from(s, 'latin1').toString('utf8');
  } catch {
    /* fall through */
  }
  return s.replace(/[-ÿ]+/g, (seg) => {
    try {
      return Buffer.from(seg, 'latin1').toString('utf8');
    } catch {
      return seg;
    }
  });
}
