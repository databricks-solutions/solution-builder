/**
 * Streaming text helpers.
 *
 * The Databricks serving-endpoints streaming gateway occasionally returns
 * UTF-8 bytes the HTTP layer then re-decodes as Latin-1, which looks like
 * mojibake to the user. Re-encode — but ONLY when the text actually looks like
 * mojibake: correct text containing "°", "—" or "≥" must pass through untouched
 * (blindly re-encoding it as latin1 corrupts it into "�" / "&").
 */
const MOJIBAKE_RE = /[ÃÂâ][\u0080-¿]/;

export function fixMojibake(s: string): string {
  if (!s || !MOJIBAKE_RE.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  try {
    const out = Buffer.from(s, 'latin1').toString('utf8');
    return out.includes('�') ? s : out;
  } catch {
    return s;
  }
}
