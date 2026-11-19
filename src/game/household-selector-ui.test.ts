import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ShowcaseApp } from './app';
import { householdEntryNicknameIsValid, waitForHouseholdSelection } from './household-selector';
import { householdNicknameIsValid, type HouseholdVerificationConfigV1 } from './household-verification';
import type { ShowcaseCatalog, StaticMapEntry } from './types';

const maps = ['51A', '55A', '55B', '59A'].map(unitType => ({
  id: `bundang-first-village-${unitType.toLowerCase()}-prototype`,
  unitType, label: `${unitType} 놀이터`, revision: 'test',
})) as StaticMapEntry[];
const catalog = { exportId: 'ui-test', maps } as ShowcaseCatalog;
const config: HouseholdVerificationConfigV1 = {
  schemaVersion: 1, enabled: true, provider: 'google-apps-script',
  endpoint: 'https://script.google.com/macros/s/selector-ui-test/exec', timeoutMs: 8_000,
};

/** The selector only needs element state/listeners; no browser or Three.js is started. */
class SelectorElement {
  innerHTML = '';
  textContent = '';
  value = '';
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  classes = new Set<string>();
  classList = {
    add: (...values: string[]) => { values.forEach(value => this.classes.add(value)); },
    remove: (...values: string[]) => { values.forEach(value => this.classes.delete(value)); },
    toggle: (value: string, force?: boolean) => {
      const active = force ?? !this.classes.has(value);
      if (active) this.classes.add(value); else this.classes.delete(value);
      return active;
    },
  };
  focus = vi.fn();
  append = vi.fn();
  private listeners = new Map<string, Array<(event: any) => void>>();
  private children = new Map<string, SelectorElement>();
  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  emit(type: string, event: object = {}): void {
    for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
  }
  click(): void { if (!this.disabled) this.emit('click'); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  querySelector(selector: string): SelectorElement {
    if (!this.children.has(selector)) this.children.set(selector, new SelectorElement());
    return this.children.get(selector)!;
  }
  querySelectorAll(): SelectorElement[] { return []; }
}

function selectorFixture(shareAuthentication = false, enabled = true) {
  const nodes = new Map<string, SelectorElement>();
  const node = (selector: string): SelectorElement => {
    if (!nodes.has(selector)) nodes.set(selector, new SelectorElement());
    return nodes.get(selector)!;
  };
  const mount = {
    innerHTML: '', querySelector: node, querySelectorAll: () => [],
  };
  const result = waitForHouseholdSelection(mount as unknown as HTMLElement, catalog, false,
    enabled ? config : { ...config, enabled: false, endpoint: '' }, shareAuthentication);
  node('#household-building-picker').emit('click', {
    target: { closest: () => ({ dataset: { chooseBuilding: '106' } }) },
  });
  if (!shareAuthentication) {
    node('#household-building-rows').emit('click', {
      target: { closest: () => ({ dataset: { building: '106', floor: '20', line: '3' } }) },
    });
  }
  const inputNickname = (value: string): void => {
    node('#household-nickname').value = value;
    node('#household-nickname').emit('input');
  };
  return { mount, node, result, inputNickname };
}

function stubBrowser(mobile = false): void {
  vi.stubGlobal('window', {
    location: { href: 'https://example.test/naksaeng/bunfirvil/', pathname: '/naksaeng/bunfirvil/', search: '', hash: '' },
    addEventListener: vi.fn(), removeEventListener: vi.fn(), visualViewport: null,
    matchMedia: () => ({ matches: mobile, addEventListener: vi.fn() }),
    sessionStorage: { getItem: () => null },
  });
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('history', { pushState: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('public-first nickname entry UI', () => {
  it('requires two normalized code points without changing the verification service contract', () => {
    expect(householdEntryNicknameIsValid('  ＡＢ  ')).toBe(true);
    expect(householdEntryNicknameIsValid('이웃')).toBe(true);
    expect(householdEntryNicknameIsValid('  Ａ  ')).toBe(false);
    expect(householdEntryNicknameIsValid('가')).toBe(false);
    expect(householdEntryNicknameIsValid('😀')).toBe(false);
    expect(householdEntryNicknameIsValid('이\n웃')).toBe(false);
    expect(householdEntryNicknameIsValid('가'.repeat(21))).toBe(false);
    expect(householdNicknameIsValid('가')).toBe(true);
  });

  it('keeps one authentication button beside the selection, not beside the nickname input', () => {
    stubBrowser();
    const { mount, node } = selectorFixture();
    expect(mount.innerHTML.match(/id="household-verify-nickname"/g)).toHaveLength(1);
    expect(mount.innerHTML).toMatch(/class="household-nickname-selection">\s*<span id="household-nickname-building"[^>]*><\/span>\s*<button[^>]*id="household-verify-nickname"[^>]*>인증<\/button>/);
    const inputGroup = mount.innerHTML.match(/<div class="household-nickname-controls">([\s\S]*?)<\/div>/)?.[1];
    expect(inputGroup).toContain('id="household-nickname"');
    expect(inputGroup).not.toContain('<button');
    expect(node('#household-nickname-building').textContent).toBe('106동 2003호 선택됨');
    expect(node('#household-nickname').focus).toHaveBeenCalledOnce();
    expect(mount.innerHTML).toContain('해당 닉네임으로 등록 요청');
  });

  it.each([false, true])('allows public entry with two characters without an HTTP request (share=%s)', async share => {
    stubBrowser();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { node, result, inputNickname } = selectorFixture(share, false);
    inputNickname(' 가 ');
    expect(node('#household-enter').disabled).toBe(true);
    inputNickname('  ＡＢ  ');
    expect(node('#household-enter').disabled).toBe(false);
    expect(node('#household-verify-nickname').disabled).toBe(true);
    node('#household-enter').click();
    await expect(result).resolves.toMatchObject({ role: 'public', nickname: 'AB' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses the same inline button for mobile entry and never submits Korean IME confirmation (share=%s)', async share => {
    stubBrowser(true);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { node, result, inputNickname } = selectorFixture(share);
    const enter = node('#household-enter');
    const input = node('#household-nickname');
    expect(node('.household-selector-shell').classes.has('has-inline-entry')).toBe(true);
    expect(node('.household-nickname-controls').append).toHaveBeenCalledExactlyOnceWith(enter);
    expect(enter.textContent).toBe(share ? '열람' : '입장');
    expect(enter.disabled).toBe(true);
    expect(input.attributes.get('enterkeyhint')).toBe('go');
    inputNickname('한');
    expect(enter.disabled).toBe(true);
    inputNickname('한글');
    expect(enter.disabled).toBe(false);
    expect(enter.classes.has('is-entry-revealing')).toBe(true);
    const click = vi.spyOn(enter, 'click');
    const preventDefault = vi.fn();
    input.emit('keydown', { key: 'Enter', keyCode: 229, isComposing: false, preventDefault });
    input.emit('keydown', { key: 'Enter', keyCode: 13, isComposing: true, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    input.emit('keydown', { key: 'Enter', isComposing: false, preventDefault });
    expect(click).toHaveBeenCalledOnce();
    await expect(result).resolves.toMatchObject({ role: 'public', nickname: '한글' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('only binds local reset in ordinary entry, never in share entry (share=%s)', share => {
    stubBrowser();
    const confirm = vi.fn(() => false);
    Object.assign(window, { confirm });
    const { mount, node } = selectorFixture(share, false);
    for (const id of ['selector-open-storage', 'selector-storage-dialog', 'selector-reset-all']) {
      expect(mount.innerHTML.includes(`id="${id}"`)).toBe(!share);
    }
    node('#selector-reset-all').click();
    expect(confirm).toHaveBeenCalledTimes(share ? 0 : 1);
  });

  it.each([false, true])('reveals the ready dock only on an invalid-to-valid transition (share=%s)', share => {
    stubBrowser();
    const { node, inputNickname } = selectorFixture(share);
    const dock = node('#household-selection-dock');
    const add = vi.spyOn(dock.classList, 'add');
    const readyAnimations = () => add.mock.calls.filter(args => args.includes('is-entry-revealing')).length;
    inputNickname('가');
    expect(readyAnimations()).toBe(0);
    inputNickname('가나');
    expect(readyAnimations()).toBe(1);
    expect(dock.classes.has('is-entry-ready')).toBe(true);
    expect(dock.dataset.entryRole).toBe('public');
    inputNickname('가나다');
    inputNickname('가나다라');
    expect(readyAnimations()).toBe(1);
    inputNickname('가');
    expect(dock.classes.has('is-entry-ready')).toBe(false);
    expect(dock.classes.has('is-entry-revealing')).toBe(false);
    inputNickname('가나');
    expect(readyAnimations()).toBe(2);
  });

  it.each(['verified', 'operator'] as const)('preserves Enter authentication and gives %s one separate authenticated reveal', async role => {
    stubBrowser();
    const operator = role === 'operator';
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      schemaVersion: 1, authRevision: 2, ok: true, verified: true,
      operator, operatorVerified: operator, memberCodeVerified: !operator, memberCodeRevision: 1, requested: false, status: role,
    })));
    vi.stubGlobal('fetch', fetch);
    const { node, result, inputNickname } = selectorFixture();
    const dock = node('#household-selection-dock');
    const add = vi.spyOn(dock.classList, 'add');
    inputNickname('운영이웃');
    node('#household-operator-code').value = operator ? 'test-operator-code' : 'test-member-code';
    const preventDefault = vi.fn();
    node('#household-nickname').emit('keydown', { key: 'Enter', isComposing: false, preventDefault });
    await vi.waitFor(() => expect(node('#household-verify-nickname').textContent).toBe('인증 완료'));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    const request = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(request).toMatchObject({ buildingId: '106', unitType: '55A', nickname: '운영이웃' });
    if (operator) expect(request.operatorCode).toBe('test-operator-code');
    else expect(request.memberCode).toBe('test-member-code');
    expect(dock.dataset.entryRole).toBe(role);
    expect(dock.classes.has('is-authenticated')).toBe(true);
    expect(dock.classes.has('is-auth-revealing')).toBe(true);
    expect(dock.classes.has('is-entry-revealing')).toBe(false);
    expect(add.mock.calls.filter(args => args.includes('is-entry-revealing'))).toHaveLength(1);
    expect(add.mock.calls.filter(args => args.includes('is-auth-revealing'))).toHaveLength(1);
    node('#household-verify-nickname').click();
    expect(fetch).toHaveBeenCalledOnce();
    expect(add.mock.calls.filter(args => args.includes('is-auth-revealing'))).toHaveLength(1);
    node('#household-enter').click();
    await expect(result).resolves.toMatchObject({ role, nickname: '운영이웃', selection: { unitType: '55A' } });
  });

  it.each([false, true])('requires a member code and clears it after success or identity changes (share=%s)', async share => {
    stubBrowser();
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const valid = request.memberCode === 'synthetic-member-code-A1';
      return new Response(JSON.stringify({
        schemaVersion: 1, authRevision: 2, ok: true, verified: valid, operator: false,
        status: valid ? 'verified' : 'not_found', scope: share ? 'share' : 'playground',
        ...(valid ? { memberCodeVerified: true, memberCodeRevision: 1 } : { code: 'member_code_required' }),
      }));
    });
    vi.stubGlobal('fetch', fetch);
    const { node, inputNickname, result } = selectorFixture(share);
    inputNickname('회원이웃');
    node('#household-verify-nickname').click();
    await vi.waitFor(() => expect(node('#household-operator-code-group').hidden).toBe(false));
    expect(node('#household-selection-dock').dataset.entryRole).toBe('public');
    expect(node('#household-enter').disabled).toBe(false);
    node('#household-operator-code').value = 'not-the-member-code';
    node('#household-operator-code').emit('input');
    inputNickname('다른이웃');
    expect(node('#household-operator-code').value).toBe('');
    expect(node('#household-operator-code-group').hidden).toBe(true);
    inputNickname('회원이웃');
    node('#household-operator-code').value = 'synthetic-member-code-A1';
    node('#household-operator-code').emit('input');
    node('#household-verify-nickname').click();
    await vi.waitFor(() => expect(node('#household-verify-nickname').textContent).toBe('인증 완료'));
    expect(node('#household-operator-code').value).toBe('');
    expect(node('#household-operator-code').disabled).toBe(true);
    expect(node('#household-selection-dock').dataset.entryRole).toBe('verified');
    node('#household-enter').click();
    await expect(result).resolves.toMatchObject({ role: 'verified', nickname: '회원이웃' });
  });

  it('does not promote a registration request even if its response claims successful membership', async () => {
    stubBrowser();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1, ok: true, verified: true, operator: false, status: 'verified', memberCodeVerified: true, memberCodeRevision: 1,
    }))));
    const { node, inputNickname } = selectorFixture();
    inputNickname('회원이웃');
    node('#household-request-verification').click();
    await vi.waitFor(() => expect(node('#household-request-verification').attributes.has('aria-busy')).toBe(false));
    expect(node('#household-selection-dock').dataset.entryRole).toBe('public');
    expect(node('#household-verify-nickname').textContent).not.toBe('인증 완료');
  });

  it('keeps a static mobile selection summary and disables reveal motion for reduced-motion users', () => {
    const css = readFileSync(new URL('../styles/household-input.css', import.meta.url), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important/);
    expect(css).toMatch(/\.household-selector-shell\.has-inline-entry \.household-selection-dock\s*\{[^}]*position: static;/);
    expect(css).toContain('.household-selection-dock.is-entry-ready:not(.is-authenticated)');
    expect(css).toContain('.household-selection-dock.is-entry-ready.is-authenticated[data-entry-role]');
  });
});

describe('palette and operator controls visibility', () => {
  function shell(role: 'public' | 'verified' | 'operator', readOnlyShare = false): string {
    stubBrowser();
    const mount = { innerHTML: '' };
    const app = Object.create(ShowcaseApp.prototype) as any;
    Object.assign(app, { mount, catalog, accessRole: role, readOnlyShare, currentMap: maps[1], planVariant: 'A', activeActor: '100' });
    app.playgroundReturnUrl = () => 'https://example.test/naksaeng/bunfirvil/';
    app.renderShell(false);
    return mount.innerHTML;
  }

  it('hides the entire public tabstrip but leaves the option content available', () => {
    const html = shell('public');
    expect(html).toMatch(/<div class="palette-tabs"[^>]* hidden>/);
    expect(html).toMatch(/<div id="option-palette-body">/);
    expect(html).toMatch(/<div class="control-deck is-user-hidden">/);
  });

  it.each(['verified', 'operator'] as const)('keeps the %s normal palette tabstrip', role => {
    const html = shell(role);
    expect(html.match(/<div class="palette-tabs"[^>]*>/)?.[0]).not.toContain('hidden');
    expect(html.match(/<button[^>]*data-palette-tab="furniture"[^>]*>/)?.[0]).not.toContain('disabled');
    if (role === 'operator') {
      expect(html).toMatch(/<div class="control-deck ">/);
      expect(html).toContain('id="map-select"');
      expect(html).toContain('aria-label="평면 타입 선택"');
      expect(html).toContain('검수맵 관리');
      expect(html).toContain('건축물 관리');
      expect(html).toContain('인테리어 관리');
      expect(html).toMatch(/<div class="map-tabs "/);
    }
  });

  it.each(['public', 'verified', 'operator'] as const)('keeps the %s shared palette read-only', role => {
    const html = shell(role, true);
    expect(html).toMatch(/<div class="palette-tabs"[^>]* hidden>/);
    expect(html).toMatch(/<div id="option-palette-body">/);
    expect(html).toMatch(/id="palette-applied-only"[^>]*hidden disabled/);
    const app = Object.create(ShowcaseApp.prototype) as any;
    Object.assign(app, { accessRole: role, readOnlyShare: true, paletteTab: 'options', mount: { querySelectorAll: vi.fn() } });
    app.setPaletteTab('furniture');
    expect(app.paletteTab).toBe('options');
    expect(app.mount.querySelectorAll).not.toHaveBeenCalled();
  });
});
