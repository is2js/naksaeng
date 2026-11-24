import {
  ACESFilmicToneMapping, Box3, DirectionalLight, HemisphereLight, LoadingManager, Material,
  Mesh, MOUSE, Object3D, OrthographicCamera, Raycaster,
  Scene, Spherical, Texture, TOUCH, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import dracoWasm from 'three/addons/libs/draco/gltf/draco_decoder.wasm?url';
import dracoWasmWrapper from 'three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url';
import modelUrl from './assets/bunfirvil-site-v9.glb?url';
import { createBuildingOutline } from './building-outline';
import { createGroundFacilities } from './facility-ground';
import { SITE_FACILITIES } from './facility-markers';
import { createFacilityOverlay } from './facility-overlay';
import { refineFacilityExteriors } from './facility-exteriors';
import type { FacilityDetailId } from './facility-detail-data';

const decoderUrls: Record<string, string> = {
  'draco_decoder.wasm': dracoWasm,
  'draco_wasm_wrapper.js': dracoWasmWrapper,
};

export interface SiteViewer {
  select(id: string | null, animate?: boolean, focus?: boolean): void;
  reset(): void;
  zoom(by: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

interface Options {
  viewport: HTMLElement;
  compass: HTMLElement;
  markerLayer: HTMLElement;
  markers: ReadonlyMap<string, HTMLButtonElement>;
  buildingIds: ReadonlySet<string>;
  selectionOverlay: HTMLElement;
  signal: AbortSignal;
  onSelect(id: string): void;
  onLost(): void;
  onViewChange?(canReset: boolean): void;
  onFacilityMode?(active: boolean): void;
}

type CameraPhase = 'overview' | 'building' | 'manual' | 'facility';
interface CameraPose { target: Vector3; orbit: Spherical; zoom: number; }
interface FacilityVisit {
  id: FacilityDetailId;
  trigger: HTMLButtonElement;
  before: CameraPose;
  previousPhase: Exclude<CameraPhase, 'facility'>;
  mount?: typeof import('./facility-detail').mountFacilityDetail;
  detail?: { dispose(): void };
  returning: boolean;
  failed?: boolean;
}
interface CameraMove {
  startedAt: number;
  duration: number;
  from: CameraPose;
  to: CameraPose;
  phase: CameraPhase;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const NORTH = new Vector3(0, 0, -1);
const PRESS_SLOP = 7;
const INITIAL_PITCH = Math.PI * 58 / 180;
const FOCUS_TURN = Math.PI * 14 / 180;

function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function releaseModel(model: Object3D): void {
  const geometries = new Set<Mesh['geometry']>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

export async function mountSiteViewer(options: Options): Promise<SiteViewer> {
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('이 환경에서 단지 모형을 디코딩할 수 없습니다.');
  }
  const response = await fetch(modelUrl, { signal: options.signal });
  if (!response.ok) throw new Error(`단지 모형: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  options.signal.throwIfAborted();
  // Serve only the WASM decoder from this static site. Unsupported clients
  // keep using the same wizard with legacy cards.
  const draco = new DRACOLoader(new LoadingManager().setURLModifier((url) => decoderUrls[url] ?? url));
  draco.setDecoderConfig({ type: 'wasm' });
  draco.setWorkerLimit(2);
  const { scene: model } = await new GLTFLoader().setDRACOLoader(draco).parseAsync(bytes, '').finally(() => draco.dispose());
  const events = new AbortController();
  const signal = events.signal;
  let renderer: WebGLRenderer | undefined;
  let destroyFacilities: (() => void) | undefined;
  try {
    options.signal.throwIfAborted();
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
    const gpu = renderer;
    const canvas = gpu.domElement;
    const world = new Scene();
    world.add(model);
    world.updateMatrixWorld(true);
    refineFacilityExteriors(model);
    world.updateMatrixWorld(true);

    const groups = new Map<string, Object3D>();
    const pickables: Mesh[] = [];
    const owners = new Map<Mesh, string>();
    model.traverseVisible((node) => {
      if (node instanceof Mesh) pickables.push(node);
      const { buildingId } = node.userData;
      if (typeof buildingId !== 'string' || !options.buildingIds.has(buildingId)) return;
      if (groups.has(buildingId)) throw new Error(`중복 동 ID: ${buildingId}`);
      groups.set(buildingId, node);
      node.traverse((child) => { if (child instanceof Mesh) owners.set(child, buildingId); });
    });
    if (groups.size !== options.buildingIds.size) throw new Error('단지 모형의 동 목록이 일치하지 않습니다.');

    const groupBounds = new Map<string, Box3>();
    const anchors = new Map<string, Vector3>();
    const bounds = new Box3();
    for (const [id, node] of groups) {
      const box = new Box3().setFromObject(node);
      if (box.isEmpty()) throw new Error(`동의 형상이 없음: ${id}`);
      groupBounds.set(id, box);
      bounds.union(box);
      const marker = box.getCenter(new Vector3());
      marker.y = box.max.y + 6;
      anchors.set(id, marker);
    }

    const center = bounds.getCenter(new Vector3());
    center.y *= .64;
    const size = bounds.getSize(new Vector3());
    const distance = Math.max(size.length() * 1.7, 100);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 1, distance * 5);
    camera.position.set(center.x, center.y + Math.sin(INITIAL_PITCH) * distance, center.z + Math.cos(INITIAL_PITCH) * distance);
    camera.lookAt(center);
    camera.updateMatrixWorld();

    gpu.setPixelRatio(Math.min(window.devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
    gpu.setClearColor(0x30483a, 0);
    gpu.toneMapping = ACESFilmicToneMapping;
    gpu.toneMappingExposure = 1.12;
    canvas.dataset.siteCanvas = '';
    canvas.setAttribute('aria-label', '3D 단지 모형. 동이나 색칠된 시설을 눌러 선택할 수 있습니다. 키보드로는 동 번호와 시설 이름 버튼을 사용하세요.');
    canvas.className = 'preview-canvas';

    const ambient = new HemisphereLight(0xf4faff, 0x687c58, 1.75);
    const sun = new DirectionalLight(0xfff0ce, 2.3);
    sun.position.copy(center).add(new Vector3(-260, 470, -210));
    sun.target.position.copy(center);
    sun.castShadow = true;
    const shadeSpan = Math.max(size.x, size.z) * .67;
    sun.shadow.camera.left = -shadeSpan;
    sun.shadow.camera.right = shadeSpan;
    sun.shadow.camera.top = shadeSpan;
    sun.shadow.camera.bottom = -shadeSpan;
    sun.shadow.camera.near = 15;
    sun.shadow.camera.far = distance * 2.1;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.normalBias = .25;
    sun.shadow.bias = -.00015;
    sun.shadow.intensity = .52;
    gpu.shadowMap.enabled = true;
    gpu.shadowMap.autoUpdate = false;
    for (const mesh of pickables) {
      mesh.castShadow = owners.has(mesh) || mesh.userData.castsSiteShadow === true || mesh.parent?.userData.castsSiteShadow === true;
      mesh.receiveShadow = true;
    }
    world.add(ambient, sun, sun.target);

    const controls = new OrbitControls(camera, options.viewport);
    controls.target.copy(center);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.rotateSpeed = .55;
    controls.zoomSpeed = .9;
    controls.minPolarAngle = .10;
    controls.maxPolarAngle = Math.PI * .43;
    controls.minZoom = .58;
    controls.maxZoom = 5.0;
    controls.maxTargetRadius = Math.max(size.x, size.z) * .78;
    controls.cursor.copy(center);
    controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    controls.update();
    const initialPose: CameraPose = {
      target: center.clone(),
      orbit: new Spherical(distance, Math.PI / 2 - INITIAL_PITCH, 0),
      zoom: 1,
    };
    const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)');

    const leaderLayer = document.createElementNS(SVG_NS, 'svg');
    leaderLayer.setAttribute('class', 'preview-leader-layer');
    leaderLayer.setAttribute('aria-hidden', 'true');
    const leaders = new Map<string, SVGLineElement>();
    for (const id of groups.keys()) {
      const line = document.createElementNS(SVG_NS, 'line');
      leaders.set(id, line);
      leaderLayer.append(line);
    }
    options.markerLayer.prepend(leaderLayer);

    let disposed = false;
    let paused = false;
    let pausedAt = 0;
    let renderFrame = 0;
    let cameraPhase: CameraPhase = 'overview';
    let cameraMove: CameraMove | null = null;
    let selectedId: string | null = null;
    let facilityVisit: FacilityVisit | null = null;
    let w = 1;
    let h = 1;
    let outline: ReturnType<typeof createBuildingOutline> | null = null;
    const vector = new Vector3();
    const ray = new Raycaster();
    const pointer = new Vector2();
    const motionOffset = new Vector3();
    const motionTarget = new Vector3();
    const motionOrbit = new Spherical();
    const groundFacilities = createGroundFacilities(model, owners);
    destroyFacilities = () => groundFacilities.dispose();
    const facilityStatus = document.createElement('p');
    facilityStatus.className = 'site-facility-loading';
    facilityStatus.setAttribute('role', 'status');
    facilityStatus.hidden = true;
    options.viewport.append(facilityStatus);
    const facilityOverlay = createFacilityOverlay(options.viewport, SITE_FACILITIES, {
      onVisibilityChange: queueRender,
      onOpenDetail: enterFacility,
    });
    const fadedBuilding = '104';
    const fadedParts: { mesh: Mesh; original: Mesh['material']; castShadow: boolean }[] = [];
    const fadeMaterials = new Map<Material, Material>();
    function setDaycareReveal(show: boolean): void {
      if (show === Boolean(fadedParts.length)) return;
      if (show) {
        const translucent = (original: Material): Material => {
          const cached = fadeMaterials.get(original);
          if (cached) return cached;
          const material = original.clone();
          material.transparent = true;
          material.opacity *= .19;
          material.depthWrite = false;
          material.forceSinglePass = true;
          fadeMaterials.set(original, material);
          return material;
        };
        for (const [mesh, id] of owners) {
          if (id !== fadedBuilding) continue;
          fadedParts.push({ mesh, original: mesh.material, castShadow: mesh.castShadow });
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(translucent) : translucent(mesh.material);
          mesh.castShadow = false;
        }
        if (!fadedParts.length) return;
        canvas.dataset.fadedBuilding = fadedBuilding;
      } else {
        for (const { mesh, original, castShadow } of fadedParts.splice(0)) {
          mesh.material = original;
          mesh.castShadow = castShadow;
        }
        delete canvas.dataset.fadedBuilding;
      }
      gpu.shadowMap.needsUpdate = true;
    }
    destroyFacilities = () => {
      facilityVisit?.detail?.dispose();
      if (facilityVisit) setFacilityMode(null);
      facilityVisit = null;
      setDaycareReveal(false);
      fadeMaterials.forEach((material) => material.dispose());
      fadeMaterials.clear();
      facilityStatus.remove();
      facilityOverlay.dispose();
      groundFacilities.dispose();
    };

    function queueRender(): void {
      if (!disposed && !paused && !document.hidden && !renderFrame) renderFrame = requestAnimationFrame(render);
    }

    function capturePose(): CameraPose {
      return {
        target: controls.target.clone(),
        orbit: new Spherical().setFromVector3(camera.position.clone().sub(controls.target)),
        zoom: camera.zoom,
      };
    }

    function setFacilityMode(mode: 'entering' | 'open' | 'returning' | null): void {
      if (mode) options.viewport.dataset.siteFacilityView = mode;
      else delete options.viewport.dataset.siteFacilityView;
      controls.enabled = !mode;
      options.markerLayer.inert = Boolean(mode);
      facilityOverlay.setInteractive(!mode);
      options.onFacilityMode?.(Boolean(mode));
    }

    function enterFacility(id: FacilityDetailId, trigger: HTMLButtonElement): void {
      if (facilityVisit || disposed) return;
      const target = groundFacilities.anchorFor(id);
      if (!target) return;
      const before = capturePose();
      const previous = cameraMove ? 'manual' : cameraPhase;
      const visit: FacilityVisit = {
        id, trigger, before, previousPhase: previous === 'facility' ? 'manual' : previous, returning: false,
      };
      facilityVisit = visit;
      delete canvas.dataset.hoverFacility;
      if (id === 'daycare-104') setDaycareReveal(true);
      trigger.setAttribute('aria-busy', 'true');
      facilityStatus.hidden = true;
      facilityStatus.textContent = '시설 공간을 불러오는 중입니다.';
      setFacilityMode('entering');
      const orbit = before.orbit.clone();
      // Transition towards the real facility in the district's coordinates,
      // then reveal its matching north-oriented cutaway in the same viewport.
      orbit.theta = 0;
      orbit.phi = .59;
      const zoom = Math.min(controls.maxZoom, Math.max(initialPose.zoom * 3.65, before.zoom * 1.25));
      tweenTo({ target, orbit, zoom }, 'facility');
      void import('./facility-detail').then(({ mountFacilityDetail }) => {
        if (signal.aborted || facilityVisit !== visit || visit.returning) return;
        visit.mount = mountFacilityDetail;
        queueRender();
      }).catch(() => returnFromFacility(visit, true));
    }

    function returnFromFacility(visit: FacilityVisit, failed = false): void {
      if (disposed || facilityVisit !== visit || visit.returning) return;
      const explored = Boolean(visit.detail) && !failed;
      visit.returning = true;
      visit.failed = failed;
      visit.trigger.removeAttribute('aria-busy');
      visit.detail?.dispose();
      visit.detail = undefined;
      setDaycareReveal(false);
      facilityStatus.hidden = true;
      setFacilityMode('returning');
      if (explored) {
        // Keep the district camera at the zoomed facility approach. The
        // cutaway has its own camera; orbit/dolly inside shouldn't move the map.
        stopCameraMove();
      } else {
        tweenTo(visit.before, visit.previousPhase);
      }
    }

    function finishFacilityMove(): void {
      const visit = facilityVisit;
      if (!visit || cameraMove) return;
      if (visit.returning) {
        facilityVisit = null;
        setFacilityMode(null);
        const restore = !visit.trigger.hidden ? visit.trigger : options.viewport.closest('.building-map')?.querySelector<HTMLButtonElement>('[data-site-zoom="in"]');
        restore?.focus({ preventScroll: true });
        if (visit.failed) {
          facilityStatus.textContent = '시설 공간을 불러오지 못했습니다. 다시 선택해 주세요.';
          facilityStatus.hidden = false;
        }
      } else if (visit.mount) {
        facilityStatus.hidden = true;
        visit.trigger.removeAttribute('aria-busy');
        setFacilityMode('open');
        try {
          visit.detail = visit.mount(options.viewport, visit.id, () => returnFromFacility(visit));
        } catch {
          returnFromFacility(visit, true);
        }
      } else facilityStatus.hidden = false;
    }

    function applyPose(target: Vector3, orbit: Spherical, zoom: number): void {
      controls.target.copy(target);
      camera.position.copy(target).add(motionOffset.setFromSpherical(orbit));
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      controls.update();
      camera.updateMatrixWorld();
    }

    function tweenTo(to: CameraPose, phase: CameraPhase, animate = true): void {
      if (!animate || prefersReduced.matches || document.hidden) {
        cameraMove = null;
        cameraPhase = phase;
        applyPose(to.target, to.orbit, to.zoom);
      } else {
        const from = capturePose();
        const isAtDestination = from.target.distanceToSquared(to.target) < .001
          && Math.abs(shortestAngle(from.orbit.theta, to.orbit.theta)) < .001
          && Math.abs(from.orbit.phi - to.orbit.phi) < .001
          && Math.abs(from.zoom - to.zoom) < .001;
        const duration = phase === 'facility' ? 510 : facilityVisit?.returning || phase === 'overview' ? 480 : 720;
        cameraMove = isAtDestination ? null : { startedAt: performance.now(), duration, from, to, phase };
        if (!cameraMove) cameraPhase = phase;
      }
      queueRender();
    }

    function stopCameraMove(): void {
      cameraMove = null;
      cameraPhase = 'manual';
      queueRender();
    }

    function focusBuilding(id: string, animate: boolean, turn = true): void {
      const box = groupBounds.get(id);
      if (!box) return;
      const { orbit } = capturePose();
      const target = box.getCenter(new Vector3());
      if (turn) {
        const preferredSide = target.x < center.x ? -1 : 1;
        orbit.theta += Math.max(-FOCUS_TURN, Math.min(FOCUS_TURN, shortestAngle(orbit.theta, preferredSide * FOCUS_TURN)));
        orbit.phi += Math.max(-.13, Math.min(.13, Math.PI / 2 - INITIAL_PITCH + .14 - orbit.phi));
      }
      const c = Math.cos(orbit.theta), s = Math.sin(orbit.theta);
      const right = new Vector3(c, 0, -s);
      const up = new Vector3(-s * Math.cos(orbit.phi), Math.sin(orbit.phi), -c * Math.cos(orbit.phi));
      let halfWidth = 1;
      let halfHeight = 1;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            vector.set(x, y, z).sub(target);
            halfWidth = Math.max(halfWidth, Math.abs(vector.dot(right)));
            halfHeight = Math.max(halfHeight, Math.abs(vector.dot(up)));
          }
        }
      }
      const zoom = Math.min(controls.maxZoom * .86, camera.right * .72 / halfWidth, camera.top * .65 / halfHeight);
      tweenTo({ target, orbit, zoom: Math.max(controls.minZoom, zoom) }, 'building', animate);
    }

    function render(now: number): void {
      renderFrame = 0;
      if (disposed || paused || document.hidden || facilityVisit?.detail) return;
      if (cameraMove) {
        const move = cameraMove;
        const progress = Math.max(0, Math.min(1, (now - move.startedAt) / move.duration));
        const t = progress * progress * (3 - 2 * progress);
        if (progress === 1) {
          cameraMove = null;
          cameraPhase = move.phase;
        }
        motionTarget.lerpVectors(move.from.target, move.to.target, t);
        motionOrbit.set(
          move.from.orbit.radius + (move.to.orbit.radius - move.from.orbit.radius) * t,
          move.from.orbit.phi + (move.to.orbit.phi - move.from.orbit.phi) * t,
          move.from.orbit.theta + shortestAngle(move.from.orbit.theta, move.to.orbit.theta) * t,
        );
        applyPose(motionTarget, motionOrbit, move.from.zoom * (move.to.zoom / move.from.zoom) ** t);
      }
      gpu.render(world, camera);
      if (selectedId && !(fadedParts.length && selectedId === fadedBuilding)) {
        outline ??= createBuildingOutline(gpu, owners);
        outline.resize(w, h);
        outline.render(world, camera, selectedId);
        canvas.dataset.outlineBuilding = selectedId;
      } else {
        delete canvas.dataset.outlineBuilding;
      }
      const { points: facilityPoints, areaIds } = groundFacilities.draw(gpu, camera, w, h, camera.zoom >= initialPose.zoom * 1.45,
        facilityOverlay.isKindVisible);
      canvas.dataset.facilityAreas = areaIds.join(' ');
      canvas.dataset.cameraPhase = cameraMove ? 'transition' : cameraPhase;
      canvas.dataset.cameraTarget = `${controls.target.x.toFixed(2)},${controls.target.z.toFixed(2)}`;
      canvas.dataset.zoom = camera.zoom.toFixed(3);
      const azimuthChanged = Math.abs(shortestAngle(controls.getAzimuthalAngle(), initialPose.orbit.theta)) > .008;
      const pitchChanged = Math.abs(controls.getPolarAngle() - initialPose.orbit.phi) > .008;
      options.onViewChange?.(Math.abs(camera.zoom - initialPose.zoom) > .001 || azimuthChanged || pitchChanged
        || controls.target.distanceToSquared(initialPose.target) > .05);
      const projectedNorth = vector.copy(NORTH).transformDirection(camera.matrixWorldInverse);
      const angle = Math.atan2(projectedNorth.x, projectedNorth.y) * 180 / Math.PI;
      const bearing = (Math.round(angle) + 360) % 360;
      options.compass.style.setProperty('--north-angle', `${angle}deg`);
      options.compass.dataset.bearing = String(bearing);
      options.compass.setAttribute('aria-label', bearing ? `나침반: 북쪽 방향 ${bearing}도` : '나침반: 북쪽 위');
      placeMarkers();
      facilityOverlay.update(facilityPoints, w, h, selectedId !== null);
      finishFacilityMove();
      if (cameraMove) queueRender();
    }

    function placeMarkers(): void {
      const placed: { x: number; y: number }[] = [];
      const offsets = [[0, 0], [0, -36], [-40, -22], [40, -22], [-48, 8], [48, 8], [0, 35], [-43, -53], [43, -53]];
      const overlayWidth = options.selectionOverlay.hidden ? 0 : options.selectionOverlay.offsetWidth;
      const overlayHeight = overlayWidth ? options.selectionOverlay.offsetHeight : 0;
      const ordered = [...anchors];
      if (selectedId) ordered.sort(([idA], [idB]) => Number(idB === selectedId) - Number(idA === selectedId));
      for (const [id, anchor] of ordered) {
        const marker = options.markers.get(id)!;
        const line = leaders.get(id)!;
        const projected = vector.copy(anchor).project(camera);
        const x = (projected.x * .5 + .5) * w;
        const y = (.5 - projected.y * .5) * h;
        const position = x < 8 || x > w - 8 || y < 5 || y > h - 5 || Math.abs(projected.z) > 1
          ? undefined
          : offsets.map(([dx, dy]) => ({ x: x + dx, y: y - 12 + dy })).find((point) => (
              point.x >= 30 && point.x <= w - 30 && point.y >= 23 && point.y <= h - 25
              && !(point.y < 83 && (point.x < 80 || point.x > w - 166))
              && !(point.x > w - 78 && point.y > h - 120)
              && !(overlayWidth && point.x < overlayWidth + 42 && point.y > h - overlayHeight - 38)
              && placed.every((p) => Math.abs(point.x - p.x) >= 58 || Math.abs(point.y - p.y) >= 39)
            ));
        line.style.display = position ? '' : 'none';
        if (!position) {
          marker.hidden = true;
          continue;
        }
        placed.push(position);
        marker.hidden = false;
        marker.style.left = `${position.x}px`;
        marker.style.top = `${position.y}px`;
        line.setAttribute('x1', String(x));
        line.setAttribute('y1', String(y + 3));
        line.setAttribute('x2', String(position.x));
        line.setAttribute('y2', String(position.y));
        line.classList.toggle('is-selected', id === selectedId);
      }
    }

    function resize(): void {
      w = Math.max(1, options.viewport.clientWidth);
      h = Math.max(1, options.viewport.clientHeight);
      // Fit in north-up view even when the user resizes the frame while orbiting.
      const normal = new Vector3(0, Math.cos(INITIAL_PITCH), -Math.sin(INITIAL_PITCH));
      let projectedX = 1;
      let projectedY = 1;
      for (const box of groupBounds.values()) {
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [0, box.max.y + 10]) {
            for (const z of [box.min.z, box.max.z]) {
              vector.set(x, y, z).sub(center);
              projectedX = Math.max(projectedX, Math.abs(vector.x));
              projectedY = Math.max(projectedY, Math.abs(vector.dot(normal)));
            }
          }
        }
      }
      const aspect = w / h;
      const halfHeight = Math.max(projectedY * 1.18, projectedX * 1.16 / aspect);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      gpu.setSize(w, h, false);
      leaderLayer.setAttribute('viewBox', `0 0 ${w} ${h}`);
      if (!facilityVisit && selectedId && (cameraMove?.phase ?? cameraPhase) === 'building') focusBuilding(selectedId, Boolean(cameraMove), false);
      queueRender();
    }

    function aimAt(clientX: number, clientY: number): boolean {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      return true;
    }

    function facilityAtPointer() {
      const area = groundFacilities.hitDetail(ray);
      if (!area) return;
      // Colour is projected onto the real roof/terrain. Ignore its own
      // coplanar surface, while keeping real foreground towers in front.
      ray.far = area.distance - .04;
      try {
        if (!ray.intersectObjects(pickables, false).some(({ object }) => object.visible)) return area.id;
      } finally { ray.far = Infinity; }
    }

    function pick(clientX: number, clientY: number): void {
      if (!aimAt(clientX, clientY)) return;
      const facility = facilityAtPointer();
      const trigger = facility && facilityOverlay.detailButton(facility);
      if (facility && trigger) { enterFacility(facility, trigger); return; }
      const hit = ray.intersectObjects(pickables, false).find(({ object }) => object.visible);
      const id = hit && owners.get(hit.object as Mesh);
      if (id) options.onSelect(id);
    }

    const activePointers = new Set<number>();
    let press: { id: number; x: number; y: number; marker: HTMLButtonElement | null; surface: boolean } | null = null;
    let suppressClick = false;
    const capture = { capture: true, signal };
    window.addEventListener('keydown', (event) => {
      const visit = facilityVisit;
      if (event.key !== 'Escape' || !visit || visit.detail || visit.returning) return;
      event.preventDefault();
      returnFromFacility(visit);
    }, { signal });
    options.viewport.addEventListener('pointerdown', (event) => {
      if (facilityVisit || (event.target instanceof Element && event.target.closest('[data-site-facility-controls],[data-site-facility-detail]'))) return;
      delete canvas.dataset.hoverFacility;
      if (!activePointers.size) {
        suppressClick = false;
        const marker = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-building-marker]') : null;
        press = event.button === 0
          ? { id: event.pointerId, x: event.clientX, y: event.clientY, marker, surface: event.target === canvas }
          : null;
      } else suppressClick = true;
      activePointers.add(event.pointerId);
    }, capture);
    options.viewport.addEventListener('pointermove', (event) => {
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_SLOP) suppressClick = true;
      if (event.pointerType !== 'mouse' || event.buttons || facilityVisit) return;
      const id = event.target === canvas && aimAt(event.clientX, event.clientY) ? facilityAtPointer() : undefined;
      if (id) canvas.dataset.hoverFacility = id;
      else delete canvas.dataset.hoverFacility;
    }, capture);
    options.viewport.addEventListener('pointerleave', () => { delete canvas.dataset.hoverFacility; }, { signal });
    window.addEventListener('pointerup', (event) => {
      if (!activePointers.delete(event.pointerId)) return;
      if (press?.id === event.pointerId) {
        const origin = press;
        press = null;
        if (!suppressClick && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= PRESS_SLOP) {
          if (origin.marker && !origin.marker.hidden) {
            const { left, right, top, bottom } = origin.marker.getBoundingClientRect();
            const id = origin.marker.dataset.buildingMarker;
            if (id && event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom) {
              // OrbitControls captures to the common viewport so a second
              // finger on a marker can still zoom/pan. Resolve a true tap here.
              suppressClick = true;
              options.onSelect(id);
            }
          } else if (origin.surface) pick(event.clientX, event.clientY);
        }
      }
    }, capture);
    window.addEventListener('pointercancel', (event) => {
      if (activePointers.delete(event.pointerId)) suppressClick = true;
      if (press?.id === event.pointerId) press = null;
    }, capture);
    window.addEventListener('blur', () => {
      press = null;
      activePointers.clear();
    }, { signal });
    options.viewport.addEventListener('click', (event) => {
      if (suppressClick && event.detail && event.target instanceof Element && event.target.closest('[data-building-marker]')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, capture);
    function select(id: string | null, animate = true, focus = true): void {
      if (facilityVisit) return;
      const changed = id !== selectedId;
      selectedId = id;
      if (focus && id && (changed || animate)) focusBuilding(id, animate);
      queueRender();
    }

    function pause(): void {
      if (paused) return;
      paused = true;
      pausedAt = performance.now();
      if (renderFrame) cancelAnimationFrame(renderFrame);
      renderFrame = 0;
    }

    function resume(): void {
      if (paused && cameraMove) cameraMove.startedAt += performance.now() - pausedAt;
      paused = false;
      queueRender();
    }

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      pause();
      options.onLost();
    }, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); }, { signal });
    prefersReduced.addEventListener('change', () => {
      const move = cameraMove;
      if (prefersReduced.matches && move) tweenTo(move.to, move.phase, false);
    }, { signal });
    const observer = new ResizeObserver(resize);
    observer.observe(options.viewport);
    controls.addEventListener('start', stopCameraMove);
    controls.addEventListener('change', queueRender);
    options.viewport.prepend(canvas);
    gpu.shadowMap.needsUpdate = true;
    resize();

    return {
      select,
      reset() {
        if (!facilityVisit) tweenTo(initialPose, 'overview');
      },
      zoom(by) {
        if (facilityVisit) return;
        stopCameraMove();
        camera.zoom = Math.min(controls.maxZoom, Math.max(controls.minZoom, camera.zoom * by));
        camera.updateProjectionMatrix();
        queueRender();
      },
      pause,
      resume,
      dispose() {
        if (disposed) return;
        disposed = true;
        pause();
        events.abort();
        observer.disconnect();
        controls.removeEventListener('start', stopCameraMove);
        controls.removeEventListener('change', queueRender);
        controls.dispose();
        destroyFacilities?.();
        outline?.dispose();
        releaseModel(model);
        sun.shadow.dispose();
        gpu.dispose();
        canvas.remove();
        leaderLayer.remove();
      },
    };
  } catch (error) {
    events.abort();
    destroyFacilities?.();
    renderer?.dispose();
    releaseModel(model);
    throw error;
  }
}
