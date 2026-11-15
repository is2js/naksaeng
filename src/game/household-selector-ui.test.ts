import { afterEach, describe, expect, it, vi } from 'vitest';
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
  private listeners = new Map<string, Array<(event: any) => void>>();
  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  emit(type: string, event: object = {}): void {
    for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
  }
  click(): void { if (!this.disabled) this.emit('click'); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
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

function stubBrowser(): void {
  vi.stubGlobal('window', {
    location: { href: 'https://example.test/naksaeng/bunfirvil/', pathname: '/naksaeng/bunfirvil/', search: '', hash: '' },
    addEventListener: vi.fn(), removeEventListener: vi.fn(), visualViewport: null,
    sessionStorage: { getItem: () => null },
  });
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

  it('preserves Enter authentication and returns the server-confirmed operator role', async () => {
    stubBrowser();
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      schemaVersion: 1, authRevision: 2, ok: true, verified: true,
      operator: true, operatorVerified: true, requested: false, status: 'operator',
    })));
    vi.stubGlobal('fetch', fetch);
    const { node, result, inputNickname } = selectorFixture();
    inputNickname('운영이웃');
    node('#household-operator-code').value = 'test-operator-code';
    const preventDefault = vi.fn();
    node('#household-nickname').emit('keydown', { key: 'Enter', isComposing: false, preventDefault });
    await vi.waitFor(() => expect(node('#household-verify-nickname').textContent).toBe('인증 완료'));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
      buildingId: '106', unitType: '55A', nickname: '운영이웃', operatorCode: 'test-operator-code',
    });
    node('#household-enter').click();
    await expect(result).resolves.toMatchObject({ role: 'operator', nickname: '운영이웃', selection: { unitType: '55A' } });
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
