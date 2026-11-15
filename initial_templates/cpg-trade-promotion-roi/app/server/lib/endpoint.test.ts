import { describe, expect, it } from 'vitest';
import { fixMojibake } from './endpoint.js';

describe('fixMojibake', () => {
  it('repairs real UTF-8-read-as-Latin-1 mojibake', () => {
    const mojibake = (s: string) => Buffer.from(s, 'utf8').toString('latin1');
    expect(fixMojibake(mojibake('en dash – here'))).toBe('en dash – here');
    expect(fixMojibake(mojibake('café'))).toBe('café');
    expect(fixMojibake(mojibake('§ 4.2 at 20°C'))).toBe('§ 4.2 at 20°C');
  });

  it('leaves correctly-decoded text untouched', () => {
    for (const s of ['–', '’', '§', '°', '§ 4.2', '20°C', 'naïve', 'emoji 🎉', 'arrow → ok', 'plain ascii', '']) {
      expect(fixMojibake(s)).toBe(s);
    }
  });
});
