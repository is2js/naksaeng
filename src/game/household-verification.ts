import { resolveProjectUrl } from './base';

export const HOUSEHOLD_VERIFICATION_SESSION_KEY = 'bunfirvil:household-verification:v1';
export const HOUSEHOLD_VERIFICATION_PROVIDER = 'google-apps-script' as const;
const GOOGLE_APPS_SCRIPT_EXEC_URL = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i;

/** Public entry is not a successful Sheet verification. */
export type HouseholdVerificationRole = 'public' | 'verified' | 'operator';
export type HouseholdVerificationStatus = 'not_found' | 'requested' | 'verified' | 'operator' | 'rejected';
export type HouseholdVerificationAction = 'verifyHousehold' | 'verifyShareViewer' | 'requestHouseholdVerification';
export type HouseholdVerificationScope = 'playground' | 'share';

export interface HouseholdVerificationConfigV1 {
  schemaVersion: 1;
  enabled: boolean;
  provider: typeof HOUSEHOLD_VERIFICATION_PROVIDER;
  endpoint: string;
  timeoutMs: number;
}

export interface HouseholdVerificationRequestV1 {
  schemaVersion: 1;
  action: HouseholdVerificationAction;
  buildingId: string;
  unitType: string;
  nickname: string;
  operatorCode?: string;
}

export interface HouseholdVerificationResponseV1 {
  schemaVersion: 1;
  ok: boolean;
  verified: boolean;
  operator: boolean;
  requested: boolean;
  status: HouseholdVerificationStatus;
  code?: string;
  scope?: HouseholdVerificationScope;
}

export interface HouseholdVerificationSessionV1 {
  schemaVersion: 1;
  provider: typeof HOUSEHOLD_VERIFICATION_PROVIDER;
  verifiedAt: number;
  role: HouseholdVerificationRole;
  authRevision?: 2;
  scope?: HouseholdVerificationScope;
  /** 현재 탭에서 공유 링크 작성자 표시에만 사용하며 localStorage에는 기록하지 않는다. */
  nickname?: string;
}

export type HouseholdVerificationErrorCode = 'not-configured' | 'cancelled' | 'timeout' | 'network' | 'invalid-response' | 'backend-update-required' | 'request_capacity' | 'rate_limited';

export class HouseholdVerificationError extends Error {
  constructor(readonly code: HouseholdVerificationErrorCode) {
    super(code);
    this.name = 'HouseholdVerificationError';
  }
}

type SessionStoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserSessionStorage(): SessionStoragePort | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

export function normalizeHouseholdBuilding(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s*동\s*$/u, '').replace(/^0+(?=\d)/u, '');
}

export function normalizeHouseholdUnitType(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, '').toUpperCase();
}

export function normalizeHouseholdNickname(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim();
}

export function householdNicknameIsValid(value: unknown): boolean {
  const nickname = normalizeHouseholdNickname(value);
  return Array.from(nickname).length >= 1 && Array.from(nickname).length <= 20
    && !/[\u0000-\u001f\u007f]/u.test(nickname);
}

export function parseHouseholdVerificationConfig(value: unknown): HouseholdVerificationConfigV1 {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const endpoint = typeof row.endpoint === 'string' ? row.endpoint.trim() : '';
  const timeoutMs = Number(row.timeoutMs);
  if (row.schemaVersion !== 1
    || row.provider !== HOUSEHOLD_VERIFICATION_PROVIDER
    || typeof row.enabled !== 'boolean'
    || !Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000
    || (row.enabled && !GOOGLE_APPS_SCRIPT_EXEC_URL.test(endpoint))
    || (!row.enabled && endpoint !== '')) throw new HouseholdVerificationError('invalid-response');
  return { schemaVersion: 1, enabled: row.enabled, provider: HOUSEHOLD_VERIFICATION_PROVIDER, endpoint, timeoutMs };
}

export async function loadHouseholdVerificationConfig(fetchImpl: typeof fetch = fetch): Promise<HouseholdVerificationConfigV1> {
  let response: Response;
  try {
    response = await fetchImpl(resolveProjectUrl('config/household-verification.v1.json'), {
      cache: 'no-store', headers: { Accept: 'application/json' },
    });
  } catch { throw new HouseholdVerificationError('network'); }
  if (!response.ok) throw new HouseholdVerificationError('network');
  try { return parseHouseholdVerificationConfig(await response.json()); }
  catch (error) {
    if (error instanceof HouseholdVerificationError) throw error;
    throw new HouseholdVerificationError('invalid-response');
  }
}

export function householdVerificationConfigured(config: HouseholdVerificationConfigV1): boolean {
  return config.enabled && GOOGLE_APPS_SCRIPT_EXEC_URL.test(config.endpoint);
}

async function sendHouseholdVerification(
  config: HouseholdVerificationConfigV1,
  action: HouseholdVerificationAction,
  input: Omit<HouseholdVerificationRequestV1, 'schemaVersion' | 'action'>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<HouseholdVerificationResponseV1> {
  if (!householdVerificationConfigured(config)) throw new HouseholdVerificationError('not-configured');
  if (signal?.aborted) throw new HouseholdVerificationError('cancelled');
  const request: HouseholdVerificationRequestV1 = {
    schemaVersion: 1,
    action,
    buildingId: normalizeHouseholdBuilding(input.buildingId),
    unitType: action === 'verifyShareViewer' ? '' : normalizeHouseholdUnitType(input.unitType),
    nickname: normalizeHouseholdNickname(input.nickname),
    ...(input.operatorCode ? { operatorCode: input.operatorCode.trim() } : {}),
  };
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  let payload: unknown;
  try {
    response = await fetchImpl(config.endpoint, {
      method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(request), signal: controller.signal,
    });
    if (!response.ok) throw new HouseholdVerificationError('network');
    try { payload = await response.json(); }
    catch {
      if (controller.signal.aborted) throw new HouseholdVerificationError('timeout');
      throw new HouseholdVerificationError('invalid-response');
    }
  } catch (error) {
    if (signal?.aborted) throw new HouseholdVerificationError('cancelled');
    if (error instanceof HouseholdVerificationError) throw error;
    if (controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError') throw new HouseholdVerificationError('timeout');
    throw new HouseholdVerificationError('network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
  const row = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  if (row?.ok === false && (row.code === 'request_capacity' || row.code === 'rate_limited')) throw new HouseholdVerificationError(row.code);
  const validStatus = row && ['not_found', 'requested', 'verified', 'operator', 'rejected'].includes(String(row.status));
  if (!row || row.schemaVersion !== 1 || typeof row.ok !== 'boolean' || typeof row.verified !== 'boolean'
    || typeof row.operator !== 'boolean' || !validStatus) throw new HouseholdVerificationError('invalid-response');
  if (!row.ok) throw new HouseholdVerificationError('network');
  if (row.operator && (row.authRevision !== 2 || row.operatorVerified !== true)
    || action === 'verifyShareViewer' && (row.authRevision !== 2 || row.scope !== 'share')) throw new HouseholdVerificationError('backend-update-required');
  if (row.verified !== (row.status === 'verified' || row.status === 'operator')
    || row.operator !== (row.status === 'operator')) throw new HouseholdVerificationError('invalid-response');
  return {
    schemaVersion: 1,
    ok: true,
    verified: row.verified,
    operator: row.operator,
    requested: row.requested === true,
    status: row.status as HouseholdVerificationStatus,
    scope: action === 'verifyShareViewer' ? 'share' : 'playground',
    ...(typeof row.code === 'string' ? { code: row.code } : {}),
  };
}

export function verifyHousehold(
  config: HouseholdVerificationConfigV1,
  input: Omit<HouseholdVerificationRequestV1, 'schemaVersion' | 'action'>,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<HouseholdVerificationResponseV1> {
  return sendHouseholdVerification(config, 'verifyHousehold', input, fetchImpl, signal);
}

export function requestHouseholdVerification(
  config: HouseholdVerificationConfigV1,
  input: Omit<HouseholdVerificationRequestV1, 'schemaVersion' | 'action'>,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<HouseholdVerificationResponseV1> {
  return sendHouseholdVerification(config, 'requestHouseholdVerification', input, fetchImpl, signal);
}

export function verifyShareViewer(
  config: HouseholdVerificationConfigV1,
  input: Omit<HouseholdVerificationRequestV1, 'schemaVersion' | 'action' | 'unitType'>,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<HouseholdVerificationResponseV1> {
  return sendHouseholdVerification(config, 'verifyShareViewer', { ...input, unitType: '' }, fetchImpl, signal);
}

export function readHouseholdVerificationSession(storage: SessionStoragePort | null = browserSessionStorage()): HouseholdVerificationSessionV1 | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(HOUSEHOLD_VERIFICATION_SESSION_KEY) || 'null') as Partial<HouseholdVerificationSessionV1> | null;
    if (!parsed || parsed.schemaVersion !== 1 || parsed.provider !== HOUSEHOLD_VERIFICATION_PROVIDER
      || typeof parsed.verifiedAt !== 'number' || !Number.isFinite(parsed.verifiedAt) || parsed.verifiedAt <= 0
      || (parsed.role !== 'public' && parsed.role !== 'verified' && parsed.role !== 'operator')
      || (parsed.scope !== undefined && parsed.scope !== 'share' && parsed.scope !== 'playground')) return null;
    // Old nickname-only operator sessions must authenticate again.
    if (parsed.role === 'operator' && parsed.authRevision !== 2) {
      storage.removeItem(HOUSEHOLD_VERIFICATION_SESSION_KEY);
      return null;
    }
    const nickname = normalizeHouseholdNickname(parsed.nickname);
    return {
      schemaVersion: 1,
      provider: HOUSEHOLD_VERIFICATION_PROVIDER,
      verifiedAt: parsed.verifiedAt,
      role: parsed.role,
      ...(parsed.authRevision === 2 ? { authRevision: 2 as const } : {}),
      scope: parsed.scope === 'share' ? 'share' : 'playground',
      ...(nickname && Array.from(nickname).length <= 20 ? { nickname } : {}),
    };
  } catch { return null; }
}

export function householdVerificationIsOperator(storage: SessionStoragePort | null = browserSessionStorage()): boolean {
  return readHouseholdVerificationSession(storage)?.role === 'operator';
}

export function writeHouseholdVerificationSession(
  role: HouseholdVerificationRole,
  nickname = '',
  storage: SessionStoragePort | null = browserSessionStorage(),
  verifiedAt = Date.now(),
  scope: HouseholdVerificationScope = 'playground',
): HouseholdVerificationSessionV1 | null {
  if (!storage) return null;
  const normalizedNickname = normalizeHouseholdNickname(nickname);
  const session: HouseholdVerificationSessionV1 = {
    schemaVersion: 1,
    provider: HOUSEHOLD_VERIFICATION_PROVIDER,
    verifiedAt,
    role,
    authRevision: 2,
    scope,
    ...(normalizedNickname && Array.from(normalizedNickname).length <= 20 ? { nickname: normalizedNickname } : {}),
  };
  storage.setItem(HOUSEHOLD_VERIFICATION_SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearHouseholdVerificationSession(storage: SessionStoragePort | null = browserSessionStorage()): void {
  storage?.removeItem(HOUSEHOLD_VERIFICATION_SESSION_KEY);
}
