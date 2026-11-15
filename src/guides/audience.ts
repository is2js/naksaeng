import type { HouseholdVerificationRole } from '../game/household-verification';

export interface GuideAccess {
  role?: HouseholdVerificationRole | null;
  readOnlyShare?: boolean;
}

export type GuideAudience = 'public' | 'member' | 'shared';

export function guideAudience(access: GuideAccess): GuideAudience {
  if (access.readOnlyShare) return 'shared';
  return access.role === 'verified' || access.role === 'operator' ? 'member' : 'public';
}

export function guideIsOperator(access: GuideAccess): boolean {
  return access.role === 'operator' && !access.readOnlyShare;
}

export function guideAccessNotice(access: GuideAccess): string {
  if (guideAudience(access) === 'shared') return '공유 열람 안내 · 이동과 실측을 사용할 수 있으며 옵션·가구는 변경할 수 없습니다.';
  if (guideIsOperator(access)) return '운영자 안내 · 회원 기능과 운영 문서를 함께 표시합니다.';
  if (guideAudience(access) === 'member') return '인증 회원 안내 · 공개 기능과 가구 배치·평면 전환·변신을 함께 안내합니다.';
  return '공개모드 안내 · 지금 사용할 수 있는 이동·옵션·실측·계산기 기능을 안내합니다.';
}

/** Author one document, but never render unavailable controls as public instructions. */
export function guideMarkdownForAccess(markdown: string, access: GuideAccess): string {
  const allowed = new Set<string>([guideAudience(access)]);
  if (guideIsOperator(access)) allowed.add('operator');
  const stack: boolean[] = [], output: string[] = [];
  let codeFence = false;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!codeFence && trimmed.startsWith(':::')) {
      if (trimmed === ':::') {
        if (!stack.length) throw new Error('가이드 권한 블록의 시작이 없습니다.');
        stack.pop();
      } else {
        const audiences = trimmed.slice(3).trim().split(/\s+/);
        if (audiences.some(audience => !['public', 'member', 'shared', 'operator'].includes(audience))) {
          throw new Error('가이드 권한 블록이 올바르지 않습니다.');
        }
        stack.push(audiences.some(audience => allowed.has(audience)));
      }
      continue;
    }
    if (trimmed.startsWith('```')) codeFence = !codeFence;
    if (stack.every(Boolean)) output.push(line);
  }
  if (stack.length) throw new Error('가이드 권한 블록이 닫히지 않았습니다.');
  return output.join('\n').trim();
}
