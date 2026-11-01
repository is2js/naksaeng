import { fetchJson, resolveProjectUrl, resolveReferencedUrl } from './base';
import { travelLockedDirection } from './grid';
import type {
  ActorState,
  CharacterManifest,
  ProjectedPoint,
  StaticCharacterEntry,
} from './types';

// The two selectable player actors share the same transformation atlases.
// Reuse the in-flight browser decode so mobile startup does not fetch/decode
// each sheet twice. A failure is removed so a later load can retry.
const transformationWalkSheetLoads = new Map<string, Promise<void>>();
function preloadTransformationWalkSheet(url: string): Promise<void> {
  const existing = transformationWalkSheetLoads.get(url);
  if (existing) return existing;
  const pending = new Promise<void>((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error('transformation sheet timed out'));
    }, 8_000);
    image.onload = () => { window.clearTimeout(timeout); resolve(); };
    image.onerror = () => { window.clearTimeout(timeout); reject(new Error('transformation sheet unavailable')); };
    image.src = url;
  });
  transformationWalkSheetLoads.set(url, pending);
  void pending.catch(() => {
    if (transformationWalkSheetLoads.get(url) === pending) transformationWalkSheetLoads.delete(url);
  });
  return pending;
}

export class ActorView {
  readonly element: HTMLButtonElement;
  private readonly sprite: HTMLSpanElement;
  private readonly transformationEffect: HTMLSpanElement;
  private manifest: CharacterManifest | null = null;
  private manifestUrl = '';
  private readonly transformations = new Map<string, { manifest: CharacterManifest; url: string }>();
  private transformed: string | null = null;
  // undefined means no pending switch; null is an intentional return to the human sprite.
  private pendingTransformation: string | null | undefined;
  private transformationStartedAt = 0;
  private transformationEffectReady = false;
  private transformationEffectRequested = false;
  private lastSheet = '';

  constructor(
    readonly entry: StaticCharacterEntry,
    private readonly onSelect: (key: '100' | '200') => void,
  ) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `rpg-actor rpg-actor--${entry.key}`;
    element.dataset.actor = entry.key;
    element.tabIndex = -1;
    element.setAttribute('aria-label', `${entry.label} 조작`);
    element.innerHTML = `
      <span class="actor-shadow" aria-hidden="true"></span>
      <span class="actor-sprite" aria-hidden="true"><span class="actor-fallback">${entry.key}</span></span>
      <span class="actor-transformation-effect" aria-hidden="true"></span>
      <span class="actor-name"></span>
    `;
    (element.querySelector('.actor-name') as HTMLElement).textContent = entry.label;
    this.element = element;
    this.sprite = element.querySelector<HTMLElement>('.actor-sprite') as HTMLSpanElement;
    this.transformationEffect = element.querySelector<HTMLElement>('.actor-transformation-effect') as HTMLSpanElement;
    element.addEventListener('click', () => this.onSelect(entry.key));
  }

  async load(onAssetLoaded: () => void): Promise<void> {
    this.manifestUrl = resolveProjectUrl(this.entry.manifestUrl);
    try {
      this.manifest = await fetchJson<CharacterManifest>(this.manifestUrl);
      onAssetLoaded();
      this.element.classList.add('has-sprite');
    } catch (error) {
      console.warn(`[bunfirvil] Character ${this.entry.key} uses CSS fallback.`, error);
    }
  }

  async loadTransformation(id: string, manifestUrl: string, onAssetLoaded: () => void): Promise<boolean> {
    const url = resolveProjectUrl(manifestUrl);
    try {
      const manifest = await fetchJson<CharacterManifest>(url);
      const walk = manifest.motions?.walk;
      const walkAction = (walk && manifest.defaultActions?.walk && walk.actions?.[manifest.defaultActions.walk])
        || Object.values(walk?.actions ?? {})[0];
      if (!walkAction?.sheet) throw new Error('missing transformation walk sheet');
      // A manifest alone is not enough: a broken sheet would leave an invisible
      // actor. Only advertise the candidate after the browser loads its walk sheet.
      await preloadTransformationWalkSheet(resolveReferencedUrl(walkAction.sheet, url));
      this.transformations.set(id, { manifest, url });
      this.element.dataset.transformationCandidates = this.availableTransformations().join(',');
      onAssetLoaded();
      // Prepare in the background: a failed or not-yet-loaded visual must
      // never prevent the actual playground transformation.
      if (!this.transformationEffectRequested) {
        this.transformationEffectRequested = true;
        const effectUrl = resolveProjectUrl('assets/effects/transformation/transform-violet-r1.png');
        const image = new Image();
        image.onload = () => {
          this.transformationEffectReady = true;
          this.transformationEffect.style.backgroundImage = `url("${effectUrl}")`;
        };
        image.src = effectUrl;
      }
      return true;
    } catch (error) {
      this.transformations.delete(id);
      this.element.dataset.transformationCandidates = this.availableTransformations().join(',');
      console.warn(`[bunfirvil] Transformation ${id} is unavailable.`, error);
      return false;
    }
  }

  availableTransformations(): string[] {
    return [...this.transformations.keys()];
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  setTransformed(transformed: string | null): void {
    this.pendingTransformation = undefined;
    this.transformationStartedAt = 0;
    this.element.classList.remove('is-transforming');
    this.applyTransformed(transformed);
  }

  /** The state changes immediately; only the visible sprite waits for smoke. */
  playTransformation(transformed: string | null): void {
    const next = transformed && this.transformations.has(transformed) ? transformed : null;
    if (!this.transformationEffectReady || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.setTransformed(next);
      return;
    }
    this.pendingTransformation = next;
    this.transformationStartedAt = performance.now();
    this.element.classList.remove('is-transforming');
    // A deliberate click can restart the CSS sequence, including rapid toggles.
    void this.transformationEffect.offsetWidth;
    this.element.classList.add('is-transforming');
  }

  private applyTransformed(transformed: string | null): void {
    const next = transformed && this.transformations.has(transformed) ? transformed : null;
    if (next === this.transformed) return;
    this.transformed = next;
    this.lastSheet = '';
    this.element.classList.toggle('is-transformed', Boolean(next));
    this.element.dataset.transformation = next ?? '';
    if (next) {
      // Sheets have different baked ground rows. Keep each species' actual
      // foot on the existing pigmy's ground anchor rather than shifting the
      // actor or altering its world position.
      const manifest = this.transformations.get(next)!.manifest;
      const size = Number(manifest.cellSize);
      const foot = Number(manifest.footY);
      const footRatio = Number.isFinite(size) && size > 0 && Number.isFinite(foot) && foot >= 0 && foot <= size
        ? foot / size : 122 / 128;
      this.sprite.style.top = `${-25 + (122 / 128 - footRatio) * 102}px`;
    } else {
      this.sprite.style.removeProperty('top');
    }
  }

  setSelected(selected: boolean): void {
    this.element.classList.toggle('is-selected', selected);
    this.element.setAttribute('aria-pressed', String(selected));
  }

  update(actor: ActorState, point: ProjectedPoint, time: number, worldScale = 1): void {
    if (this.transformationStartedAt) {
      const elapsed = Math.max(0, time - this.transformationStartedAt);
      if (this.pendingTransformation !== undefined && elapsed >= 600) {
        this.applyTransformed(this.pendingTransformation);
        this.pendingTransformation = undefined;
      }
      if (elapsed >= 1920) {
        this.transformationStartedAt = 0;
        this.element.classList.remove('is-transforming');
      }
    }
    const scale = Math.max(.65, Math.min(2.8, Number.isFinite(worldScale) ? worldScale : 1));
    this.element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) scale(${scale})`;
    this.element.dataset.worldScale = scale.toFixed(3);
    this.element.style.zIndex = String(1_000 + Math.round(point.y));
    const renderDirection = travelLockedDirection(actor.direction, actor.travel);
    this.element.dataset.direction = renderDirection;
    this.element.dataset.queuedDirection = actor.queuedDirection || '';
    this.element.dataset.motion = actor.motion;
    this.element.dataset.worldX = actor.displayX.toFixed(4);
    this.element.dataset.worldY = actor.displayY.toFixed(4);
    this.element.dataset.cellX = String(actor.x);
    this.element.dataset.cellY = String(actor.y);
    this.element.dataset.travelState = actor.travel ? 'moving' : 'settled';
    this.element.dataset.travelProgress = actor.travel
      ? String(Math.max(0, Math.min(1, (time - actor.travel.startedAt) / Math.max(1, actor.travel.endsAt - actor.travel.startedAt))))
      : '1';
    const candidate = this.transformed ? this.transformations.get(this.transformed) : undefined;
    const manifest = candidate?.manifest ?? this.manifest;
    const manifestUrl = candidate?.url ?? this.manifestUrl;
    if (!manifest) return;
    const motion = manifest.motions?.[actor.motion] || manifest.motions?.idle || manifest.motions?.walk;
    if (!motion?.actions) return;
    const defaultAction = manifest.defaultActions?.[actor.motion];
    const action = (defaultAction && motion.actions[defaultAction]) || Object.values(motion.actions)[0];
    if (!action?.sheet) return;

    const columns = Math.max(1, action.sheetColumns || action.frameCount || 1);
    const rows = Math.max(1, action.sheetRows || manifest.directions?.length || 8);
    const duration = Math.max(120, motion.durationMs || (actor.motion === 'walk' ? 640 : 1_000));
    this.element.dataset.animationCycleMs = String(duration);
    const frameCount = Math.max(1, Math.min(columns, action.frameCount || columns));
    const elapsed = Math.max(0, time - actor.motionStartedAt);
    const animatedFrame = Math.floor((elapsed % duration) / duration * frameCount) % frameCount;
    const frame = this.transformed && actor.motion === 'idle' ? Math.min(1, frameCount - 1) : animatedFrame;
    this.element.dataset.animationCycleProgress = String((elapsed % duration) / duration);
    const directionOrder = manifest.directions || ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    const row = Math.max(0, directionOrder.indexOf(renderDirection));
    const sheetUrl = resolveReferencedUrl(action.sheet, manifestUrl);

    if (sheetUrl !== this.lastSheet) {
      this.lastSheet = sheetUrl;
      this.sprite.style.backgroundImage = `url("${sheetUrl}")`;
    }
    this.sprite.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
    this.sprite.style.backgroundPosition = `${columns === 1 ? 0 : (frame / (columns - 1)) * 100}% ${rows === 1 ? 0 : (row / (rows - 1)) * 100}%`;
    this.element.dataset.spriteFrame = String(frame);
  }
}
