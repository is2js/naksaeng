import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LASER_REFERENCE_BLOG_URL, LaserReferenceNotice } from './laser-reference-notice';

class FakeElement extends EventTarget {
  id = '';
  className = '';
  hidden = false;
  href = '';
  target = '';
  rel = '';
  ownText = '';
  parent: FakeElement | null = null;
  children: Array<FakeElement | { textContent: string }> = [];
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  style = { setProperty: vi.fn(), removeProperty: vi.fn() };
  constructor(readonly tagName: string) { super(); }
  set textContent(value: string) { this.ownText = value; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
  getBoundingClientRect(): { height: number } { return { height: 48 }; }
  querySelector(): null { return null; }
  focus(): void { /* focus restoration is exercised in Chromium */ }
  append(...children: Array<FakeElement | { textContent: string }>): void {
    this.children.push(...children);
    for (const child of children) if (child instanceof FakeElement) child.parent = this;
  }
  contains(target: unknown): boolean {
    return this === target || this.children.some(child => child instanceof FakeElement && child.contains(target));
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
}

describe('first laser reference notice', () => {
  let host: FakeElement;
  let fakeDocument: { activeElement: FakeElement | null; createElement: (name: string) => FakeElement; createTextNode: (text: string) => { textContent: string } };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    host = new FakeElement('section');
    fakeDocument = {
      activeElement: null,
      createElement: name => new FakeElement(name),
      createTextNode: text => ({ textContent: text }),
    };
    vi.stubGlobal('document', fakeDocument);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const make = (getHost: () => FakeElement | null, mobile = false) =>
    new LaserReferenceNotice(() => getHost() as unknown as HTMLElement | null, () => mobile);
  const noticeNode = (parent: FakeElement) => parent.children[0] as FakeElement;

  it('shows a literal new-tab source link and expires only once in the current page', () => {
    const controller = make(() => host);
    controller.showOnce();
    const node = noticeNode(host);
    const link = node.children[1] as FakeElement;
    expect(node.id).toBe('inspection-laser-reference-notice');
    expect(node.attributes.get('role')).toBe('status');
    expect(node.textContent).toBe('실측 수치는 이 블로그를 참고한 가상 치수이며, 실제와 일치하지 않을 수 있습니다.');
    expect(link.href).toBe(LASER_REFERENCE_BLOG_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    controller.showOnce();
    expect(host.children).toHaveLength(1);
    vi.advanceTimersByTime(2_999);
    expect(node.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(node.hidden).toBe(true);
    controller.showOnce();
    expect(node.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses brief mobile copy and three seconds without a hover trap from touch', () => {
    const controller = make(() => host, true);
    controller.showOnce();
    const node = noticeNode(host);
    expect(node.textContent).toBe('실측은 이 블로그 참고값입니다. 실제와 다를 수 있습니다.');
    const touch = new Event('pointerenter');
    Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    node.dispatchEvent(touch);
    vi.advanceTimersByTime(3_000);
    expect(node.hidden).toBe(true);
  });

  it('expires at three seconds even while hovered or focused', () => {
    const controller = make(() => host);
    controller.showOnce();
    const node = noticeNode(host);
    vi.advanceTimersByTime(2_000);
    node.dispatchEvent(new Event('pointerenter'));
    node.dispatchEvent(new Event('focusin'));
    vi.advanceTimersByTime(999);
    expect(node.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(node.hidden).toBe(true);
  });

  it('suspends for BFCache without repeating the warning on resume', () => {
    const controller = make(() => host, true);
    controller.showOnce();
    const node = noticeNode(host);
    vi.advanceTimersByTime(1_000);
    controller.pause();
    controller.pause();
    expect(node.hidden).toBe(true);
    vi.advanceTimersByTime(50_000);
    controller.resume();
    controller.resume();
    expect(node.hidden).toBe(true);
    expect(host.children).toHaveLength(1);
    expect(host.dataset.laserReferenceNotice).toBe('hidden');
    controller.pause();
    controller.resume();
    expect(node.hidden).toBe(true);
  });

  it('does not consume the warning before a host exists, and a new page can show it again', () => {
    let currentHost: FakeElement | null = null;
    const controller = make(() => currentHost);
    controller.showOnce();
    currentHost = host;
    controller.showOnce();
    expect(host.children).toHaveLength(1);
    controller.destroy();
    expect(host.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    controller.showOnce();
    expect(host.children).toHaveLength(0);
    const newPage = make(() => host);
    newPage.showOnce();
    expect(noticeNode(host).hidden).toBe(false);
    newPage.destroy();
  });

  it('stops measurement event propagation without cancelling native link activation', () => {
    const controller = make(() => host);
    controller.showOnce();
    for (const name of ['pointerdown', 'pointerup', 'pointermove', 'click', 'contextmenu']) {
      const event = new Event(name, { bubbles: true, cancelable: true });
      const stop = vi.spyOn(event, 'stopPropagation');
      noticeNode(host).dispatchEvent(event);
      expect(stop).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(false);
    }
    controller.destroy();
  });
});
