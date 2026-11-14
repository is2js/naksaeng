import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guideDocuments } from './catalog';

describe('guide access contract', () => {
  it('keeps every authoring control hidden until an operator session reveals it', () => {
    const html = readFileSync(resolve(process.cwd(), 'guides/index.html'), 'utf8');
    const operatorElements = html.match(/<[^>]+data-operator-only[^>]*>/g) || [];
    expect(operatorElements.length).toBeGreaterThanOrEqual(7);
    expect(operatorElements.every((element) => /\shidden(?:\s|>|=)/.test(element))).toBe(true);
  });

  it('registers local operations and revised membership docs as operator-only guides', () => {
    const guide = guideDocuments().find((candidate) => candidate.id === 'local-committed-preview-admin');
    expect(guide).toMatchObject({ operatorOnly: true, category: '운영자' });
    expect(guide?.body).toContain('git archive HEAD');
    expect(guide?.body).toContain('npm run local:dev');
    expect(guide?.body).toContain('npm run local:check');
    expect(guide?.body).toContain('npm run local:pages');

    const verificationGuide = guideDocuments().find((candidate) => candidate.id === 'household-verification-admin');
    expect(verificationGuide).toMatchObject({
      title: '인증·회원 운영 개정판',
      operatorOnly: true,
      category: '운영자',
    });
    expect(verificationGuide?.body).toContain('가입요청');
    expect(verificationGuide?.body).toContain('인증명단');
    expect(verificationGuide?.body).toContain('다음 개정 때 확인할 순서');
  });

  it('limits the detailed dimension comparison to operators without a broken public link', () => {
    const guide = guideDocuments().find(candidate => candidate.id === 'laser-dimensions');
    expect(guide).toMatchObject({ operatorOnly: true, category: '운영자' });
    const publicGuide = guideDocuments().find(candidate => candidate.id === 'playground');
    expect(publicGuide?.body).not.toContain('?guide=laser-dimensions');
    expect(publicGuide?.body).toContain('참고 평면도 보기');
    expect(publicGuide?.body).toContain('3초');
  });
});
