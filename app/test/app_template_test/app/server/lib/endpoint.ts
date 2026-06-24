/**
 * Streaming text helpers.
 *
 * The Databricks serving-endpoints streaming gateway occasionally returns
 * UTF-8 bytes the HTTP layer then re-decodes as Latin-1, which looks like
 * mojibake to the user. Re-encode before forwarding deltas.
 */
export function fixMojibake(s: string): string {
  if (!s) return s;
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
