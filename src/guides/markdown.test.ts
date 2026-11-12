import { describe, expect, it } from 'vitest';
import { parseGuideDocument, renderGuideMarkdown } from './markdown';

describe('Markdown guide documents', () => {
  it('reads extensible front matter metadata', () => {
    const guide = parseGuideDocument(`---\nid: controls\ntitle: 조작 가이드\ncategory: 게임\norder: 20\n---\n\n# 시작`, './content/controls.md');
    expect(guide).toMatchObject({ id: 'controls', title: '조작 가이드', category: '게임', order: 20 });
    expect(guide.body).toBe('# 시작');
  });

  it('renders common guide blocks and escapes raw HTML', () => {
    const html = renderGuideMarkdown('# 제목\n\n- **선택**\n- `L` 자석\n\n| 키 | 동작 |\n| --- | --- |\n| L | 벽 스냅 |\n\n<script>alert(1)</script>');
    expect(html).toContain('<h2>제목</h2>');
    expect(html).toContain('<strong>선택</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('rejects unsafe guide ids', () => {
    expect(() => parseGuideDocument('---\nid: ../bad\ntitle: 잘못된 문서\n---\n본문', 'bad.md')).toThrow(/id 또는 title/);
  });

  it('renders query-only guide links without admitting executable URLs', () => {
    const html = renderGuideMarkdown('[옵션](?guide=b-option) · [거부](javascript:alert)');
    expect(html).toContain('href="?guide=b-option"');
    expect(html).not.toContain('href="javascript:');
  });
});
