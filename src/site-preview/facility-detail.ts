import {
  ACESFilmicToneMapping, Box3, DirectionalLight, HemisphereLight, MOUSE, OrthographicCamera,
  PCFShadowMap, Raycaster, Scene, SRGBColorSpace, TOUCH, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FACILITY_DETAIL_PLANS, type FacilityDetailId, type FacilityFloor } from './facility-detail-data';
import { createFacilityFloorModel } from './facility-detail-model';
import './facility-detail.css';

const CARDINALS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]] as const;
const DIRECTIONS = ['위', '오른쪽 위', '오른쪽', '오른쪽 아래', '아래', '왼쪽 아래', '왼쪽', '왼쪽 위'];
let nextTitleId = 0;

export function mountFacilityDetail(host: HTMLElement, id: FacilityDetailId, onBack: () => void): { dispose(): void } {
  const plan = FACILITY_DETAIL_PLANS[id];
  const section = document.createElement('section');
  section.className = 'facility-detail-inline';
  section.dataset.facilityDetail = id;
  const hasFloors = plan.floors.length > 1;
  const titleId = `facility-inline-title-${++nextTitleId}`;
  section.setAttribute('aria-labelledby', titleId);
  section.innerHTML = `
    <div class="facility-detail-stage">
      <div class="facility-detail-model-layer">
        <canvas data-facility-detail-canvas tabindex="0" aria-label="시설 3D 단면 모형. 방 바닥이나 방 이름을 누르면 공간을 확인할 수 있습니다."></canvas>
        <div class="facility-detail-labels" role="group" aria-label="이 공간의 방"></div>
        <button type="button" class="facility-detail-stair" data-facility-stair hidden>
          <span aria-hidden="true" class="facility-detail-stair-icon"></span><span></span>
        </button>
      </div>
      <div class="facility-detail-compass" role="img" aria-label="방위: 화면 위가 북쪽"><i>북</i><i>동</i><i>남</i><i>서</i></div>
      <p class="facility-detail-stage-message" role="status" hidden>3D 모형을 표시할 수 없습니다. 공간 이름을 눌러 설명을 볼 수 있어요.</p>
    </div>
    <button type="button" class="facility-detail-return" data-facility-return><span aria-hidden="true">‹</span> 단지로 이동</button>
    <div class="facility-detail-title">
      <h2 id="${titleId}"></h2><span class="facility-detail-level" hidden></span>
    </div>
    <div class="facility-detail-current" aria-live="polite" aria-atomic="true" hidden>
      <div class="facility-detail-current-name"></div>
      <p class="facility-detail-current-description"></p>
    </div>
    <p class="facility-detail-source">도면 기반 참고 모형</p>
  `;
  const query = <T extends HTMLElement = HTMLElement>(selector: string) => section.querySelector<T>(selector)!;
  query(`#${titleId}`).textContent = plan.label;
  query('.facility-detail-source').title = plan.sourceNote;
  host.append(section);

  const events = new AbortController();
  const options = { signal: events.signal };
  const stage = query('.facility-detail-stage');
  const layer = query('.facility-detail-model-layer');
  const canvas = query<HTMLCanvasElement>('canvas');
  const labels = query('.facility-detail-labels');
  const level = query('.facility-detail-level');
  const message = query('.facility-detail-stage-message');
  const compass = query('.facility-detail-compass');
  const compassLegends = [...compass.querySelectorAll('i')];
  const stair = query<HTMLButtonElement>('[data-facility-stair]');
  const back = query<HTMLButtonElement>('[data-facility-return]');
  const roomStatus = query('.facility-detail-current');
  const accent = hasFloors ? '#fbd16d' : '#ec8f91';
  section.style.setProperty('--facility-accent', accent);
  let current = plan.floors[0];
  let selected: string | undefined;
  let roomLabels = new Map<string, HTMLButtonElement>();
  let roomNames = new Map<string, string>();
  let model: ReturnType<typeof createFacilityFloorModel> | undefined;
  let renderer: WebGLRenderer | undefined;
  let controls: OrbitControls | undefined;
  let renderFrame = 0;
  let disposed = false;
  let changingFloor = false;
  let floorAnimation: Animation | null = null;
  let graphicsLost = false;
  const world = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 750);
  const framing = new Box3();
  for (const floor of plan.floors) for (const [x, z] of floor.outline) framing.expandByPoint(new Vector3(x, 0, z));
  const size = framing.getSize(new Vector3());
  const middle = framing.getCenter(new Vector3()).setY(.28);
  const markerPosition = new Vector3();
  const ray = new Raycaster();
  const normalize = new Vector2();
  const homeLight = new DirectionalLight('#fff0d5', 2.35);
  const sky = new HemisphereLight('#f1f8ff', '#7c876d', 2.1);
  const fill = new DirectionalLight('#c4e3ef', .6);
  world.add(sky, homeLight, homeLight.target, fill);
  homeLight.castShadow = true;
  homeLight.shadow.mapSize.set(768, 768);
  homeLight.shadow.bias = -.00035;
  homeLight.shadow.normalBias = .035;
  homeLight.shadow.intensity = .68;

  type BadgePosition = { x: number; y: number; w: number; h: number };
  function snapBadge(element: HTMLElement, x: number, y: number, unplaced: boolean): void {
    element.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    element.toggleAttribute('data-unplaced', unplaced);
  }
  function point(x: number, y: number, z: number, width: number, height: number) {
    markerPosition.set(x, y, z).project(camera);
    return { x: (markerPosition.x + 1) * width / 2, y: (1 - markerPosition.y) * height / 2,
      inDepth: markerPosition.z >= -1 && markerPosition.z <= 1 };
  }
  function render(): void {
    if (disposed || !renderer || !model || graphicsLost) return;
    renderer.render(world, camera);
    const w = stage.clientWidth, h = stage.clientHeight;
    const compact = w < 450;
    const occupied: BadgePosition[] = [
      { x: 60, y: 24, w: 120, h: 48 }, { x: w - 79, y: 28, w: 158, h: 56 },
      { x: 22, y: h - 25, w: 45, h: 50 },
    ];
    if (!roomStatus.hidden) occupied.push({
      x: w - roomStatus.offsetWidth / 2 - 9, y: h - roomStatus.offsetHeight / 2 - 9,
      w: roomStatus.offsetWidth + 12, h: roomStatus.offsetHeight + 12,
    });
    const place = (a: BadgePosition) => occupied.every(b =>
      Math.abs(a.x - b.x) > (a.w + b.w) / 2 + 2 || Math.abs(a.y - b.y) > (a.h + b.h) / 2 + 2);
    const stairRoom = hasFloors ? current.rooms.find(room => room.id === 'stairs') : undefined;
    if (stairRoom) {
      const p = point(stairRoom.center[0], .75, stairRoom.center[1], w, h);
      // Even when the stair has been panned beyond the canvas, keep keyboard access.
      const visible = p.inDepth && p.x >= 12 && p.x < w - 12 && p.y >= 8 && p.y < h - 8;
      const centerX = Math.max(47, Math.min(w - 47, p.x));
      const centerY = Math.max(53, Math.min(h - 30, p.y - 12));
      snapBadge(stair, visible ? centerX : 52, visible ? centerY : h - 72, !visible);
      if (visible) occupied.push({ x: centerX, y: centerY, w: 84, h: 42 });
    }
    const chosen = current.rooms.find(room => room.id === selected);
    const captions = chosen ? [chosen, ...current.rooms.filter(room => room !== chosen)] : current.rooms;
    for (const room of captions) {
      const badge = roomLabels.get(room.id);
      if (!badge) continue;
      const width = Math.min(125, (badge.textContent?.length ?? room.label.length) * (compact ? 8 : 9.5) + 12);
      const p = point(room.center[0], .32, room.center[1], w, h);
      const card = { x: p.x, y: p.y, w: width, h: compact ? 20 : 22 };
      const clear = p.inDepth && p.x > width / 2 + 5 && p.x < w - width / 2 - 5 && p.y > 18 && p.y < h - 21;
      const fit = clear && place(card);
      const labelX = Math.max(width / 2 + 8, Math.min(w - width / 2 - 8, p.x));
      const labelY = Math.max(54, Math.min(h - 37, p.y));
      snapBadge(badge, fit ? p.x : labelX, fit ? p.y : labelY, !fit);
      if (fit) occupied.push(card);
    }
    CARDINALS.forEach(([x, y, z], i) => {
      markerPosition.set(x, y, z).transformDirection(camera.matrixWorldInverse);
      const length = Math.hypot(markerPosition.x, markerPosition.y) || 1;
      compassLegends[i].style.transform = `translate(-50%, -50%) translate(${12 * markerPosition.x / length}px, ${-12 * markerPosition.y / length}px)`;
      if (i === 0) {
        const bearing = Math.round(Math.atan2(markerPosition.x, markerPosition.y) / (Math.PI / 4));
        compass.setAttribute('aria-label', `방위: 북쪽은 화면 ${DIRECTIONS[(bearing + 8) % 8]}`);
      }
    });
  }

  function schedule(): void {
    if (renderFrame || disposed || graphicsLost) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); });
  }

  function resize(): void {
    if (!renderer || graphicsLost) return;
    const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
    const ratio = width / height;
    const span = Math.max(size.x * .59 / ratio, size.z * .50 + 1, 4);
    camera.left = -span * ratio;
    camera.right = span * ratio;
    camera.top = span;
    camera.bottom = -span;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    schedule();
  }

  function setRoom(roomId?: string): void {
    const room = current.rooms.find(({ id }) => id === roomId);
    selected = room?.id;
    roomStatus.hidden = !room;
    query('.facility-detail-current-name').textContent = room ? roomNames.get(room.id)! : '';
    query('.facility-detail-current-description').textContent = room?.description ?? '';
    for (const [key, badge] of roomLabels) badge.setAttribute('aria-pressed', String(key === selected));
    model?.select(selected);
    schedule();
  }

  function setFloor(floor: FacilityFloor): void {
    current = floor;
    section.dataset.activeFacilityFloor = floor.id;
    if (hasFloors) {
      level.hidden = false;
      level.textContent = floor.label;
      const up = floor.id === '1f';
      stair.hidden = !floor.rooms.some(room => room.id === 'stairs');
      stair.dataset.direction = up ? 'up' : 'down';
      stair.lastElementChild!.textContent = up ? '2층으로' : '1층으로';
    }
    const totals = new Map<string, number>(), counts = new Map<string, number>();
    for (const { label } of floor.rooms) totals.set(label, (totals.get(label) ?? 0) + 1);
    roomNames = new Map(floor.rooms.map(({ id: key, label }) => {
      if (totals.get(label) === 1) return [key, label];
      const number = (counts.get(label) ?? 0) + 1;
      counts.set(label, number);
      return [key, `${label} ${number}`];
    }));
    roomLabels = new Map(floor.rooms.filter(room => !hasFloors || room.id !== 'stairs').map((room) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'facility-detail-room';
      button.dataset.facilityRoom = room.id;
      button.dataset.kind = room.kind;
      button.textContent = roomNames.get(room.id)!;
      button.title = button.textContent;
      button.toggleAttribute('data-unplaced', Boolean(renderer && !graphicsLost));
      return [room.id, button] as const;
    }));
    labels.replaceChildren(...roomLabels.values());
    if (renderer && !graphicsLost) {
      model?.dispose();
      model = createFacilityFloorModel(floor, accent);
      world.add(model.root);
      renderer.shadowMap.needsUpdate = true;
    }
    setRoom();
  }

  async function moveFloor(): Promise<void> {
    const next = plan.floors.find(floor => floor !== current);
    if (!next || changingFloor || disposed) return;
    const direction = current.id === '1f' ? -1 : 1;
    if (!renderer || graphicsLost || matchMedia('(prefers-reduced-motion: reduce)').matches || !layer.animate) {
      setFloor(next);
      return;
    }
    changingFloor = true;
    stair.setAttribute('aria-disabled', 'true');
    layer.style.pointerEvents = 'none';
    section.toggleAttribute('data-changing-floor', true);
    try {
      floorAnimation = layer.animate([
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: `translateY(${direction * 13}px) scale(.99)` },
      ], { duration: 145, easing: 'cubic-bezier(.42,0,1,1)', fill: 'forwards' });
      await floorAnimation.finished;
      if (disposed) return;
      // Same world origin, framing and camera pose: switch just the floor meshes.
      setFloor(next);
      render();
      floorAnimation.cancel();
      floorAnimation = layer.animate([
        { opacity: 0, transform: `translateY(${direction * -15}px) scale(.99)` },
        { opacity: 1, transform: 'none' },
      ], { duration: 235, easing: 'cubic-bezier(0,0,.25,1)' });
      await floorAnimation.finished;
    } catch {
      // The overlay may have been removed during the transition.
    } finally {
      floorAnimation = null;
      changingFloor = false;
      stair.removeAttribute('aria-disabled');
      layer.style.removeProperty('pointer-events');
      section.toggleAttribute('data-changing-floor', false);
    }
  }

  function noWebGL(): void {
    graphicsLost = true;
    canvas.hidden = true;
    compass.hidden = true;
    message.hidden = false;
    section.toggleAttribute('data-graphics-lost', true);
    for (const badge of roomLabels.values()) badge.removeAttribute('data-unplaced');
    stair.removeAttribute('data-unplaced');
  }

  const observer = new ResizeObserver(resize);
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const lightSpan = Math.hypot(size.x, size.z) * .65;
    homeLight.position.copy(middle).add(new Vector3(-lightSpan * .7, lightSpan, lightSpan * .5));
    homeLight.target.position.copy(middle);
    fill.position.copy(middle).add(new Vector3(lightSpan * .5, lightSpan * .5, -lightSpan * .5));
    Object.assign(homeLight.shadow.camera, { left: -lightSpan, right: lightSpan, top: lightSpan, bottom: -lightSpan, near: .1, far: lightSpan * 3.5 });
    homeLight.shadow.camera.updateProjectionMatrix();

    const distance = Math.max(22, size.length() * 1.55);
    camera.position.copy(middle).add(new Vector3(0, distance * .89, distance * .51));
    camera.lookAt(middle);
    camera.updateMatrixWorld();
    controls = new OrbitControls(camera, canvas);
    controls.target.copy(middle);
    controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    controls.minZoom = .7;
    controls.maxZoom = 4.3;
    controls.minPolarAngle = .012;
    controls.maxPolarAngle = Math.PI * .36;
    controls.enableDamping = false;
    controls.rotateSpeed = .58;
    controls.addEventListener('change', schedule);
    controls.update();
    observer.observe(stage);
    resize();
  } catch {
    renderer?.dispose();
    renderer = undefined;
    noWebGL();
  }
  setFloor(current);

  const fingers = new Set<number>();
  let press: { id: number; x: number; y: number; moved: boolean } | null = null;
  const capture = { ...options, capture: true };
  canvas.addEventListener('pointerdown', (event) => {
    fingers.add(event.pointerId);
    if (fingers.size !== 1 || changingFloor) { press = null; return; }
    if (event.button === 0) press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }, capture);
  canvas.addEventListener('pointermove', (event) => {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press.moved = true;
  }, capture);
  window.addEventListener('pointerup', (event) => {
    if (!fingers.delete(event.pointerId) || press?.id !== event.pointerId) return;
    const origin = press;
    press = null;
    if (!model || changingFloor || origin.moved || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) return;
    const box = canvas.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom) return;
    normalize.set(2 * (event.clientX - box.left) / box.width - 1, 1 - 2 * (event.clientY - box.top) / box.height);
    ray.setFromCamera(normalize, camera);
    const hit = ray.intersectObjects(model.pickables, false)[0];
    const clicked = hit?.object.userData.facilityRoom as string | undefined;
    if (clicked === 'stairs' && hasFloors) void moveFloor();
    else setRoom(clicked);
  }, capture);
  window.addEventListener('pointercancel', (event) => { fingers.delete(event.pointerId); if (press?.id === event.pointerId) press = null; }, capture);
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); noWebGL(); }, options);
  back.addEventListener('click', onBack, options);
  stair.addEventListener('click', () => { void moveFloor(); }, options);
  labels.addEventListener('click', (event) => {
    if (changingFloor || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLButtonElement>('[data-facility-room]');
    if (target) setRoom(target.dataset.facilityRoom === selected ? undefined : target.dataset.facilityRoom);
  }, options);
  section.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onBack();
  }, options);
  back.focus({ preventScroll: true });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      events.abort();
      observer.disconnect();
      if (renderFrame) cancelAnimationFrame(renderFrame);
      floorAnimation?.cancel();
      controls?.dispose();
      model?.dispose();
      homeLight.shadow.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      section.remove();
    },
  };
}
