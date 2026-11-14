import { describe, expect, it, vi } from 'vitest';
import {
  HOUSEHOLD_VERIFICATION_SESSION_KEY,
  HouseholdVerificationError,
  clearHouseholdVerificationSession,
  householdVerificationIsOperator,
  householdNicknameIsValid,
  normalizeHouseholdBuilding,
  normalizeHouseholdNickname,
  normalizeHouseholdUnitType,
  parseHouseholdVerificationConfig,
  readHouseholdVerificationSession,
  requestHouseholdVerification,
  verifyHousehold,
  verifyShareViewer,
  writeHouseholdVerificationSession,
  type HouseholdVerificationConfigV1,
} from './household-verification';

const config: HouseholdVerificationConfigV1 = {
  schemaVersion: 1,
  enabled: true,
  provider: 'google-apps-script',
  endpoint: 'https://script.google.com/macros/s/test-bunfirvil/exec',
  timeoutMs: 8_000,
};

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('household Google Sheet verification', () => {
  it('normalizes building, unit type, and nickname without storing household details', () => {
    expect(normalizeHouseholdBuilding(' ０１０５동 ')).toBe('105');
    expect(normalizeHouseholdUnitType(' ５５ａ ')).toBe('55A');
    expect(normalizeHouseholdNickname('  Ａbc 이웃  ')).toBe('Abc 이웃');
    expect(normalizeHouseholdNickname('Abc 이웃')).not.toBe(normalizeHouseholdNickname('abc이웃'));
  });

  it('validates public nicknames locally using the same normalization and bounds as membership requests', () => {
    expect(householdNicknameIsValid('  Ａbc 이웃  ')).toBe(true);
    expect(householdNicknameIsValid('가'.repeat(20))).toBe(true);
    expect(householdNicknameIsValid('')).toBe(false);
    expect(householdNicknameIsValid('   ')).toBe(false);
    expect(householdNicknameIsValid('가'.repeat(21))).toBe(false);
    expect(householdNicknameIsValid('이웃\u007f')).toBe(false);
    expect(householdNicknameIsValid('이\n웃')).toBe(false);
  });

  it('accepts only a bounded HTTPS runtime configuration', () => {
    expect(parseHouseholdVerificationConfig(config)).toEqual(config);
    expect(() => parseHouseholdVerificationConfig({ ...config, endpoint: 'http://example.test/exec' })).toThrow(HouseholdVerificationError);
    expect(() => parseHouseholdVerificationConfig({ ...config, timeoutMs: 999 })).toThrow(HouseholdVerificationError);
  });

  it('posts the normalized triple without floor or household number', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        schemaVersion: 1,
        action: 'verifyHousehold',
        buildingId: '105',
        unitType: '55A',
        nickname: '피치',
      });
      return new Response(JSON.stringify({ schemaVersion: 1, ok: true, verified: true, operator: false, requested: false, status: 'verified' }));
    }) as unknown as typeof fetch;
    await expect(verifyHousehold(config, { buildingId: '105동', unitType: '55a', nickname: ' 피치 ' }, fetchMock))
      .resolves.toMatchObject({ verified: true, operator: false, status: 'verified' });
  });

  it('uses a separate request action and keeps a requested response unverified', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).action).toBe('requestHouseholdVerification');
      return new Response(JSON.stringify({ schemaVersion: 1, ok: true, verified: false, operator: false, requested: true, status: 'requested' }));
    }) as unknown as typeof fetch;
    await expect(requestHouseholdVerification(config, { buildingId: '105', unitType: '55A', nickname: '피치' }, fetchMock))
      .resolves.toMatchObject({ verified: false, requested: true, status: 'requested' });
  });

  it('fails closed for an invalid response', async () => {
    const invalidFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(verifyHousehold(config, { buildingId: '105', unitType: '55A', nickname: '피치' }, invalidFetch))
      .rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('stores the verified nickname only in the current tab without household details', () => {
    const storage = new MemoryStorage();
    writeHouseholdVerificationSession('operator', ' 피치 ', storage, 1_789_000_000_000);
    const raw = storage.getItem(HOUSEHOLD_VERIFICATION_SESSION_KEY) || '';
    expect(JSON.parse(raw)).toEqual({ schemaVersion: 1, provider: 'google-apps-script', verifiedAt: 1789000000000, role: 'operator', authRevision: 2, scope: 'playground', nickname: '피치' });
    expect(raw).not.toMatch(/105|55A|2501/);
    expect(householdVerificationIsOperator(storage)).toBe(true);
    expect(readHouseholdVerificationSession(storage)?.role).toBe('operator');
    expect(readHouseholdVerificationSession(storage)?.nickname).toBe('피치');
    clearHouseholdVerificationSession(storage);
    expect(readHouseholdVerificationSession(storage)).toBeNull();
  });

  it('rejects old nickname-only operator responses and sessions', async () => {
    const fetchMock = async () => new Response(JSON.stringify({ schemaVersion: 1, ok: true, verified: true, operator: true, status: 'operator' }));
    await expect(verifyHousehold(config, { buildingId: '105', unitType: '55A', nickname: 'operator' }, fetchMock)).rejects.toMatchObject({ code: 'backend-update-required' });
    const storage = new MemoryStorage();
    storage.setItem(HOUSEHOLD_VERIFICATION_SESSION_KEY, JSON.stringify({ schemaVersion: 1, provider: 'google-apps-script', verifiedAt: 100, role: 'operator' }));
    expect(readHouseholdVerificationSession(storage)).toBeNull();
  });

  it('round-trips a public entry in the existing tab session without granting verified or operator privileges', () => {
    for (const scope of ['playground', 'share'] as const) {
      const storage = new MemoryStorage();
      writeHouseholdVerificationSession('public', ' 공개 이웃 ', storage, 100, scope);
      expect(readHouseholdVerificationSession(storage)).toEqual({
        schemaVersion: 1, provider: 'google-apps-script', verifiedAt: 100,
        role: 'public', authRevision: 2, scope, nickname: '공개 이웃',
      });
      expect(householdVerificationIsOperator(storage)).toBe(false);
      expect(storage.getItem(HOUSEHOLD_VERIFICATION_SESSION_KEY)).not.toMatch(/buildingId|householdNumber|unitType|operatorCode/);
    }
  });

  it('separates share viewer membership from the shared apartment type', async () => {
    const fetchMock = async (_: URL | RequestInfo, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: 1, action: 'verifyShareViewer', buildingId: '105', unitType: '', nickname: '이웃' });
      return new Response(JSON.stringify({ schemaVersion: 1, authRevision: 2, ok: true, verified: true, operator: false, status: 'verified', scope: 'share' }));
    };
    expect((await verifyShareViewer(config, { buildingId: '105', nickname: '이웃' }, fetchMock)).scope).toBe('share');
    const storage = new MemoryStorage();
    writeHouseholdVerificationSession('verified', '이웃', storage, Date.now(), 'share');
    expect(readHouseholdVerificationSession(storage)?.scope).toBe('share');
    expect(storage.getItem(HOUSEHOLD_VERIFICATION_SESSION_KEY)).not.toMatch(/operatorCode|unitType|buildingId/);
  });

  it('does not accept inconsistent privilege responses', async () => {
    const fetchMock = async () => new Response(JSON.stringify({ schemaVersion: 1, ok: true, verified: true, operator: false, status: 'requested' }));
    await expect(verifyHousehold(config, { buildingId: '105', unitType: '55A', nickname: '이웃' }, fetchMock)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('cancels obsolete authentication without reporting a service timeout', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const pending = verifyHousehold(config, { buildingId: '105', unitType: '55A', nickname: '이웃' }, fetchMock, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await expect(verifyShareViewer(config, { buildingId: '105', nickname: '이웃' }, fetchMock, controller.signal))
      .rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps actual request timeouts separate from user cancellation', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = (_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      const pending = verifyHousehold(config, { buildingId: '105', unitType: '55A', nickname: '이웃' }, fetchMock);
      const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(config.timeoutMs);
      await assertion;
    } finally { vi.useRealTimers(); }
  });

  it('does not promote an unknown authentication scope to playground access', () => {
    const storage = new MemoryStorage();
    writeHouseholdVerificationSession('verified', '이웃', storage);
    const session = JSON.parse(storage.getItem(HOUSEHOLD_VERIFICATION_SESSION_KEY)!);
    storage.setItem(HOUSEHOLD_VERIFICATION_SESSION_KEY, JSON.stringify({ ...session, scope: 'invalid' }));
    expect(readHouseholdVerificationSession(storage)).toBeNull();
  });
});
