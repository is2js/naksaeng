import {
  ACESFilmicToneMapping, Box3, DirectionalLight, HemisphereLight, MOUSE, OrthographicCamera,
  PCFShadowMap, Raycaster, Scene, SRGBColorSpace, TOUCH, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FACILITY_DETAIL_PLANS, type FacilityDetailId, type FacilityFloor, type FacilityRoom } from './facility-detail-data';
import { createFacilityFloorModel } from './facility-detail-model';
import './facility-detail.css';

let activeDialog: HTMLDialogElement | null = null;
const CATEGORY: Record<FacilityRoom['kind'], string> = { program: '주요 공간', circulation: '이동 공간', service: '지원 공간', outdoor: '외부 공간' };
const CARDINALS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]] as const;
const DIRECTIONS = ['위', '오른쪽 위', '오른쪽', '오른쪽 아래', '아래', '왼쪽 아래', '왼쪽', '왼쪽 위'];

export function openFacilityDetail(id: FacilityDetailId, trigger?: HTMLElement): void {
  const plan = FACILITY_DETAIL_PLANS[id];
  activeDialog?.close();
  const dialog = document.createElement('dialog');
  activeDialog = dialog;
  dialog.className = 'facility-detail-dialog';
  dialog.dataset.facilityDetail = id;
  dialog.dataset.accent = id === 'daycare-104' ? 'daycare' : 'community';
  dialog.setAttribute('aria-labelledby', 'facility-detail-title');
  dialog.innerHTML = `
    <header class="facility-detail-header">
      <div class="facility-detail-heading">
        <p class="facility-detail-kicker"><span></span> 분퍼빌 · 시설 둘러보기</p>
        <h2 id="facility-detail-title"></h2>
        <p class="facility-detail-summary"></p>
      </div>
      <button type="button" class="facility-detail-close" data-detail-close aria-label="시설 상세 닫기" autofocus>×</button>
    </header>
    <div class="facility-detail-body">
      <main class="facility-detail-main">
        <div class="facility-detail-floor-row">
          <div class="facility-detail-floors" role="group" aria-label="시설 층 선택"></div>
          <span class="facility-detail-floor-hint">북향 기준 · 지붕을 덜어낸 단면</span>
        </div>
        <div class="facility-detail-stage">
          <canvas data-facility-detail-canvas aria-label="시설 3D 단면 모형. 방을 터치하거나 목록에서 공간을 선택할 수 있습니다."></canvas>
          <div class="facility-detail-labels" aria-hidden="true"></div>
          <div class="facility-detail-compass" role="img" aria-label="방위: 화면 위가 북쪽"><i>북</i><i>동</i><i>남</i><i>서</i></div>
          <div class="facility-detail-stage-tools" role="group" aria-label="모형 시점 조절">
            <button type="button" data-detail-view="north" title="북쪽을 화면 위 방향으로 맞춥니다">정북 보기</button>
            <button type="button" data-detail-view="plan" aria-pressed="false" title="위에서 평면을 봅니다">평면 보기</button>
            <button type="button" data-detail-view="plus" aria-label="모형 확대">+</button>
            <button type="button" data-detail-view="minus" aria-label="모형 축소">−</button>
          </div>
          <p class="facility-detail-stage-message" role="status" hidden>이 기기에서 3D 모형을 표시할 수 없습니다. 아래 공간 목록은 계속 볼 수 있습니다.</p>
        </div>
        <p class="facility-detail-controls-help">드래그로 회전 · 휠 또는 두 손가락으로 확대 · 방을 누르면 설명을 볼 수 있어요.</p>
      </main>
      <aside class="facility-detail-sidebar" aria-label="층별 공간과 설명">
        <div class="facility-detail-current" aria-live="polite" aria-atomic="true">
          <p class="facility-detail-current-tag"></p>
          <h3 class="facility-detail-current-name"></h3>
          <p class="facility-detail-current-description"></p>
        </div>
        <div class="facility-detail-room-head"><strong>이 층의 공간</strong><span class="facility-detail-room-count"></span></div>
        <div class="facility-detail-rooms" role="group" aria-label="층별 공간 목록"></div>
      </aside>
    </div>
    <p class="facility-detail-source"></p>
  `;
  const query = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  query('#facility-detail-title').textContent = plan.label;
  query('.facility-detail-summary').textContent = plan.description;
  query('.facility-detail-source').textContent = plan.sourceNote;
  document.body.append(dialog);
  dialog.showModal();

  const events = new AbortController();
  const eventOptions = { signal: events.signal };
  const stage = query('.facility-detail-stage');
  const canvas = query<HTMLCanvasElement>('canvas');
  const labels = query('.facility-detail-labels');
  const rooms = query('.facility-detail-rooms');
  const floors = query('.facility-detail-floors');
  const message = query('.facility-detail-stage-message');
  const compass = query('.facility-detail-compass');
  const compassLegends = [...compass.querySelectorAll('i')];
  const tools = [...dialog.querySelectorAll<HTMLButtonElement>('[data-detail-view]')];
  const closeButton = query<HTMLButtonElement>('[data-detail-close]');
  const accent = id === 'daycare-104' ? '#fbd16d' : '#ec8f91';
  let current = plan.floors[0];
  let selected: string | undefined;
  let roomLabels = new Map<string, HTMLElement>();
  let roomNames = new Map<string, string>();
  let model: ReturnType<typeof createFacilityFloorModel> | undefined;
  let renderer: WebGLRenderer | undefined;
  let controls: OrbitControls | undefined;
  let renderFrame = 0;
  let planView = false;
  let backdropDown = false;
  let disposed = false;
  const world = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 750);
  const middle = new Vector3();
  const size = new Vector3();
  const bounds = new Box3();
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

  function render(): void {
    if (disposed || !renderer || !model) return;
    renderer.render(world, camera);
    const w = stage.clientWidth, h = stage.clientHeight;
    const occupied: { x: number; y: number; w: number }[] = [];
    const captions = selected ? [current.rooms.find(({ id }) => id === selected)!, ...current.rooms.filter(({ id }) => id !== selected)] : current.rooms;
    for (const room of captions) {
      const badge = roomLabels.get(room.id)!;
      markerPosition.set(room.center[0], .57, room.center[1]).project(camera);
      const x = (markerPosition.x + 1) * w * .5, y = (1 - markerPosition.y) * h * .5;
      const width = Math.min(116, (badge.textContent?.length ?? room.label.length) * (w < 450 ? 9 : 10) + 10);
      const clear = markerPosition.z >= -1 && markerPosition.z <= 1 && x > width / 2 + 5 && x < w - width / 2 - 5 && y > 21 && y < h - 16
        && !(x < 66 && y < 58) && !(x > w - (w < 410 ? 120 : 178) && y > h - 62);
      const available = occupied.every((spot) => Math.abs(spot.y - y) > 19 || Math.abs(spot.x - x) > (spot.w + width) / 2 + 2);
      badge.hidden = !clear || !available;
      if (!badge.hidden) {
        badge.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
        occupied.push({ x, y, w: width });
      }
    }
    CARDINALS.forEach(([x, y, z], i) => {
      markerPosition.set(x, y, z).transformDirection(camera.matrixWorldInverse);
      const length = Math.hypot(markerPosition.x, markerPosition.y) || 1;
      compassLegends[i].style.transform = `translate(-50%, -50%) translate(${16 * markerPosition.x / length}px, ${-16 * markerPosition.y / length}px)`;
      if (i === 0) {
        const bearing = Math.round(Math.atan2(markerPosition.x, markerPosition.y) / (Math.PI / 4));
        compass.setAttribute('aria-label', `방위: 북쪽은 화면 ${DIRECTIONS[(bearing + 8) % 8]}`);
      }
    });
  }

  function schedule(): void {
    if (renderFrame || disposed) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); });
  }

  function resize(): void {
    if (!renderer || !model) return;
    const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
    const ratio = width / height;
    const diagonal = Math.hypot(size.x, size.z);
    const span = Math.max(diagonal * .43, size.x * .54 / ratio, size.z * .57 + 1);
    camera.left = -span * ratio;
    camera.right = span * ratio;
    camera.top = span;
    camera.bottom = -span;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    schedule();
  }

  function setView(fromAbove: boolean): void {
    planView = fromAbove;
    query<HTMLButtonElement>('[data-detail-view="plan"]').setAttribute('aria-pressed', String(planView));
    const distance = Math.max(22, size.length() * 1.55);
    camera.position.copy(middle).add(new Vector3(0, distance * (fromAbove ? 1 : .84), distance * (fromAbove ? .014 : .55)));
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.lookAt(middle);
    camera.updateMatrixWorld();
    controls?.target.copy(middle);
    controls?.update();
    compass.setAttribute('aria-label', '방위: 화면 위가 북쪽, 오른쪽이 동쪽');
    schedule();
  }

  function setRoom(roomId?: string): void {
    const room = current.rooms.find(({ id }) => id === roomId);
    selected = room?.id;
    query('.facility-detail-current-tag').textContent = [current.label, room && CATEGORY[room.kind]].filter(Boolean).join(' · ');
    query('.facility-detail-current-name').textContent = room ? roomNames.get(room.id)! : '공간을 선택해 보세요';
    query('.facility-detail-current-description').textContent = room?.description ?? '3D 모형의 바닥이나 공간 목록을 누르면 용도를 확인할 수 있습니다.';
    for (const button of rooms.querySelectorAll<HTMLButtonElement>('[data-facility-room]')) button.setAttribute('aria-pressed', String(button.dataset.facilityRoom === selected));
    for (const [key, badge] of roomLabels) badge.classList.toggle('is-chosen', key === selected);
    model?.select(selected);
    schedule();
  }

  function setFloor(floor: FacilityFloor): void {
    current = floor;
    dialog.dataset.activeFacilityFloor = floor.id;
    for (const button of floors.querySelectorAll<HTMLButtonElement>('[data-facility-floor]')) button.setAttribute('aria-pressed', String(button.dataset.facilityFloor === floor.id));
    query('.facility-detail-room-count').textContent = `${floor.rooms.length}곳`;
    const totals = new Map<string, number>(), counts = new Map<string, number>();
    for (const { label } of floor.rooms) totals.set(label, (totals.get(label) ?? 0) + 1);
    roomNames = new Map(floor.rooms.map(({ id, label }) => {
      if (totals.get(label) === 1) return [id, label];
      const number = (counts.get(label) ?? 0) + 1;
      counts.set(label, number);
      return [id, `${label} ${number}`];
    }));
    rooms.replaceChildren(...floor.rooms.map((room) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'facility-detail-room';
      button.dataset.facilityRoom = room.id;
      button.dataset.kind = room.kind;
      button.textContent = roomNames.get(room.id)!;
      return button;
    }));
    roomLabels = new Map(floor.rooms.map((room) => {
      const badge = document.createElement('span');
      badge.textContent = roomNames.get(room.id)!;
      badge.title = badge.textContent;
      badge.hidden = true;
      return [room.id, badge] as const;
    }));
    labels.replaceChildren(...roomLabels.values());
    if (renderer) {
      model?.dispose();
      model = createFacilityFloorModel(floor, accent);
      world.add(model.root);
      bounds.setFromObject(model.root).getSize(size);
      bounds.getCenter(middle);
      middle.y = .28;
      const lightSpan = Math.hypot(size.x, size.z) * .65;
      homeLight.position.copy(middle).add(new Vector3(-lightSpan * .7, lightSpan, lightSpan * .5));
      homeLight.target.position.copy(middle);
      fill.position.copy(middle).add(new Vector3(lightSpan * .5, lightSpan * .5, -lightSpan * .5));
      Object.assign(homeLight.shadow.camera, { left: -lightSpan, right: lightSpan, top: lightSpan, bottom: -lightSpan, near: .1, far: lightSpan * 3.5 });
      homeLight.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
      resize();
      setView(planView);
    }
    setRoom();
  }

  function noWebGL(): void {
    canvas.hidden = true;
    compass.hidden = true;
    labels.hidden = true;
    message.hidden = false;
    tools.forEach((button) => { button.disabled = true; });
  }

  const observer = new ResizeObserver(resize);
  for (const floor of plan.floors) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.facilityFloor = floor.id;
    button.textContent = floor.label;
    floors.append(button);
  }
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    controls = new OrbitControls(camera, canvas);
    controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    controls.minZoom = .7;
    controls.maxZoom = 4.3;
    controls.minPolarAngle = .012;
    controls.maxPolarAngle = Math.PI * .36;
    controls.enableDamping = false;
    controls.rotateSpeed = .58;
    controls.addEventListener('change', schedule);
    observer.observe(stage);
  } catch {
    renderer?.dispose();
    renderer = undefined;
    noWebGL();
  }
  setFloor(current);

  const fingers = new Set<number>();
  let press: { id: number; x: number; y: number; moved: boolean } | null = null;
  const capture = { ...eventOptions, capture: true };
  canvas.addEventListener('pointerdown', (event) => {
    fingers.add(event.pointerId);
    if (fingers.size !== 1) { press = null; return; }
    if (event.button === 0) press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }, capture);
  canvas.addEventListener('pointermove', (event) => {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press.moved = true;
  }, capture);
  window.addEventListener('pointerup', (event) => {
    if (!fingers.delete(event.pointerId) || press?.id !== event.pointerId) return;
    const origin = press;
    press = null;
    if (!model || origin.moved || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) return;
    const bounds = canvas.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) return;
    normalize.set(2 * (event.clientX - bounds.left) / bounds.width - 1, 1 - 2 * (event.clientY - bounds.top) / bounds.height);
    ray.setFromCamera(normalize, camera);
    const hit = ray.intersectObjects(model.pickables, false)[0];
    if (hit) setRoom(hit.object.userData.facilityRoom as string);
  }, capture);
  window.addEventListener('pointercancel', (event) => { fingers.delete(event.pointerId); if (press?.id === event.pointerId) press = null; }, capture);
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); noWebGL(); }, eventOptions);
  dialog.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLButtonElement>('button');
    if (!target || target.disabled) return;
    if (Object.hasOwn(target.dataset, 'detailClose')) { dialog.close(); return; }
    const view = target.dataset.detailView;
    if (view === 'north') setView(false);
    else if (view === 'plan') setView(!planView);
    else if (view === 'plus' || view === 'minus') {
      camera.zoom = Math.max(.7, Math.min(4.3, camera.zoom * (view === 'plus' ? 1.2 : 1 / 1.2)));
      camera.updateProjectionMatrix();
      schedule();
    }
    const floor = plan.floors.find(({ id }) => id === target.dataset.facilityFloor);
    if (floor && floor !== current) setFloor(floor);
    if (target.dataset.facilityRoom) setRoom(target.dataset.facilityRoom);
  }, eventOptions);

  const isBackdrop = (event: PointerEvent) => {
    const box = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  };
  dialog.addEventListener('pointerdown', (event) => { backdropDown = isBackdrop(event); }, eventOptions);
  dialog.addEventListener('pointerup', (event) => { if (backdropDown && isBackdrop(event)) dialog.close(); backdropDown = false; }, eventOptions);
  dialog.addEventListener('close', () => {
    disposed = true;
    events.abort();
    observer.disconnect();
    if (renderFrame) cancelAnimationFrame(renderFrame);
    controls?.dispose();
    model?.dispose();
    homeLight.shadow.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    dialog.remove();
    if (activeDialog === dialog) {
      activeDialog = null;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  }, { once: true });
  window.addEventListener('pagehide', (event) => { if (!event.persisted) dialog.close(); }, eventOptions);
  closeButton.focus({ preventScroll: true });
}
