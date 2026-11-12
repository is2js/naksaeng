import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guidePageUrl, guideReturnUrl, safePlaygroundReturnUrl } from './navigation';

const base = new URL('https://is2js.github.io/naksaeng/bunfirvil/');
const map = 'bundang-first-village-51a-prototype';
const playground = `${base.pathname}?map=${map}&actor=200&variant=D`;

describe('playground guide navigation', () => {
  it('preserves the current map, actor and variant without storing household or account data', () => {
    expect(safePlaygroundReturnUrl(`${playground}&building=107&household=1001&nickname=private&role=operator`, base)).toBe(playground);
    const url = new URL(guidePageUrl('b-option', playground, false, base));
    expect([...url.searchParams]).toEqual([['guide', 'b-option']]);
    expect(guideReturnUrl(url.href, '', base)).toBe(playground);
    expect(guideReturnUrl(guidePageUrl('local-storage', guideReturnUrl(url.href, '', base), false, base), '', base)).toBe(playground);
  });

  it('keeps a shared layout in the fragment and never the request query', () => {
    const shared = `${playground}#share=v1.Abc_123-def`;
    const url = new URL(guidePageUrl('playground', shared, true, base));
    expect(url.search).not.toContain('share');
    expect(new URLSearchParams(url.hash.slice(1)).get('fromPlaygroundTab')).toBe('1');
    expect(guideReturnUrl(url.href, '', base)).toBe(shared);
    expect(new URL(guidePageUrl('playground', playground, false, base)).hash).not.toContain('fromPlaygroundTab');
  });

  it.each([
    'https://attacker.invalid/naksaeng/bunfirvil/?map=' + map,
    'https://user:secret@is2js.github.io/naksaeng/bunfirvil/?map=' + map,
    '/other/?map=' + map,
    '/naksaeng/bunfirvil/guides/?map=' + map,
    '/naksaeng/bunfirvil/../?map=' + map,
    'javascript:alert(1)',
    '/naksaeng/bunfirvil/?map=unknown',
    '/naksaeng/bunfirvil/',
    'x'.repeat(48001),
  ])('rejects unsafe or unrelated return contexts: %s', (value) => {
    expect(safePlaygroundReturnUrl(value, base)).toBeNull();
  });

  it('falls back only to a same-origin playground referrer, otherwise the public app root', () => {
    expect(guideReturnUrl(new URL('guides/', base).href, new URL(playground, base).href, base)).toBe(playground);
    expect(guideReturnUrl(new URL('guides/#playground=https://attacker.invalid/', base).href, '', base)).toBe(base.pathname);
  });

  it('discards unknown actor, variant, query and fragment fields', () => {
    expect(safePlaygroundReturnUrl(`${base}?map=bundang-first-village-55b-prototype&actor=999&variant=D&token=secret#arbitrary`, base))
      .toBe(`${base.pathname}?map=bundang-first-village-55b-prototype`);
  });

  it('keeps the native guide panel in-place, lazy and keyboard-isolated', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/game/app.ts'), 'utf8');
    const panel = readFileSync(resolve(process.cwd(), 'src/guides/playground-panel.ts'), 'utf8');
    expect(app).toContain('id="help-dialog" class="help-dialog playground-guide"');
    expect(app).toContain("await import('../guides/playground-panel')");
    expect(app).toContain("this.mount.querySelector('dialog[open]')");
    expect(app).toContain('this.releaseGuideMovement();');
    expect(panel).toContain('!guide.operatorOnly || operator');
    expect(panel).toContain('aria-label="가이드 문서"');
    expect(panel).not.toMatch(/(?:sessionStorage|localStorage|clearHouseholdVerification|selectMap\()/);
    const html = readFileSync(resolve(process.cwd(), 'guides/index.html'), 'utf8');
    expect(html.match(/data-playground-return/g)).toHaveLength(3);
  });

  it('keeps a persistent design notice and routes the entrance sliding door to its explicit option', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/game/app.ts'), 'utf8');
    expect(app).toContain('id="option-design-disclaimer" class="option-design-disclaimer" role="note"');
    expect(app).toContain('실제 시공과 다를 수 있습니다.');
    const route = app.slice(app.indexOf("if (assetId === 'entry-sliding-partition-door')"), app.indexOf('const asset = this.interiorAssets.find', app.indexOf("if (assetId === 'entry-sliding-partition-door')")));
    expect(route).toContain('this.focusOptionInPalette(assetId)');
    expect(route).toContain("this.cancelInteriorGhost('', false)");
    expect(route).toContain('옵션 카드에서 선택해 주세요.');
    expect(route).toContain('return;');
    expect(route).not.toContain('commitSelectedOptions');
  });
});
