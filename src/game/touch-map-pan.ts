/** Preserve native one-finger scrolling; only a two-finger map gesture is owned here. */
export class TouchMapPan {
  private previous: { x: number; y: number } | null = null;
  private consumed = false;

  constructor(
    private readonly stage: HTMLElement,
    enabled: () => boolean,
    start: () => void,
    move: (dx: number, dy: number) => void,
    signal: AbortSignal,
  ) {
    const allowed = (touch: Touch): boolean => touch.target instanceof Element
      && !touch.target.closest('.touch-controls,.touch-ghost-actions,.combat-dock,.map-identity,.floorplan-minimap,.stage-option-quote,.mobile-stage-options,.game-toast,.stage-zoom,.furniture-selection-toolbar,.istarpark-laser-toggle,.istarpark-laser-hud,.stage-tip');
    const center = (touches: TouchList): { x: number; y: number } | null => {
      if (touches.length !== 2 || ![...touches].every(allowed)) return null;
      return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
    };
    stage.addEventListener('touchstart', event => {
      if (!enabled()) return;
      const point = center(event.touches);
      if (!point) return;
      event.preventDefault();
      this.previous = point;
      this.consumed = true;
      start();
    }, { signal, passive: false });
    stage.addEventListener('touchmove', event => {
      if (!this.consumed) return;
      event.preventDefault();
      const point = enabled() ? center(event.touches) : null;
      if (point && this.previous) move(point.x - this.previous.x, point.y - this.previous.y);
      this.previous = point;
    }, { signal, passive: false });
    const end = (event: TouchEvent): void => {
      this.previous = null;
      if (event.touches.length < 2) stage.classList.remove('is-panning');
      if (!event.touches.length) this.reset();
    };
    stage.addEventListener('touchend', end, { signal });
    stage.addEventListener('touchcancel', end, { signal });
    window.addEventListener('blur', () => this.reset(), { signal });
  }

  get ownsGesture(): boolean { return this.consumed; }
  reset(): void {
    this.previous = null;
    this.consumed = false;
    this.stage.classList.remove('is-panning');
  }
}
