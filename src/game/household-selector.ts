import { escapeHtml, resolveProjectUrl } from './base';
import type { ShowcaseCatalog } from './types';
import {
  BUNDANG_HOUSEHOLD_CATALOG,
  householdSelection,
  type BundangBuildingV1,
  type BundangHouseholdLineV1,
  type HouseholdSelectionV1,
} from './household-catalog';
import {
  householdVerificationIsOperator,
  householdVerificationConfigured,
  requestHouseholdVerification,
  verifyHousehold,
  verifyShareViewer,
  HouseholdVerificationError,
  type HouseholdVerificationConfigV1,
  type HouseholdVerificationRole,
} from './household-verification';
import { resetAllBunfirvilLocalData } from '../shared/storage';
import '../styles/household-input.css';

export const HOUSEHOLD_FLOORS = Array.from({ length: 25 }, (_, index) => 25 - index);

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function floorRail(): string {
  return `<div class="household-floor-rail" aria-hidden="true">
    <span class="household-floor-rail-head">층</span>
    <div>${HOUSEHOLD_FLOORS.map((floor) => `<span>${floor}</span>`).join('')}</div>
    <span class="household-floor-rail-foot">TYPE</span>
  </div>`;
}

function lineCell(building: BundangBuildingV1, line: BundangHouseholdLineV1, floor: number, interactive: boolean): string {
  const isHousehold = floor >= line.firstFloor && floor <= line.lastFloor;
  const isPilotis = line.pilotisFloors.includes(floor);
  if (isHousehold) {
    const number = String(floor * 100 + line.lineId);
    const facing = line.facing === 'south-east' ? '남동향' : '남서향';
    const content = `<span>${number}</span>`;
    const attributes = `class="household-cell unit-${line.unitType.toLowerCase()}" data-building="${building.buildingId}" data-floor="${floor}" data-line="${line.lineId}" aria-label="${building.buildingId}동 ${number}호 ${line.unitType} ${facing}"`;
    return interactive
      ? `<button type="button" ${attributes} aria-pressed="false">${content}</button>`
      : `<span ${attributes}>${content}</span>`;
  }
  if (isPilotis) {
    return `<span class="household-cell is-pilotis" aria-label="${building.buildingId}동 ${floor}층 ${line.lineId}호 라인 필로티">×</span>`;
  }
  return '<span class="household-cell is-void" aria-hidden="true"></span>';
}

export function householdBuildingCard(building: BundangBuildingV1, interactive = true): string {
  const cells = HOUSEHOLD_FLOORS.flatMap((floor) => building.lines.map((line) => lineCell(building, line, floor, interactive))).join('');
  const lineLabels = building.lines.map((line) => `<span class="unit-${line.unitType.toLowerCase()}">${line.unitType}</span>`).join('');
  return `<article class="household-building-card" data-building-card="${building.buildingId}">
    <header><b>${building.buildingId}동</b><small>${building.lines.length}개 호라인</small></header>
    <div class="household-unit-grid" style="--line-count:${building.lines.length}">${cells}</div>
    <footer style="--line-count:${building.lines.length}">${lineLabels}</footer>
  </article>`;
}

export function householdBuildingRows(buildings: BundangBuildingV1[], columnCount: number, interactive = true): string {
  return chunks(buildings, columnCount).map((row) => `
    <section class="household-building-row" style="--building-count:${row.length}" aria-label="${row[0]?.buildingId}동부터 ${row[row.length - 1]?.buildingId}동">
      ${floorRail()}
      ${row.map((building) => householdBuildingCard(building, interactive)).join('')}
    </section>
  `).join('');
}

function buildingPicker(): string {
  return BUNDANG_HOUSEHOLD_CATALOG.buildings.map((building) => {
    return `<button type="button" class="household-building-choice" data-choose-building="${building.buildingId}" aria-label="${building.buildingId}동 선택" aria-pressed="false">
      <span class="household-building-number"><b>${building.buildingId}</b><small>동</small></span>
    </button>`;
  }).join('');
}

export function householdStorageDialogMarkup(): string {
  return `<dialog id="selector-storage-dialog" class="storage-dialog">
    <form method="dialog">
      <button class="dialog-close" value="close" aria-label="닫기">×</button>
      <p class="eyebrow">LOCAL STORAGE</p>
      <h2>저장 관리</h2>
      <p class="storage-dialog-lead">옵션과 가구 배치는 서버가 아닌 현재 브라우저에만 저장됩니다.</p>
      <dl class="storage-key-list">
        <div><dt>옵션·검수</dt><dd>평형별 · 모든 타입 공통</dd></div>
        <div><dt>가구 배치</dt><dd>평형별 · 모든 타입 공통</dd></div>
        <div><dt>건축 검수</dt><dd>평형·타입별</dd></div>
        <div><dt>핫바</dt><dd>전체 맵 공통</dd></div>
      </dl>
      <a class="storage-guide-link" href="${resolveProjectUrl('guides/?guide=local-storage')}">로컬 저장·초기화 가이드 보기 →</a>
      <button type="button" id="selector-reset-all" class="storage-danger-button">Bunfirvil 전체 로컬 데이터 초기화</button>
      <output id="selector-storage-status" class="storage-dialog-status" aria-live="polite"></output>
    </form>
  </dialog>`;
}

export function bindHouseholdStorageControls(mount: HTMLElement): void {
  const storageDialog = mount.querySelector<HTMLDialogElement>('#selector-storage-dialog');
  const storageStatus = mount.querySelector<HTMLOutputElement>('#selector-storage-status');
  mount.querySelector<HTMLButtonElement>('#selector-open-storage')?.addEventListener('click', () => storageDialog?.showModal());
  mount.querySelector<HTMLButtonElement>('#selector-reset-all')?.addEventListener('click', () => {
    if (!window.confirm('Bunfirvil의 모든 평형 옵션·가구, 검수 메모, 건축 기록과 핫바를 초기화할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    const result = resetAllBunfirvilLocalData();
    if (storageStatus) storageStatus.textContent = `${result.removedKeys.length}개의 Bunfirvil 저장 항목을 초기화했습니다.`;
  });
}

export interface HouseholdSelectionResultV1 {
  selection: HouseholdSelectionV1 | null;
  role: HouseholdVerificationRole;
  nickname: string;
}

export function householdShellHeader(exportId: string, fallback = false, overview = false): string {
  const operator = householdVerificationIsOperator();
  const householdHref = overview ? resolveProjectUrl('') : resolveProjectUrl('households/');
  const householdLabel = overview ? '세대 선택' : '전체 동·호 현황';
  return `<header class="topbar household-topbar">
    <a class="brand" href="${resolveProjectUrl('')}" aria-label="Bunfirvil 렌더 랩 홈">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span><b>e편한세상 분당퍼스트빌리지</b><small>돌아온범생의 놀이터 개발 연구실</small></span>
    </a>
    <nav class="topnav" aria-label="주요 메뉴">
      <a class="is-active" href="${resolveProjectUrl('')}"><span>LIVE</span> 놀이터</a>
      ${operator ? `<a href="${resolveProjectUrl('manage/')}">검수맵 관리</a>
      <a href="${resolveProjectUrl('building-admin/')}">건축물 관리</a>
      <a href="${resolveProjectUrl('interior-admin/')}">인테리어 관리</a>` : ''}
      <a href="${resolveProjectUrl('guides/')}">가이드</a>
    </nav>
    <div class="household-header-actions" aria-label="세대 메뉴">
      ${operator ? `<a class="household-header-action" href="${householdHref}" aria-label="${householdLabel}"><span>${householdLabel}</span><small aria-hidden="true">${overview ? '선택' : '현황'}</small></a>` : ''}
      <button type="button" id="selector-open-storage" class="household-header-action" aria-label="저장 관리"><span>저장 관리</span><small aria-hidden="true">저장</small></button>
      <div class="build-chip" title="현재 정적 자산 스냅샷">
        <span class="status-dot ${fallback ? 'is-amber' : ''}"></span>
        <span><small>STATIC BUILD</small><b>${escapeHtml(exportId)}</b></span>
      </div>
    </div>
  </header>
  <div class="serverless-banner" role="status">
    <span class="banner-pulse" aria-hidden="true"></span>
    <b>평면도, 사이버주택전시관 기반 추론가상공간입니다. 공고문, 실제 주택전시관 정보를 참고하세요</b>
    <span>게시 자료는 참고용</span>
    <i></i>
    <span>데이터는 이 브라우저에만 저장됩니다.</span>
  </div>`;
}

export function waitForHouseholdSelection(
  mount: HTMLElement,
  catalog: ShowcaseCatalog,
  fallback: boolean,
  verificationConfig: HouseholdVerificationConfigV1,
  shareAuthentication = false,
): Promise<HouseholdSelectionResultV1> {
  return new Promise((resolve) => {
    let selected: HouseholdSelectionV1 | null = null;
    mount.innerHTML = `<div class="household-selector-shell app-shell ${shareAuthentication ? 'is-share-authentication' : ''}">
      ${householdShellHeader(catalog.exportId, fallback)}
      <main class="household-selector-main">
        <div class="household-wizard-shell">
        <section class="household-selector-intro" id="household-selector-intro">
          <div class="household-selector-intro-copy">
            <nav class="household-wizard-progress ${shareAuthentication ? 'is-share-progress' : ''}" aria-label="${shareAuthentication ? '공유 놀이터 인증 단계' : '세대 선택 단계'}">
              <button type="button" id="household-step-building" class="is-current" aria-current="step"><i>1</i><b>동 선택</b></button>
              <em aria-hidden="true"></em>
              ${shareAuthentication
                ? '<button type="button" id="household-step-nickname" disabled><i>2</i><b>닉네임 입력</b></button>'
                : '<button type="button" id="household-step-unit" disabled><i>2</i><b>세대 선택</b></button><em aria-hidden="true"></em><button type="button" id="household-step-nickname" disabled><i>3</i><b>닉네임 입력</b></button>'}
            </nav>
            <p class="eyebrow">BUNDANG FIRST VILLAGE</p>
            <h1 id="household-selector-title">분당퍼스트빌리지 동 선택</h1>
            <p id="household-selector-description">먼저 확인할 동을 선택해 주세요. 다음 화면에서 해당 동의 세대를 선택할 수 있습니다.</p>
          </div>
          <div class="household-legend" id="household-selector-legend" aria-label="평형 색상 범례" hidden>
            <span class="unit-51a"><i></i>51A</span><span class="unit-55a"><i></i>55A</span><span class="unit-55b"><i></i>55B</span><span class="unit-59a"><i></i>59A</span><span class="is-pilotis"><i>×</i>필로티</span>
          </div>
        </section>
        <section id="household-building-picker" class="household-building-picker-panel">
          <div class="household-building-picker">${buildingPicker()}</div>
        </section>
        <section id="household-building-detail" class="household-building-detail" hidden>
          <header class="household-building-detail-head">
            <button type="button" id="household-building-back" class="household-building-back">← 동 다시 선택</button>
            <span id="household-selected-building" class="household-selected-building"></span>
          </header>
          <div id="household-building-rows" class="household-building-rows"></div>
        </section>
        <section id="household-nickname-stage" class="household-nickname-stage" hidden>
          <header class="household-nickname-stage-head">
            <button type="button" id="household-unit-back" class="household-building-back">← ${shareAuthentication ? '동 다시 선택' : '세대 다시 선택'}</button>
            <span id="household-nickname-building" class="household-selected-building"></span>
          </header>
          <div class="household-nickname-card">
            <h2>닉네임 입력</h2>
            <div class="household-nickname-controls">
              <label><span>닉네임</span><input id="household-nickname" type="text" maxlength="20" autocomplete="off" placeholder="닉네임 입력" /></label>
              <button type="button" id="household-verify-nickname" disabled>인증 확인</button>
            </div>
            <div id="household-operator-code-group" class="household-operator-code" hidden>
              <label for="household-operator-code">운영자 인증코드</label>
              <input id="household-operator-code" type="password" maxlength="128" autocomplete="off" placeholder="별도 운영자 인증코드" />
              <small>공개 닉네임과 다른 코드를 입력하세요. 코드가 공유 링크나 브라우저 저장소에 저장되지는 않습니다.</small>
            </div>
            <output id="household-nickname-status" aria-live="polite"></output>
            <div class="household-registration-request" ${shareAuthentication ? 'hidden' : ''}>
              <button type="button" id="household-request-verification" disabled>해당 닉네임으로 등록 요청</button>
            </div>
            ${shareAuthentication ? `<p class="household-share-registration">미등록 회원은 <a href="${resolveProjectUrl('')}" target="_blank" rel="noopener">본인 세대를 선택해 등록 요청</a>한 뒤 이 화면에서 다시 인증해 주세요.</p>` : ''}
          </div>
        </section>
        </div>
      </main>
      <aside class="household-selection-dock" id="household-selection-dock" aria-live="polite" hidden>
        <div><small>${shareAuthentication ? '공유 놀이터 인증' : '선택 세대'}</small><b id="household-selection-summary">${shareAuthentication ? '동과 닉네임을 확인해 주세요.' : '동·층·호를 선택해 주세요.'}</b></div>
        <button type="button" id="household-enter" disabled>${shareAuthentication ? '공유 놀이터 열람' : '놀이터 입장'}</button>
      </aside>
      ${householdStorageDialogMarkup()}
    </div>`;

    const shell = mount.querySelector<HTMLElement>('.household-selector-shell')!;
    const picker = mount.querySelector<HTMLElement>('#household-building-picker');
    const detail = mount.querySelector<HTMLElement>('#household-building-detail');
    const nicknameStage = mount.querySelector<HTMLElement>('#household-nickname-stage');
    const rows = mount.querySelector<HTMLElement>('#household-building-rows');
    const title = mount.querySelector<HTMLElement>('#household-selector-title');
    const description = mount.querySelector<HTMLElement>('#household-selector-description');
    const legend = mount.querySelector<HTMLElement>('#household-selector-legend');
    const buildingStep = mount.querySelector<HTMLButtonElement>('#household-step-building');
    const unitStep = mount.querySelector<HTMLButtonElement>('#household-step-unit');
    const nicknameStep = mount.querySelector<HTMLButtonElement>('#household-step-nickname');
    const selectedBuilding = mount.querySelector<HTMLElement>('#household-selected-building');
    const nicknameBuilding = mount.querySelector<HTMLElement>('#household-nickname-building');
    const dock = mount.querySelector<HTMLElement>('#household-selection-dock');
    const summary = mount.querySelector<HTMLElement>('#household-selection-summary');
    const enter = mount.querySelector<HTMLButtonElement>('#household-enter');
    const nicknameInput = mount.querySelector<HTMLInputElement>('#household-nickname');
    const verifyNickname = mount.querySelector<HTMLButtonElement>('#household-verify-nickname');
    const requestVerification = mount.querySelector<HTMLButtonElement>('#household-request-verification');
    const nicknameStatus = mount.querySelector<HTMLOutputElement>('#household-nickname-status');
    const operatorGroup = mount.querySelector<HTMLElement>('#household-operator-code-group')!;
    const operatorInput = mount.querySelector<HTMLInputElement>('#household-operator-code')!;
    if (!picker || !detail || !nicknameStage || !rows || !title || !description || !legend || !buildingStep || (!shareAuthentication && !unitStep) || !nicknameStep || !selectedBuilding || !nicknameBuilding || !dock || !summary || !enter || !nicknameInput || !verifyNickname || !requestVerification || !nicknameStatus) throw new Error('세대 선택 화면을 구성하지 못했습니다.');
    let chosenBuildingId: string | null = null;
    let nickname = '';
    let nicknameVerified = false;
    let verifiedRole: HouseholdVerificationRole | null = null;
    let verificationAttempt = 0;
    let verificationController: AbortController | null = null;
    const inputViewportEvents = new AbortController();
    let inputViewportFrame = 0;
    const fitActiveNicknameInput = (): void => {
      inputViewportFrame = 0;
      if (nicknameStage.hidden || !window.matchMedia('(pointer: coarse), (max-width: 760px)').matches) return;
      const input = document.activeElement;
      if (!(input instanceof HTMLInputElement) || !nicknameStage.contains(input)) return;
      const viewport = window.visualViewport;
      const top = (viewport?.offsetTop || 0) + 16;
      const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) - 16;
      const bounds = input.getBoundingClientRect();
      const delta = bounds.bottom > bottom ? bounds.bottom - bottom : bounds.top < top ? bounds.top - top : 0;
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' });
    };
    const scheduleInputVisibility = (): void => {
      if (inputViewportFrame) cancelAnimationFrame(inputViewportFrame);
      inputViewportFrame = requestAnimationFrame(fitActiveNicknameInput);
    };
    nicknameStage.addEventListener('focusin', scheduleInputVisibility, { signal: inputViewportEvents.signal });
    window.addEventListener('resize', scheduleInputVisibility, { signal: inputViewportEvents.signal });
    window.visualViewport?.addEventListener('resize', scheduleInputVisibility, { signal: inputViewportEvents.signal });

    const invalidateVerification = (): void => {
      verificationAttempt += 1;
      verificationController?.abort();
      verificationController = null;
    };

    const paintBuildingChoice = (): void => {
      picker.querySelectorAll<HTMLButtonElement>('[data-choose-building]').forEach((button) => {
        const active = button.dataset.chooseBuilding === chosenBuildingId;
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', String(active));
      });
    };

    const animatePanel = (panel: HTMLElement): void => {
      panel.classList.remove('is-entering');
      requestAnimationFrame(() => panel.classList.add('is-entering'));
    };

    const revealVerifiedDock = (): void => {
      if (!nicknameVerified) return;
      shell.classList.remove('is-nickname-editing');
      nicknameInput.disabled = true;
      operatorInput.value = '';
      operatorInput.disabled = true;
      verifyNickname.disabled = true;
      requestVerification.disabled = true;
      nicknameStep.classList.add('is-complete');
      dock.hidden = false;
      dock.classList.remove('is-authenticated');
      void dock.offsetWidth;
      dock.classList.add('is-authenticated');
    };

    const updateSelectionSummary = (): void => {
      if (shareAuthentication) {
        const nicknameText = nickname.trim() ? ` · ${nickname.trim()}` : '';
        summary.textContent = chosenBuildingId
          ? `${chosenBuildingId}동${nicknameText} · 공유 열람 인증`
          : '동과 닉네임을 확인해 주세요.';
        enter.disabled = !nicknameVerified;
        return;
      }
      if (!selected) {
        summary.textContent = '층·호를 선택해 주세요.';
        enter.disabled = true;
        return;
      }
      const facing = selected.facing === 'south-east' ? '남동향' : '남서향';
      const nicknameText = nickname.trim() ? ` · ${nickname.trim()}` : '';
      summary.textContent = `${selected.buildingId}동 ${selected.householdNumber}호 · ${selected.floor}층 · ${selected.unitType}${nicknameText} · ${facing}`;
      enter.disabled = !nicknameVerified;
    };

    const resetNicknameVerification = (clearNickname: boolean): void => {
      invalidateVerification();
      nicknameVerified = false;
      verifiedRole = null;
      operatorInput.value = '';
      operatorInput.disabled = false;
      operatorGroup.hidden = true;
      if (clearNickname) {
        nickname = '';
        nicknameInput.value = '';
      }
      verifyNickname.textContent = '인증 확인';
      requestVerification.textContent = '해당 닉네임으로 등록 요청';
      nicknameInput.disabled = false;
      verifyNickname.disabled = nickname.trim().length === 0 || !householdVerificationConfigured(verificationConfig);
      requestVerification.disabled = shareAuthentication || verifyNickname.disabled;
      verifyNickname.removeAttribute('aria-busy');
      requestVerification.removeAttribute('aria-busy');
      dock.classList.remove('is-authenticated');
      nicknameStatus.textContent = householdVerificationConfigured(verificationConfig)
        ? ''
        : '인증 서비스 연결 주소가 아직 설정되지 않았습니다.';
      updateSelectionSummary();
    };

    const paintSelection = (): void => {
      mount.querySelectorAll<HTMLButtonElement>('.household-cell[data-building]').forEach((button) => {
        const active = Boolean(selected
          && button.dataset.building === selected.buildingId
          && Number(button.dataset.floor) === selected.floor
          && Number(button.dataset.line) === selected.lineId);
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', String(active));
      });
      if (!selected) return;
      updateSelectionSummary();
    };

    const showBuildingPicker = (): void => {
      shell.classList.remove('is-nickname-editing');
      selected = null;
      resetNicknameVerification(true);
      picker.hidden = false;
      detail.hidden = true;
      nicknameStage.hidden = true;
      dock.hidden = true;
      legend.hidden = true;
      title.textContent = '분당퍼스트빌리지 동 선택';
      description.textContent = shareAuthentication
        ? '공유 놀이터 열람 인증에 사용할 동을 선택해 주세요. 세대 선택은 필요하지 않습니다.'
        : '먼저 확인할 동을 선택해 주세요. 다음 화면에서 해당 동의 세대를 선택할 수 있습니다.';
      buildingStep.classList.add('is-current');
      buildingStep.classList.toggle('is-complete', Boolean(chosenBuildingId));
      buildingStep.setAttribute('aria-current', 'step');
      unitStep?.classList.remove('is-current');
      unitStep?.classList.remove('is-complete');
      unitStep?.removeAttribute('aria-current');
      if (unitStep) unitStep.disabled = !chosenBuildingId;
      nicknameStep.classList.remove('is-current', 'is-complete');
      nicknameStep.removeAttribute('aria-current');
      nicknameStep.disabled = true;
      paintBuildingChoice();
      animatePanel(picker);
      enter.disabled = true;
    };

    const showBuilding = (buildingId: string, pushHistory: boolean): void => {
      const building = BUNDANG_HOUSEHOLD_CATALOG.buildings.find((entry) => entry.buildingId === buildingId);
      if (!building) return;
      shell.classList.remove('is-nickname-editing');
      chosenBuildingId = buildingId;
      selected = null;
      resetNicknameVerification(true);
      if (shareAuthentication) {
        paintBuildingChoice();
        showNicknameStage();
        return;
      }
      picker.hidden = true;
      detail.hidden = false;
      nicknameStage.hidden = true;
      dock.hidden = false;
      legend.hidden = false;
      rows.innerHTML = `<section class="household-building-row is-single" data-line-count="${building.lines.length}" style="--building-count:1" aria-label="${building.buildingId}동 세대">${floorRail()}${householdBuildingCard(building)}</section>`;
      title.textContent = `${building.buildingId}동 세대 선택`;
      description.innerHTML = '<strong class="household-selection-privacy">선택한 세대는 저장되지 않으며</strong> 층/타입을 구분하여 인증에 사용됩니다.';
      selectedBuilding.textContent = `${building.buildingId}동 선택됨`;
      buildingStep.classList.remove('is-current');
      buildingStep.classList.add('is-complete');
      buildingStep.removeAttribute('aria-current');
      unitStep?.classList.add('is-current');
      unitStep?.classList.remove('is-complete');
      unitStep?.setAttribute('aria-current', 'step');
      if (unitStep) unitStep.disabled = false;
      nicknameStep.classList.remove('is-current', 'is-complete');
      nicknameStep.removeAttribute('aria-current');
      nicknameStep.disabled = true;
      paintBuildingChoice();
      animatePanel(detail);
      updateSelectionSummary();
      if (pushHistory) history.pushState({ householdBuilding: buildingId }, '', `#building=${buildingId}`);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    };

    const showNicknameStage = (): void => {
      if ((!selected && !shareAuthentication) || !chosenBuildingId) return;
      picker.hidden = true;
      detail.hidden = true;
      nicknameStage.hidden = false;
      shell.classList.toggle('is-nickname-editing', !nicknameVerified);
      dock.hidden = false;
      dock.classList.toggle('is-authenticated', nicknameVerified);
      legend.hidden = true;
      title.textContent = '닉네임 입력';
      description.textContent = shareAuthentication
        ? '동과 닉네임 인증 후 공유받은 놀이터를 읽기 전용으로 열람할 수 있습니다.'
        : '선택한 세대에서 사용할 닉네임을 입력하고 인증을 확인해 주세요.';
      nicknameBuilding.textContent = shareAuthentication
        ? `${chosenBuildingId}동 선택됨 · 공유 열람`
        : `${selected!.buildingId}동 ${selected!.householdNumber}호 선택됨`;
      buildingStep.classList.remove('is-current');
      buildingStep.classList.add('is-complete');
      buildingStep.removeAttribute('aria-current');
      unitStep?.classList.remove('is-current');
      unitStep?.classList.add('is-complete');
      unitStep?.removeAttribute('aria-current');
      nicknameStep.classList.add('is-current');
      nicknameStep.classList.remove('is-complete');
      nicknameStep.setAttribute('aria-current', 'step');
      nicknameStep.disabled = false;
      animatePanel(nicknameStage);
      updateSelectionSummary();
      // Focus within the selection gesture: mobile browsers can suppress the
      // keyboard when focus is deferred to an animation frame. Let the browser
      // scroll the field into view when its virtual keyboard opens.
      if (!nicknameInput.disabled) nicknameInput.focus();
    };

    picker.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-choose-building]');
      if (button?.dataset.chooseBuilding) showBuilding(button.dataset.chooseBuilding, !shareAuthentication);
    });

    buildingStep.addEventListener('click', () => {
      if (!picker.hidden) return;
      if (!shareAuthentication) history.pushState({ householdStep: 'building' }, '', `${window.location.pathname}${window.location.search}`);
      showBuildingPicker();
    });

    unitStep?.addEventListener('click', () => {
      if (!chosenBuildingId || !detail.hidden) return;
      showBuilding(chosenBuildingId, false);
    });

    nicknameStep.addEventListener('click', () => {
      if ((!selected && !shareAuthentication) || !nicknameStage.hidden) return;
      showNicknameStage();
    });

    rows.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.household-cell[data-building]');
      if (!button) return;
      selected = householdSelection(
        button.dataset.building || '',
        Number(button.dataset.floor),
        Number(button.dataset.line),
        catalog.maps,
      );
      resetNicknameVerification(false);
      paintSelection();
      showNicknameStage();
    });

    nicknameInput.addEventListener('input', () => {
      nickname = nicknameInput.value;
      resetNicknameVerification(false);
      nicknameStatus.textContent = householdVerificationConfigured(verificationConfig)
        ? (nickname.trim() ? '인증 확인이 필요합니다.' : '')
        : '인증 서비스 연결 주소가 아직 설정되지 않았습니다.';
      updateSelectionSummary();
    });

    const authenticate = async (register: boolean): Promise<void> => {
      if (verificationController || nicknameVerified || register && shareAuthentication) return;
      const candidate = nickname.trim();
      const buildingId = selected?.buildingId || chosenBuildingId || '';
      const unitType = selected?.unitType || '';
      if (!candidate || !buildingId || (!shareAuthentication && !unitType) || !householdVerificationConfigured(verificationConfig)) return;
      const attempt = ++verificationAttempt;
      const controller = new AbortController();
      verificationController = controller;
      verifyNickname.disabled = true;
      requestVerification.disabled = true;
      operatorInput.disabled = true;
      const button = register ? requestVerification : verifyNickname;
      button.setAttribute('aria-busy', 'true');
      nicknameStatus.textContent = register ? '닉네임 등록을 요청하고 있습니다.' : '닉네임을 확인하고 있습니다.';
      try {
        const input = { buildingId, unitType, nickname: candidate, operatorCode: operatorInput.value };
        const response = shareAuthentication
          ? await verifyShareViewer(verificationConfig, input, undefined, controller.signal)
          : register ? await requestHouseholdVerification(verificationConfig, input, undefined, controller.signal)
            : await verifyHousehold(verificationConfig, input, undefined, controller.signal);
        if (attempt !== verificationAttempt || nickname.trim() !== candidate) return;
        nicknameVerified = response.verified;
        verifiedRole = response.operator ? 'operator' : response.verified ? 'verified' : null;
        verifyNickname.textContent = response.verified ? '인증 완료' : '다시 확인';
        if (response.code === 'operator_code_required') {
          operatorGroup.hidden = false;
          nicknameStatus.textContent = '운영자 인증코드를 입력해 주세요. 반복 실패 시 10분 후 다시 시도하세요.';
        } else if (response.code === 'operator_setup_required') {
          nicknameStatus.textContent = '운영자 인증코드가 설정되지 않았습니다. Sheet의 분퍼빌 회원 관리 메뉴에서 먼저 설정해 주세요.';
        } else if (response.code === 'membership_suspended') {
          nicknameStatus.textContent = '인증할 수 없습니다. 운영자에게 회원 상태를 확인해 주세요.';
        } else {
          nicknameStatus.textContent = response.operator ? '운영자 인증이 완료되었습니다. 관리 메뉴를 사용할 수 있습니다.'
            : response.verified ? (shareAuthentication ? '공유 열람 인증이 완료되었습니다.' : '세대 및 닉네임 인증이 완료되었습니다.')
            : response.status === 'requested' ? '등록 요청이 확인 대기 중입니다. 승인 후 인증 확인을 눌러 주세요.'
            : response.status === 'rejected' ? '등록 요청이 반려되었습니다. 운영자에게 문의해 주세요.'
            : shareAuthentication ? '선택한 동과 닉네임의 회원 정보를 확인할 수 없습니다.' : '선택한 동·타입과 닉네임을 확인할 수 없습니다.';
        }
        revealVerifiedDock();
      } catch (error) {
        if (attempt !== verificationAttempt) return;
        nicknameVerified = false;
        verifiedRole = null;
        verifyNickname.textContent = '다시 확인';
        const code = error instanceof HouseholdVerificationError ? error.code : '';
        nicknameStatus.textContent = code === 'backend-update-required' ? '인증 서비스 업데이트가 필요합니다. 운영자가 새 Code.gs를 배포한 뒤 다시 시도해 주세요.'
          : code === 'rate_limited' ? '등록 요청이 너무 빠릅니다. 1분 후 다시 시도해 주세요.'
          : code === 'request_capacity' ? '현재 등록 요청 접수량이 많습니다. 운영자에게 문의해 주세요.'
          : '인증 서비스를 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
      } finally {
        if (verificationController === controller) verificationController = null;
        if (attempt === verificationAttempt) {
          button.removeAttribute('aria-busy');
          operatorInput.disabled = nicknameVerified;
          verifyNickname.disabled = nicknameVerified;
          requestVerification.disabled = nicknameVerified || shareAuthentication;
          updateSelectionSummary();
          if (!operatorGroup.hidden && !nicknameVerified) operatorInput.focus();
        }
      }
    };
    verifyNickname.addEventListener('click', () => { void authenticate(false); });
    requestVerification.addEventListener('click', () => { void authenticate(true); });
    operatorInput.addEventListener('input', () => {
      invalidateVerification();
      verifyNickname.disabled = false;
    });
    for (const input of [nicknameInput, operatorInput]) {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        if (!verifyNickname.disabled) verifyNickname.click();
      });
    }

    const onPopState = (): void => {
      if (shareAuthentication) {
        showBuildingPicker();
        return;
      }
      const buildingId = new URLSearchParams(window.location.hash.slice(1)).get('building');
      if (buildingId) showBuilding(buildingId, false);
      else showBuildingPicker();
    };
    window.addEventListener('popstate', onPopState);
    mount.querySelector<HTMLButtonElement>('#household-building-back')?.addEventListener('click', () => {
      if (window.location.hash.startsWith('#building=')) history.back();
      else showBuildingPicker();
    });
    mount.querySelector<HTMLButtonElement>('#household-unit-back')?.addEventListener('click', () => {
      if (shareAuthentication) showBuildingPicker();
      else if (chosenBuildingId) showBuilding(chosenBuildingId, false);
    });

    enter.addEventListener('click', () => {
      if ((!selected && !shareAuthentication) || !nicknameVerified || !verifiedRole) return;
      window.removeEventListener('popstate', onPopState);
      inputViewportEvents.abort();
      if (inputViewportFrame) cancelAnimationFrame(inputViewportFrame);
      resolve({ selection: selected, role: verifiedRole, nickname: nickname.trim() });
    });

    bindHouseholdStorageControls(mount);

    const initialBuilding = new URLSearchParams(window.location.hash.slice(1)).get('building');
    if (initialBuilding) showBuilding(initialBuilding, false);
    else showBuildingPicker();
  });
}
