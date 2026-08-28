import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');

describe('PersonalNWS Alpha baseline UI', () => {
  it('keeps the accepted controls and branding', () => {
    expect(html).toContain('<title>PersonalNWS Alpha</title>');
    expect(html).toContain('id="product"');
    expect(html).toContain('id="tilt"');
    expect(html).toContain('id="tracks"');
    expect(html).toContain('id="cwa"');
    expect(html).toContain('id="timeline"');
    expect(html).not.toMatch(/frontend only|frontend shell/i);
  });
});
