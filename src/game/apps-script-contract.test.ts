import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const HEADERS = ['동', '타입', '닉네임', '상태'];
const CODE_HEADERS = ['회원코드 해시', '회원코드 발급일', '회원코드 폐기일'];
const MEMBER_HEADERS = [...HEADERS, ...CODE_HEADERS];
const REQUEST_HEADERS = ['요청ID', '요청일시', '동', '타입', '닉네임', '심사결정', '처리결과', '처리일시'];
const OPERATOR_TEST_CODE = 'test-only-random-code-123'; // Synthetic fixture, never a deployed credential.
const MEMBER_TEST_CODE = 'synthetic-member-code-456';
const MEMBER_REISSUED_CODE = 'synthetic-reissued-code-789';
const memberDigest = (code: string, building = '105', type = '55A', nickname = '이웃') => createHash('sha256')
  .update(['bunfirvil-member-code:v1', building, type, nickname, code].join('\n')).digest('hex');
const approvedMember = (building = '105', type = '55A', nickname = '이웃') => [building, type, nickname, '인증됨', memberDigest(MEMBER_TEST_CODE, building, type, nickname), '2026-11-17T00:00:00.000Z', ''];

class FakeSheet {
  writes: unknown[][] = [];
  failWrites = false;
  displayOverrides = new Map<string, string>();
  constructor(public data: string[][], public name = '인증명단') {}
  getLastRow() { return this.data.length; }
  getName() { return this.name; }
  setFrozenRows() {}
  getRange(rowOrA1: number | string, col = 1, count = 1, width = 1) {
    const row = typeof rowOrA1 === 'number' ? rowOrA1 : 2;
    if (typeof rowOrA1 === 'string') col = rowOrA1.startsWith('D') ? 4 : 6;
    const sheet = this;
    return {
      getSheet: () => sheet,
      getRow: () => row,
      getNumRows: () => count,
      getDisplayValues: () => Array.from({ length: count }, (_, i) => Array.from({ length: width }, (_, j) =>
        sheet.displayOverrides.get(`${row + i}:${col + j}`) ?? sheet.data[row + i - 1]?.[col + j - 1] ?? '')),
      isBlank: () => Array.from({ length: count }, (_, i) => Array.from({ length: width }, (_, j) => sheet.data[row + i - 1]?.[col + j - 1]))
        .every(values => values.every(value => value === undefined || value === null || value === '')),
      setNumberFormat() { return this; },
      setDataValidation() { return this; },
      setValues(values: unknown[][]) {
        if (sheet.failWrites) throw new Error('simulated failure');
        sheet.writes.push(...values);
        values.forEach((valuesRow, i) => valuesRow.forEach((v, j) => {
          sheet.data[row + i - 1] ||= [];
          const text = String(v);
          sheet.data[row + i - 1][col + j - 1] = text.startsWith("'") ? text.slice(1) : text;
        }));
        return this;
      },
      setValue(value: unknown) { return this.setValues([[value]]); },
    };
  }
  deleteRow(row: number) { this.data.splice(row - 1, 1); }
  copyTo(book: { sheets: Map<string, FakeSheet> }) {
    const copy = new FakeSheet(this.data.map(row => [...row]));
    return { setName(name: string) { copy.name = name; book.sheets.set(name, copy); return copy; } };
  }
}

function fixture(memberRows: string[][] = [], requestRows: string[][] = []) {
  const members = new FakeSheet([[...MEMBER_HEADERS], ...memberRows]);
  const requests = new FakeSheet([REQUEST_HEADERS, ...requestRows], '가입요청');
  const sheets = new Map([['인증명단', members], ['가입요청', requests]]);
  let selectedSheet = members;
  let selectedRow = 2;
  let selectedCount = 1;
  let activeBook = true;
  const book = { sheets, getSheetByName: (name: string) => sheets.get(name), getId: () => 'synthetic-book',
    getActiveRange: () => selectedSheet.getRange(selectedRow, 1, selectedCount, 1) };
  const properties = new Map([['BUNFIRVIL_SPREADSHEET_ID', 'synthetic-book'], ['BUNFIRVIL_OPERATOR_CODE_SHA256', createHash('sha256').update(OPERATOR_TEST_CODE).digest('hex')]]);
  const userProperties = new Map<string, string>();
  const cache = new Map<string, string>();
  const modals: string[] = [];
  const alerts: string[] = [];
  let lockHeld = false;
  let lockCount = 0;
  const lock = { tryLock: () => { if (lockHeld) throw new Error('nested lock'); lockHeld = true; lockCount++; return true; }, releaseLock() { lockHeld = false; } };
  const propertyStore = (data: Map<string, string>) => ({ getProperty: (key: string) => data.get(key),
    setProperty: (key: string, value: string) => data.set(key, value), deleteProperty: (key: string) => data.delete(key),
    setProperties: (values: Record<string, string>, removeOthers: boolean) => { if (removeOthers) data.clear(); Object.entries(values).forEach(([key, value]) => data.set(key, value)); } });
  let sequence = 0;
  const context = {
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (value: string) => ({ getContent: () => value, setMimeType() { return this; } }),
    },
    PropertiesService: { getScriptProperties: () => propertyStore(properties), getUserProperties: () => propertyStore(userProperties) },
    CacheService: { getScriptCache: () => ({ get: (key: string) => { if (!lockHeld) throw new Error('unlocked counter read'); return cache.get(key); },
      put: (key: string, value: string) => { if (!lockHeld) throw new Error('unlocked counter write'); cache.set(key, value); }, remove: (key: string) => cache.delete(key) }) },
    LockService: { getScriptLock: () => lock },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ forSpreadsheet() { return this; }, onEdit() { return this; }, create() {} }) },
    SpreadsheetApp: { openById: () => book, getActiveSpreadsheet: () => activeBook ? book : null, flush() {},
      newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }),
      getUi: () => ({ ButtonSet: { YES_NO: 'yes-no' }, Button: { YES: 'yes' }, alert: (...args: string[]) => { alerts.push(...args); return 'yes'; },
        showModalDialog: (html: { source: string }) => modals.push(html.source) }) },
    HtmlService: { createHtmlOutput: (source: string) => ({ source, setWidth() { return this; }, setHeight() { return this; } }) },
    Utilities: { getUuid: () => 'id-' + ++sequence, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_: string, value: string) => [...createHash('sha256').update(value).digest()] },
  };
  runInNewContext(readFileSync(resolve(process.cwd(), 'backend/apps-script/Code.gs'), 'utf8'), context);
  const service = context as unknown as Record<string, (...args: any[]) => any>;
  const request = (overrides: Record<string, unknown> = {}) => ({ action: 'verifyHousehold', buildingId: '105', unitType: '55A', nickname: '이웃', memberCode: MEMBER_TEST_CODE, ...overrides });
  const output = (result: { getContent(): string }) => JSON.parse(result.getContent());
  return { service, request, output, members, requests, sheets, properties, userProperties, cache, modals, alerts,
    lockCount: () => lockCount, setActiveBook: (value: boolean) => { activeBook = value; },
    select: (row: number, count = 1, sheet = members) => { selectedRow = row; selectedCount = count; selectedSheet = sheet; } };
}

describe('Google Apps Script requests and membership', () => {
  it('requires the operator code even when a public nickname matches globally', () => {
    const f = fixture([['105', '55A', '운영예시', '운영자']]);
    const request = f.request({ buildingId: '112', unitType: '51A', nickname: '운영예시' });
    expect(f.output(f.service.verifyRequest_(f.members, request, f.requests))).toMatchObject({ verified: false, code: 'operator_code_required' });
    expect(f.output(f.service.verifyRequest_(f.members, { ...request, operatorCode: 'wrong' }, f.requests))).toMatchObject({ verified: false });
    expect(f.output(f.service.verifyRequest_(f.members, { ...request, operatorCode: OPERATOR_TEST_CODE }, f.requests))).toMatchObject({ verified: true, operator: true, operatorVerified: true, authRevision: 2 });
    f.properties.delete('BUNFIRVIL_OPERATOR_CODE_SHA256');
    expect(f.output(f.service.verifyRequest_(f.members, request, f.requests))).toMatchObject({ verified: false, code: 'operator_setup_required' });
  });

  it('does not append requests or elevate roles through operator nickname registration', () => {
    const f = fixture([['105', '55A', '운영예시', '운영자']]);
    const response = f.output(f.service.requestVerification_(f.members, f.request({ nickname: '운영예시', operator: true }), f.requests));
    expect(response).toMatchObject({ verified: false, operator: false });
    expect(f.requests.getLastRow()).toBe(1);
  });

  it('separates exact own-household authentication from cross-type read-only membership', () => {
    const f = fixture([approvedMember()]);
    expect(f.output(f.service.verifyRequest_(f.members, f.request({ unitType: '59A' }), f.requests)).verified).toBe(false);
    expect(f.output(f.service.verifyRequest_(f.members, f.request({ action: 'verifyShareViewer', unitType: '' }), f.requests))).toMatchObject({ verified: true, operator: false, scope: 'share', memberCodeVerified: true, memberCodeRevision: 1 });
    expect(f.output(f.service.verifyRequest_(f.members, f.request({ action: 'verifyShareViewer', buildingId: '106' }), f.requests)).verified).toBe(false);
  });

  it('requires a private member code on every existing-member success path', () => {
    for (const action of ['verifyHousehold', 'verifyShareViewer', 'requestHouseholdVerification']) {
      const f = fixture([approvedMember()]);
      const invoke = (code: string) => f.output(f.service[action === 'requestHouseholdVerification' ? 'requestVerification_' : 'verifyRequest_'](
        f.members, f.request({ action, unitType: action === 'verifyShareViewer' ? '' : '55A', memberCode: code }), f.requests));
      for (const missingOrWrong of ['', 'wrong-code-that-is-long-enough']) {
        expect(invoke(missingOrWrong)).toMatchObject({ verified: false, operator: false, code: 'member_code_required', memberCodeVerified: false });
      }
      const success = invoke(MEMBER_TEST_CODE);
      expect(success).toMatchObject({ verified: true, operator: false, memberCodeVerified: true, memberCodeRevision: 1, authRevision: 2 });
      expect(JSON.stringify(success)).not.toContain(MEMBER_TEST_CODE);
      expect(JSON.stringify(success)).not.toContain(memberDigest(MEMBER_TEST_CODE));
      expect(f.requests.getLastRow()).toBe(1);
    }
    const unissued = fixture([['105', '55A', '이웃', '인증됨', '', '', '']]);
    expect(unissued.output(unissued.service.verifyRequest_(unissued.members, unissued.request(), unissued.requests)))
      .toMatchObject({ verified: false, code: 'member_code_required' });
    // Future callers cannot manufacture success through the response helper.
    expect(unissued.output(unissued.service.verificationOutput_('인증됨', unissued.request())).verified).toBe(false);
  });

  it('locks failed-code counter updates and preserves operator credentials separately', () => {
    const f = fixture([approvedMember()]);
    for (let index = 0; index < 6; index++) {
      expect(f.output(f.service.verifyRequest_(f.members, f.request({ memberCode: 'synthetic-wrong-code-000' }), f.requests)).verified).toBe(false);
    }
    const blocked = f.output(f.service.verifyRequest_(f.members, f.request(), f.requests));
    expect(blocked).toMatchObject({ verified: false, code: 'member_code_required' });
    expect(f.lockCount()).toBe(7);
    expect([...f.cache.keys()]).toEqual([expect.stringMatching(/^member-attempt:[a-f0-9]{64}$/)]);
    expect(JSON.stringify([...f.cache])).not.toMatch(/이웃|synthetic-wrong|synthetic-member/);
    f.cache.clear(); // Simulate expiration of the temporary abuse-mitigation entry.
    expect(f.output(f.service.verifyRequest_(f.members, f.request(), f.requests)).verified).toBe(true);
    expect(f.output(f.service.verifyRequest_(f.members, f.request({ buildingId: '106' }), f.requests)).verified).toBe(false);
    expect(f.output(f.service.verifyRequest_(f.members, f.request({ memberCode: '', operatorCode: OPERATOR_TEST_CODE }), f.requests)).verified).toBe(false);
    f.cache.clear();
    for (let index = 0; index < 6; index++) {
      expect(f.output(f.service.verifyRequest_(f.members, f.request({ memberCode: 'short' }), f.requests)).verified).toBe(false);
    }
    expect(f.output(f.service.verifyRequest_(f.members, f.request(), f.requests)).verified).toBe(false);
  });

  it('binds member hashes to normalized identity, including the stored type in share verification', () => {
    const f = fixture([approvedMember()]);
    expect(f.output(f.service.verifyRequest_(f.members, f.request({ action: 'verifyShareViewer', unitType: '' }), f.requests)).verified).toBe(true);
    for (const [column, value, changed] of [
      [0, '106', { buildingId: '106' }], [1, '59A', { unitType: '59A' }], [2, '다른이웃', { nickname: '다른이웃' }],
    ] as const) {
      const original = f.members.data[1][column];
      f.members.data[1][column] = value;
      expect(f.output(f.service.verifyRequest_(f.members, f.request(changed), f.requests)).verified).toBe(false);
      f.members.data[1][column] = original;
    }
    f.members.data.push(['106', '59A', '다른이웃', '인증됨', f.members.data[1][4], f.members.data[1][5], '']);
    expect(f.output(f.service.verifyRequest_(f.members, f.request({ buildingId: '106', unitType: '59A', nickname: '다른이웃' }), f.requests)).verified).toBe(false);
    expect(f.service.memberCodeDigest_(MEMBER_TEST_CODE, { buildingId: ' ０１０５동 ', unitType: ' ５５ａ ', nickname: ' 이웃 ' }))
      .toBe(memberDigest(MEMBER_TEST_CODE));
  });

  it('adds credential metadata safely without overwriting member data or operator properties', () => {
    const f = fixture([['105', '55A', '이웃', '인증됨']]);
    f.members.data[0] = [...HEADERS]; // Existing four-column production sheet.
    const originalRow = [...f.members.data[1]];
    const operatorHash = f.properties.get('BUNFIRVIL_OPERATOR_CODE_SHA256');
    f.properties.set('UNRELATED_PROPERTY', 'keep');
    f.service.setupVerificationSheet();
    f.service.setupVerificationSheet();
    expect(f.members.data[0]).toEqual(MEMBER_HEADERS);
    expect(f.members.data[1]).toEqual(originalRow);
    expect(f.properties.get('BUNFIRVIL_OPERATOR_CODE_SHA256')).toBe(operatorHash);
    expect(f.properties.get('UNRELATED_PROPERTY')).toBe('keep');
    for (const conflict of ['header', 'data']) {
      const bad = fixture([['105', '55A', '이웃', '인증됨']]);
      bad.members.data[0] = [...HEADERS];
      if (conflict === 'header') bad.members.data[0][4] = '다른 업무';
      else bad.members.data[1][4] = '기존 개인 데이터';
      const before = JSON.stringify(bad.members.data);
      expect(() => bad.service.ensureMemberCodeColumns_(bad.members)).toThrow(/기존 데이터는 변경하지 않았습니다/);
      expect(JSON.stringify(bad.members.data)).toBe(before);
    }
  });

  it('preserves displayed-empty formulas and hidden values in either metadata headers or the last body row', () => {
    for (const [row, value] of [[1, '=IF(TRUE,"",42)'], [4, '=IF(TRUE,"",42)'], [4, '42'], [4, '   ']] as const) {
      const f = fixture([['105', '55A', '이웃', '인증됨'], [], []]);
      f.members.data[0] = [...HEADERS];
      f.members.data[row - 1][6] = value;
      f.members.displayOverrides.set(`${row}:7`, '');
      const before = JSON.stringify(f.members.data);
      expect(f.members.getRange(1, 5, f.members.getLastRow(), 3).getDisplayValues().flat().every(value => value === '')).toBe(true);
      expect(() => f.service.ensureMemberCodeColumns_(f.members)).toThrow(/기존 데이터는 변경하지 않았습니다/);
      expect(JSON.stringify(f.members.data)).toBe(before);
    }
    const blank = fixture([['105', '55A', '이웃', '인증됨']]);
    blank.members.data[0] = [...HEADERS];
    blank.members.getRange(1, 5, 2, 3).setNumberFormat(); // Formatting alone contains no raw value/formula.
    blank.service.ensureMemberCodeColumns_(blank.members);
    expect(blank.members.data[0]).toEqual(MEMBER_HEADERS);
    const existing = fixture([['105', '55A', '이웃', '인증됨', '=IF(TRUE,"",42)']]);
    existing.members.displayOverrides.set('2:5', '');
    const before = JSON.stringify(existing.members.data);
    existing.service.ensureMemberCodeColumns_(existing.members); // Correct headers preserve the body unconditionally.
    expect(JSON.stringify(existing.members.data)).toBe(before);
  });

  it('issues, reissues and revokes only the selected approved member, retaining hashes only', () => {
    const f = fixture([['105', '55A', '이웃', '인증됨'], ['106', '59A', '다른이웃', '인증됨', '', '', '']]);
    const identity = { buildingId: '105', unitType: '55A', nickname: '이웃' };
    const untouched = JSON.stringify(f.members.data[2]);
    const issue = (code: string) => {
      f.service.issueSelectedMemberCode();
      const descriptor = JSON.parse(f.userProperties.get('BUNFIRVIL_MEMBER_CODE_DIALOG')!);
      expect(descriptor.identity).toEqual(identity);
      const result = f.service.saveSelectedMemberCode({ ...descriptor, code });
      expect(result).toEqual({ ok: true });
      expect(JSON.stringify(result)).not.toContain(code);
      expect(f.userProperties.size).toBe(0);
    };
    issue(MEMBER_TEST_CODE);
    expect(f.members.data[1].slice(0, 4)).toEqual(['105', '55A', '이웃', '인증됨']);
    expect(f.members.data[1][4]).toBe(memberDigest(MEMBER_TEST_CODE));
    expect(f.members.data[1][5]).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(f.members.data[1][6]).toBe('');
    expect(f.output(f.service.verifyRequest_(f.members, f.request(), f.requests)).verified).toBe(true);
    issue(MEMBER_REISSUED_CODE);
    expect(f.output(f.service.verifyRequest_(f.members, f.request(), f.requests)).verified).toBe(false);
    expect(f.output(f.service.verifyRequest_(f.members, f.request({ memberCode: MEMBER_REISSUED_CODE }), f.requests)).verified).toBe(true);
    const issuedAt = f.members.data[1][5];
    f.service.revokeSelectedMemberCode();
    expect(f.members.data[1][4]).toBe('');
    expect(f.members.data[1][5]).toBe(issuedAt);
    expect(f.members.data[1][6]).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(f.output(f.service.verifyRequest_(f.members, f.request({ memberCode: MEMBER_REISSUED_CODE }), f.requests)).verified).toBe(false);
    expect(JSON.stringify(f.members.data[2])).toBe(untouched);
    for (const code of [MEMBER_TEST_CODE, MEMBER_REISSUED_CODE]) {
      expect(JSON.stringify([f.members.data, f.members.writes, [...f.properties], [...f.userProperties], f.alerts, f.modals])).not.toContain(code);
    }
  });

  it('cannot issue through public POST, changed selections, expired dialogs or non-approved roles', () => {
    for (const status of ['운영자', '중지', '요청', '반려']) {
      const f = fixture([['105', '55A', '이웃', status]]);
      expect(() => f.service.issueSelectedMemberCode()).toThrow(/정상 인증됨/);
      expect(() => f.service.revokeSelectedMemberCode()).toThrow(/정상 인증됨/);
      expect(f.members.data[1]).toEqual(['105', '55A', '이웃', status]);
    }
    const f = fixture([approvedMember(), approvedMember('106', '55B', '다른이웃')]);
    f.select(2, 2);
    expect(() => f.service.issueSelectedMemberCode()).toThrow(/한 행/);
    f.select(1);
    expect(() => f.service.issueSelectedMemberCode()).toThrow(/한 행/);
    f.select(2);
    f.service.issueSelectedMemberCode();
    const payload = { ...JSON.parse(f.userProperties.get('BUNFIRVIL_MEMBER_CODE_DIALOG')!), code: MEMBER_REISSUED_CODE };
    f.select(3);
    expect(() => f.service.saveSelectedMemberCode(payload)).toThrow(/선택 회원이 바뀌었습니다/);
    f.select(2);
    f.setActiveBook(false);
    expect(() => f.service.saveSelectedMemberCode(payload)).toThrow(/원본 Google Sheet/);
    f.setActiveBook(true);
    f.members.data[1][3] = '중지';
    expect(() => f.service.saveSelectedMemberCode(payload)).toThrow(/정상 인증됨/);
    f.members.data[1][3] = '인증됨';
    const key = 'BUNFIRVIL_MEMBER_CODE_DIALOG';
    const descriptor = JSON.parse(f.userProperties.get(key)!);
    f.userProperties.set(key, JSON.stringify({ ...descriptor, createdAt: Date.now() - 300001 }));
    expect(() => f.service.saveSelectedMemberCode(payload)).toThrow(/발급 창을 닫고/);
    expect(f.members.data[1][4]).toBe(memberDigest(MEMBER_TEST_CODE));
    const response = f.output(f.service.doPost({ postData: { contents: JSON.stringify({ schemaVersion: 1, action: 'saveSelectedMemberCode', ...payload }) } }));
    expect(response).toMatchObject({ ok: false, verified: false, code: 'invalid_request' });
    expect(f.members.data[1][4]).toBe(memberDigest(MEMBER_TEST_CODE));
  });

  it('generates browser-crypto codes and reveals the original only after successful hash storage', () => {
    const f = fixture([approvedMember()]);
    f.service.issueSelectedMemberCode();
    const html = f.modals[0];
    expect(html).toContain('new Uint8Array(32)');
    expect(html).toContain('window.crypto.getRandomValues(bytes)');
    expect(html).not.toMatch(/Math\.random|getUuid|localStorage|sessionStorage/);
    const elements: Record<string, any> = Object.fromEntries(['member', 'generate', 'manual-save', 'manual', 'message', 'result', 'code', 'copy', 'close']
      .map(id => [id, { value: '', textContent: '', hidden: id === 'result', disabled: false }]));
    let success: (value: unknown) => void = () => {};
    let rpcPayload: any;
    const runner = { withSuccessHandler(callback: typeof success) { success = callback; return this; },
      withFailureHandler() { return this; }, saveSelectedMemberCode(payload: unknown) { rpcPayload = payload; } };
    runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)![1], {
      document: { getElementById: (id: string) => elements[id] }, window: { crypto: { getRandomValues: (bytes: Uint8Array) => bytes.fill(23) } },
      Uint8Array, btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'), navigator: {}, google: { script: { run: runner, host: { close() {} } } },
    });
    elements.generate.onclick();
    expect(rpcPayload.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(elements.result.hidden).toBe(true);
    expect(elements.code.value).toBe('');
    const result = f.service.saveSelectedMemberCode(rpcPayload);
    success(result);
    expect(elements.result.hidden).toBe(false);
    expect(elements.code.value).toBe(rpcPayload.code);
    expect(JSON.stringify(f.members.data)).not.toContain(rpcPayload.code);
    const escaped = f.service.memberCodeDialogHtml_({ row: 2, identity: { buildingId: '105', unitType: '55A', nickname: '</script><b>x' } });
    expect(escaped).not.toContain('"nickname":"</script>');
    expect(escaped).toContain('\\u003c/script\\u003e');
  });

  it('rejects reuse of a currently stored member code without changing either member', () => {
    const f = fixture([approvedMember(), ['106', '59A', '다른이웃', '인증됨', '', '', '']]);
    const before = JSON.stringify(f.members.data);
    for (const row of [2, 3]) {
      f.select(row);
      f.service.issueSelectedMemberCode();
      const descriptor = JSON.parse(f.userProperties.get('BUNFIRVIL_MEMBER_CODE_DIALOG')!);
      expect(() => f.service.saveSelectedMemberCode({ ...descriptor, code: MEMBER_TEST_CODE })).toThrow(/다시 사용할 수 없습니다/);
      expect(JSON.stringify(f.members.data)).toBe(before);
    }
  });

  it('does not let an older dialog for the same member consume a newer issuance context', () => {
    const f = fixture([approvedMember()]);
    const key = 'BUNFIRVIL_MEMBER_CODE_DIALOG';
    f.service.issueSelectedMemberCode();
    const oldDialog = JSON.parse(f.userProperties.get(key)!);
    f.service.issueSelectedMemberCode();
    const newDialog = JSON.parse(f.userProperties.get(key)!);
    expect(oldDialog.dialogId).not.toBe(newDialog.dialogId);
    expect(() => f.service.saveSelectedMemberCode({ ...oldDialog, code: MEMBER_REISSUED_CODE })).toThrow(/발급 창을 닫고/);
    expect(JSON.parse(f.userProperties.get(key)!)).toEqual(newDialog);
    expect(f.members.data[1][4]).toBe(memberDigest(MEMBER_TEST_CODE));
    expect(f.service.saveSelectedMemberCode({ ...newDialog, code: MEMBER_REISSUED_CODE })).toEqual({ ok: true });
    expect(f.members.data[1][4]).toBe(memberDigest(MEMBER_REISSUED_CODE));
  });

  it('ignores duplicate pending rows and reads approved members past row 5000', () => {
    const f = fixture([['105', '55A', '이웃', '요청'], ...Array.from({ length: 5000 }, () => ['', '', '', '']), approvedMember()]);
    expect(f.output(f.service.verifyRequest_(f.members, f.request(), f.requests)).verified).toBe(true);
    f.members.data.push(['105', '55A', '이웃', '중지']);
    expect(f.output(f.service.verifyRequest_(f.members, f.request(), f.requests)).verified).toBe(false);
  });

  it('writes requests only into the queue, deduplicates and stores formulas as text', () => {
    const f = fixture();
    const request = f.request({ action: 'requestHouseholdVerification', nickname: '=1+1' });
    const first = f.output(f.service.requestVerification_(f.members, request, f.requests));
    expect(first).toMatchObject({ requested: true, verified: false });
    expect(f.requests.writes[0][4]).toBe("'=1+1");
    expect(f.requests.data[1][4]).toBe('=1+1');
    f.service.requestVerification_(f.members, request, f.requests);
    expect(f.requests.getLastRow()).toBe(2);
    expect(f.members.getLastRow()).toBe(1);
    expect(f.output(f.service.verifyRequest_(f.members, request, f.requests)).verified).toBe(false);
  });

  it('approves idempotently and does not claim success when member writing failed', () => {
    const f = fixture([], [['r1', '', '105', '55A', '이웃', '승인', '', '']]);
    f.members.failWrites = true;
    f.service.processPendingDecisions();
    expect(f.requests.data[1][6]).toContain('처리 실패');
    expect(f.members.getLastRow()).toBe(1);
    f.members.failWrites = false;
    f.service.processPendingDecisions();
    expect(f.members.data[1]).toEqual(['105', '55A', '이웃', '인증됨']);
    expect(f.requests.data[1][6]).toBe('승인 완료');
    // Retry after a lost success marker must not duplicate the member.
    f.requests.data[1][6] = '';
    f.service.processPendingDecisions();
    expect(f.members.getLastRow()).toBe(2);
  });

  it('never promotes an operator or reactivates a suspended member through approval', () => {
    for (const status of ['운영자', '중지']) {
      const f = fixture([['105', '55A', '이웃', status]], [['r1', '', '105', '55A', '이웃', '승인', '', '']]);
      f.service.processPendingDecisions();
      expect(f.requests.data[1][6]).toContain('처리 실패');
      expect(f.members.data[1][3]).toBe(status);
    }
  });

  it('keeps rejection on resubmission and enforces queue capacity', () => {
    const rejected = fixture([], [['r1', '', '105', '55A', '이웃', '반려', '반려 완료', '']]);
    expect(rejected.output(rejected.service.requestVerification_(rejected.members, rejected.request(), rejected.requests))).toMatchObject({ verified: false, status: 'rejected' });
    const full = fixture([], Array.from({ length: 300 }, (_, i) => [String(i), '', '105', '55A', '대기' + i, '대기', '', '']));
    expect(full.output(full.service.requestVerification_(full.members, full.request(), full.requests))).toMatchObject({ ok: false, code: 'request_capacity' });
  });

  it('backs up legacy requests before moving and leaves all approved members intact', () => {
    const f = fixture([['105', '55A', '이웃', '요청'], ['106', '59A', '회원예시', '인증됨']]);
    f.service.migrateLegacyRequests();
    expect(f.sheets.size).toBe(3);
    expect([...f.sheets.keys()].some(name => name.startsWith('인증백업-'))).toBe(true);
    expect(f.requests.data[1].slice(2, 6)).toEqual(['105', '55A', '이웃', '대기']);
    expect(f.members.data).toEqual([MEMBER_HEADERS, ['106', '59A', '회원예시', '인증됨']]);
    f.service.migrateLegacyRequests();
    expect(f.requests.getLastRow()).toBe(2);
  });

  it('validates normalization, request size and control characters', () => {
    const f = fixture();
    expect(f.service.normalizeBuilding_(' ０１０５동 ')).toBe('105');
    expect(f.service.normalizeUnitType_(' ５５ａ ')).toBe('55A');
    expect(f.service.normalizeNickname_(' Ａbc 이웃 ')).toBe('Abc 이웃');
    const parse = (p: object) => f.service.parseVerificationRequest_({ postData: { contents: JSON.stringify({ schemaVersion: 1, ...f.request(), ...p }) } });
    expect(parse({ nickname: 'bad\nname' })).toBeNull();
    expect(parse({ nickname: 'x'.repeat(3000) })).toBeNull();
    expect(parse({ action: 'approveMember' })).toBeNull();
    expect(parse({ action: 'verifyShareViewer', unitType: '' })).toMatchObject({ unitType: '' });
  });
});
