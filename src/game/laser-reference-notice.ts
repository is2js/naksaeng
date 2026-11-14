export const LASER_REFERENCE_BLOG_URL = 'https://m.blog.naver.com/PostView.naver?blogId=sale_news&logNo=224367585580&proxyReferer=&noTrackingCode=true';

/** One non-modal warning per page lifetime. It deliberately writes no storage. */
export class LaserReferenceNotice {
  private shown = false;
  private destroyed = false;
  private finished = false;
  private suspended = false;
  private element: HTMLDivElement | null = null;
  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private expiresAt = 0;

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
    // Native link activation is preserved, but must never place a laser point.
    for (const name of ['pointerdown', 'pointerup', 'pointermove', 'click', 'contextmenu']) {
      notice.addEventListener(name, event => event.stopPropagation());
    }
    this.element = notice;
    this.host = host;
    this.expiresAt = Date.now() + 3_000;
    notice.hidden = this.suspended;
    host.append(notice);
    const size = () => host.style.setProperty('--laser-reference-height', `${Math.ceil(notice.getBoundingClientRect().height)}px`);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(size);
      this.observer.observe(notice);
    }
    size();
    this.paintVisibility(!this.suspended);
    this.armTimer();
  }

  pause(): void {
    if (this.suspended || this.destroyed) return;
    this.stopTimer();
    this.suspended = true;
    this.paintVisibility(false);
  }

  resume(): void {
    if (!this.suspended || this.destroyed) return;
    this.suspended = false;
    if (!this.element || this.finished) return;
    if (Date.now() >= this.expiresAt) { this.finish(); return; }
    this.paintVisibility(true);
    this.armTimer();
  }

  destroy(): void {
    this.stopTimer();
    this.destroyed = true;
    this.paintVisibility(false);
    this.observer?.disconnect();
    this.element?.remove();
    this.element = null;
    this.host?.style.removeProperty('--laser-reference-height');
    this.host = null;
  }

  private paintVisibility(visible: boolean): void {
    if (this.element) this.element.hidden = !visible;
    if (this.host) this.host.dataset.laserReferenceNotice = visible ? 'visible' : 'hidden';
  }

  private finish(): void {
    this.finished = true;
    // Expiry is fixed, including while the link is hovered or focused. Avoid
    // leaving keyboard focus inside hidden content, without stealing a modal's.
    if (this.element?.contains(document.activeElement) && !this.host?.querySelector('dialog[open]')) {
      this.host?.focus({ preventScroll: true });
    }
    this.paintVisibility(false);
    this.observer?.disconnect();
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private armTimer(): void {
    if (!this.element || this.timer !== null || this.destroyed || this.finished
      || this.suspended) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.finish();
    }, Math.max(0, this.expiresAt - Date.now()));
  }
}
