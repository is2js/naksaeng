import { describe, expect, it } from 'vitest';
import { guideAccessNotice, guideAudience, guideIsOperator, guideMarkdownForAccess, type GuideAccess } from './audience';
import { guideDocumentsForAccess } from './catalog';
import { renderGuideMarkdown } from './markdown';

describe('mode-specific playground guides', () => {
  const modes: GuideAccess[] = [{}, { role: 'public' }, { role: 'verified' }, { role: 'operator' },
    { role: 'public', readOnlyShare: true }, { role: 'operator', readOnlyShare: true }];
  const body = (access: GuideAccess, id = 'playground') => guideDocumentsForAccess(access).find(guide => guide.id === id)!.body;

  it('defaults unauthenticated readers to public instructions and lets sharing override every role', () => {
    expect(guideAudience({})).toBe('public');
    expect(guideAudience({ role: 'verified' })).toBe('member');
    expect(guideAudience({ role: 'operator', readOnlyShare: true })).toBe('shared');
    expect(guideIsOperator({ role: 'operator', readOnlyShare: true })).toBe(false);
    expect(guideAccessNotice({})).toContain('공개모드 안내');
  });

  it('shows only public hotbar numbering and no furniture editing instructions to public readers', () => {
    expect(body({})).toBe(body({ role: 'public' }));
    expect(body({})).toContain('3 자녀 인형');
    expect(body({})).not.toContain('회원 3번');
    expect(body({})).not.toContain('회원 4번');
    expect(body({})).not.toContain('Shift + 휠**로 회전');
    expect(body({})).toContain('레이저 실측');
    expect(body({})).toContain('40%');
    expect(body({})).toContain('3초');
    expect(body({})).not.toContain('회원 개인코드');
    expect(body({})).toContain('링크 복사');
    expect(body({})).toContain('암호화');
  });

  it('retains authenticated furniture controls and member hotbar numbering', () => {
    expect(body({ role: 'verified' })).toContain('5 자녀 인형');
    expect(body({ role: 'verified' })).toContain('가구배치');
    expect(body({ role: 'verified' })).toContain('Shift + 휠');
    expect(body({ role: 'verified' })).toContain('평면 타입 전환');
    expect(body({ role: 'verified' })).toContain('개인코드');
  });

  it('keeps operator documents unavailable to public/member/shared readers', () => {
    for (const access of modes.filter(access => !guideIsOperator(access))) {
      expect(guideDocumentsForAccess(access).some(guide => guide.operatorOnly)).toBe(false);
    }
    expect(guideDocumentsForAccess({ role: 'operator' }).some(guide => guide.operatorOnly)).toBe(true);
    expect(body({} , 'b-option')).not.toContain('## 검수자료 관리');
  });

  it('renders a read-only guide rather than public/member editing steps in shared playgrounds', () => {
    for (const role of ['public', 'verified', 'operator'] as const) {
      const access = { role, readOnlyShare: true };
      expect(body(access)).toContain('읽기 전용');
      expect(body(access)).not.toContain('Space');
      expect(body(access)).not.toContain('3 자녀 인형');
      expect(body(access, 'b-option')).not.toContain('옵션 카드를 누르면');
      expect(body(access, 'local-storage')).not.toContain('## 현재 평형만 초기화');
    }
  });

  it.each(modes)('renders every available document without visible audience markers: %o', access => {
    const docs = guideDocumentsForAccess(access);
    expect(docs.map(guide => guide.id)).toEqual(expect.arrayContaining(['playground', 'b-option', 'local-storage']));
    for (const guide of docs) {
      expect(guide.body).not.toMatch(/^:::/m);
      expect(renderGuideMarkdown(guide.body)).not.toContain(':::');
    }
  });

  it('supports combined/nested audiences while keeping code samples literal', () => {
    const markdown = '공통\n:::public member\n일반\n:::operator\n관리\n:::\n:::\n```text\n:::member\n```';
    expect(guideMarkdownForAccess(markdown, {})).toBe('공통\n일반\n```text\n:::member\n```');
    expect(guideMarkdownForAccess(markdown, { role: 'operator' })).toContain('일반\n관리');
    expect(guideMarkdownForAccess(markdown, { readOnlyShare: true })).not.toContain('일반');
  });

  it.each([':::unknown\n숨김\n:::', ':::member\n미완성', ':::'])('rejects malformed audience blocks rather than rendering their contents: %s', markdown => {
    expect(() => guideMarkdownForAccess(markdown, {})).toThrow(/가이드 권한 블록/);
  });
});
