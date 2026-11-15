/**
 * Streaming text helpers.
 *
 * The Databricks serving-endpoints streaming gateway occasionally returns
 * UTF-8 bytes the HTTP layer then re-decodes as Latin-1, which looks like
 * mojibake to the user. Re-encode before forwarding deltas — but ONLY when
 * the text actually looks like mojibake. Correctly-decoded text containing
 * characters above U+00FF (’ — “ ”) must pass through untouched: a blind
 * latin1 round-trip keeps only the low byte, turning ’ into U+0019 and
 * — into U+0014 (the "it s" / "there s" bug).
 */
export function fixMojibake(s: string): string {
  if (!s) return s;
  // Real Unicode above Latin-1 → already decoded correctly.
  if (/[^\u0000-ÿ]/.test(s)) return s;
  // No UTF-8 lead byte followed by a continuation byte → nothing to fix.
  if (!/[Â-ô][\u0080-¿]/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    return fixed.includes('�') ? s : fixed;
  } catch {
    return s;
  }
}
