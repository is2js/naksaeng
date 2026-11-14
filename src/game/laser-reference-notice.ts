export const LASER_REFERENCE_BLOG_URL = 'https://m.blog.naver.com/PostView.naver?blogId=sale_news&logNo=224367585580&proxyReferer=&noTrackingCode=true';

/** One non-modal warning per page lifetime. It deliberately writes no storage. */
export class LaserReferenceNotice {
  private shown = false;
  private destroyed = false;
  private finished = false;
  private suspended = false;
  private hovering = false;
  private focused = false;
  private element: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private remainingMs = 0;

  constructor(
    private readonly getHost: () => HTMLElement | null,
    private readonly isMobile: () => boolean,
  ) {}

  showOnce(): void {
    if (this.shown || this.destroyed) return;
    const host = this.getHost();
    if (!host) return;
    this.shown = true;
    const mobile = this.isMobile();
    const notice = document.createElement('div');
    notice.id = 'inspection-laser-reference-notice';
    notice.className = 'laser-reference-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('aria-atomic', 'true');
    const link = document.createElement('a');
    link.href = LASER_REFERENCE_BLOG_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '이 블로그';
    link.setAttribute('aria-label', '실측 참고 블로그 새 탭에서 열기');
    notice.append(
      document.createTextNode(mobile ? '실측은 ' : '실측 수치는 '),
      link,
      document.createTextNode(mobile
        ? ' 참고값입니다. 실제와 다를 수 있습니다.'
        : '를 참고한 가상 치수이며, 실제와 일치하지 않을 수 있습니다.'),
    );
    notice.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      this.hold('hovering', true);
    });
    notice.addEventListener('pointerleave', () => this.hold('hovering', false));
    notice.addEventListener('focusin', () => this.hold('focused', true));
    notice.addEventListener('focusout', event => {
      if (!notice.contains(event.relatedTarget as Node | null)) this.hold('focused', false);
    });
    // Native link activation is preserved, but must never place a laser point.
    for (const name of ['pointerdown', 'pointerup', 'pointermove', 'click', 'contextmenu']) {
      notice.addEventListener(name, event => event.stopPropagation());
    }
    this.element = notice;
    this.remainingMs = mobile ? 4_000 : 6_000;
    notice.hidden = this.suspended;
    host.append(notice);
    this.armTimer();
  }

  pause(): void {
    if (this.suspended || this.destroyed) return;
    this.stopTimer();
    this.suspended = true;
    this.hovering = false;
    if (this.element) this.element.hidden = true;
  }

  resume(): void {
    if (!this.suspended || this.destroyed) return;
    this.suspended = false;
    if (!this.element || this.finished) return;
    this.focused = this.element.contains(document.activeElement);
    this.element.hidden = false;
    this.armTimer();
  }

  destroy(): void {
    this.stopTimer();
    this.destroyed = true;
    this.element?.remove();
    this.element = null;
  }

  private hold(key: 'hovering' | 'focused', value: boolean): void {
    if (this.destroyed || this.finished || this[key] === value) return;
    this.stopTimer();
    this[key] = value;
    this.armTimer();
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.remainingMs = Math.max(0, this.remainingMs - (Date.now() - this.startedAt));
    clearTimeout(this.timer);
    this.timer = null;
  }

  private armTimer(): void {
    if (!this.element || this.timer !== null || this.destroyed || this.finished
      || this.suspended || this.hovering || this.focused) return;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.remainingMs = 0;
      this.finished = true;
      if (this.element) this.element.hidden = true;
    }, this.remainingMs);
  }
}
