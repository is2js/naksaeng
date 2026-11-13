import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('놀이터 브랜드 SVG와 하위 경로', () => {
  it('브랜드 도형은 제공된 원본 경로를 보존하고 테마색만 사용한다', async () => {
    for (const filename of ['e-brand-mint.svg', 'favicon.svg']) {
      const svg = await readFile(`public/assets/brand/${filename}`, 'utf8');
      const path = svg.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1];
      expect(path).toBeTruthy();
      expect(createHash('sha256').update(path!).digest('hex')).toBe('348d151ba813c4235eb725da71f89a9a668eb8454298771be00affcd9e358c59');
      expect(svg).toContain('#8ce2c4');
      expect(svg).not.toMatch(/<script|foreignObject|onload=|#FF671D/i);
    }
  });

  it('8개 진입점이 하나의 파비콘과 브랜드 스타일을 사용하고 base를 중복하지 않는다', async () => {
    for (const page of ['', 'guides/', 'households/', 'calculator/', 'documents/', 'manage/', 'building-admin/', 'interior-admin/']) {
      const html = await readFile(`${page}index.html`, 'utf8');
      expect(html.match(/rel="icon"/g)).toHaveLength(1);
      expect(html).toContain('href="/assets/brand/favicon.svg"');
      expect(html.match(/href="\/src\/styles\/brand.css"/g)).toHaveLength(1);
    }
  });
});
