import { readFile } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";

const MAPS = [
  ["bundang-first-village-51a-prototype", "51A"],
  ["bundang-first-village-55a-prototype", "55A"],
  ["bundang-first-village-55b-prototype", "55B"],
  ["bundang-first-village-59a-prototype", "59A"],
] as const;

const VARIANT_B_TRANSFORMS: Record<string, string> = {
  '51A': '좌우반전 + 반시계 90° 회전',
  '55A': '좌우반전 + 반시계 90° 회전',
  '55B': '상하반전 + 반시계 180° 회전',
  '59A': '좌우반전',
};

async function observeNextMotion(actor: Locator, expected: "attack" | "cast"): Promise<void> {
  await actor.evaluate((element, motion) => {
    const actorElement = element as HTMLElement;
    actorElement.removeAttribute("data-observed-motion");
    let observer: MutationObserver | null = null;
    const capture = () => {
      if (actorElement.dataset.motion !== motion) return;
      actorElement.dataset.observedMotion = motion;
      observer?.disconnect();
    };
    observer = new MutationObserver(capture);
    observer.observe(actorElement, { attributes: true, attributeFilter: ["data-motion"] });
    capture();
  }, expected);
}

test("runs the full serverless showcase and local review workflow", async ({ page }) => {
  const forbiddenRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/^wss?:/i.test(url) || /socket\.io/i.test(url) || new URL(url).pathname.includes("/api/")) {
      forbiddenRequests.push(url);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("./");
  await expect(page.getByText("평면도, 사이버주택전시관 기반 추론가상공간입니다. 공고문, 실제 주택전시관 정보를 참고하세요", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "가이드", exact: true })).toHaveAttribute("href", /guides\/$/);
  await expect(page.getByRole("link", { name: "건축물 관리", exact: true })).toHaveAttribute("href", /building-admin\/$/);
  await expect(page.getByRole("link", { name: "인테리어 관리", exact: true })).toHaveAttribute("href", /interior-admin\/$/);
  await expect(page.getByRole("link", { name: "옵션 가이드", exact: true })).toHaveAttribute("href", /guides\/\?guide=b-option$/);
  await expect(page.locator("#stage-loader")).toBeHidden();
  await expect(page.locator("#metric-renderer")).toHaveText(/THREE·PBR|CANVAS·(?:ISO|FALLBACK)|MINIMAP|PROCEDURAL/);
  const threeCanvas = page.locator("#three-world-canvas");
  await expect.poll(async () => Number(await threeCanvas.getAttribute("data-interior-asset-count"))).toBeGreaterThanOrEqual(96);
  await expect.poll(async () => Number(await threeCanvas.getAttribute("data-recipe-part-count"))).toBeGreaterThanOrEqual(450);
  const initialTransferBytes = await page.evaluate(() => performance.getEntriesByType("resource")
    .reduce((total, entry) => {
      const resource = entry as PerformanceResourceTiming;
      return total + (resource.transferSize || resource.encodedBodySize || 0);
    }, 0));
  expect(initialTransferBytes).toBeLessThan(10 * 1024 * 1024);

  const mapSelect = page.getByLabel("검수맵 선택");
  await expect(page.locator('#game-stage')).toHaveAttribute('data-plan-variant', 'A');
  await expect.poll(async () => Number(await threeCanvas.getAttribute('data-occluded-wall-count'))).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'B형', exact: true }).click();
  await expect(page.locator('#stage-loader')).toBeHidden();
  for (const [mapId, unitType] of MAPS) {
    await mapSelect.selectOption(mapId);
    await expect(mapSelect).toHaveValue(mapId);
    await expect(page.locator("#map-unit")).toHaveText(unitType);
    await expect(page.locator("#stage-loader")).toBeHidden();
    await expect(page.locator("#metric-chunks")).toHaveText("16/16");
    await expect(threeCanvas).toHaveAttribute("data-apartment-structure", "ready");
    await expect(page.locator('#game-stage')).toHaveAttribute('data-actor-spawn-room', 'living');
    await expect(page.locator('#game-stage')).toHaveAttribute('data-plan-variant', 'B');
    await expect(page.locator('#game-stage')).toHaveAttribute('data-plan-variant-transform', VARIANT_B_TRANSFORMS[unitType]);
    await expect(page.locator('#plan-variant-badge')).toHaveText('B형');
    await expect(threeCanvas).toHaveAttribute('data-structure-shadow-policy', 'exterior-walls-only');
    await expect(threeCanvas).toHaveAttribute('data-interior-shadow-caster-count', '0');
    await expect.poll(async () => Number(await threeCanvas.getAttribute('data-exterior-shadow-caster-count'))).toBeGreaterThan(0);
    await expect.poll(async () => Number(await threeCanvas.getAttribute("data-structure-mesh-count"))).toBeGreaterThan(50);
    await expect.poll(async () => Number(await threeCanvas.getAttribute("data-structure-occluder-count"))).toBeGreaterThan(10);
    await expect(threeCanvas).toHaveAttribute("data-interior-placement-status", "verified");
    await expect(threeCanvas).toHaveAttribute("data-interior-placement-issue-count", "0");
  }

  const actor100 = page.locator('.rpg-actor[data-actor="100"]');
  const actor200 = page.locator('.rpg-actor[data-actor="200"]');
  const minimap = page.locator('#floorplan-minimap');
  await expect(minimap).toHaveAttribute('data-floorplan-ready', 'true');
  await expect(minimap).toHaveAttribute('data-plan-variant', 'B');
  await expect(minimap).toHaveAttribute('data-actor-count', '2');
  await expect(page.locator('.performance-hud')).toHaveCount(0);
  await expect(actor100.locator('.actor-health')).toHaveCount(0);
  await expect(actor100.locator('.actor-select-ring')).toHaveCount(0);
  await expect(actor100.locator('.actor-name')).toHaveCSS('opacity', '1');
  await expect(actor100).toHaveAttribute('tabindex', '-1');
  await actor100.hover();
  await expect(actor100.locator('.actor-name')).toHaveCSS('opacity', '1');
  await expect(actor100.locator('.actor-name')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.locator('#map-select').hover();
  await expect(actor100.locator('.actor-name')).toHaveCSS('opacity', '1');
  const actorSpriteBounds = await actor100.locator('.actor-sprite').boundingBox();
  expect(actorSpriteBounds).not.toBeNull();
  expect(actorSpriteBounds!.width).toBeCloseTo(actorSpriteBounds!.height, 1);
  const hotbarSlots = page.locator("#hotbar .hotbar-slot");
  await expect(hotbarSlots).toHaveCount(6);
  await expect(hotbarSlots.nth(0)).toHaveAttribute("data-skill-id", "common-teleport");
  await expect(hotbarSlots.nth(1)).toHaveAttribute("data-skill-id", "basic-attack");
  const thirdSlotBounds = await hotbarSlots.nth(2).boundingBox();
  const fourthSlotBounds = await hotbarSlots.nth(3).boundingBox();
  expect(thirdSlotBounds).not.toBeNull();
  expect(fourthSlotBounds).not.toBeNull();
  expect(fourthSlotBounds!.x - (thirdSlotBounds!.x + thirdSlotBounds!.width)).toBeGreaterThan(10);

  const panBounds = await page.locator('#game-stage').boundingBox();
  expect(panBounds).not.toBeNull();
  const panStart = { x: panBounds!.x + 24, y: panBounds!.y + panBounds!.height * .58 };
  await page.mouse.move(panStart.x, panStart.y);
  expect(await page.locator('#three-world-canvas').evaluate((element) => getComputedStyle(element).cursor)).toBe('grab');
  await page.mouse.down();
  await expect(page.locator('#game-stage')).toHaveClass(/is-panning/);
  expect(await page.locator('#three-world-canvas').evaluate((element) => getComputedStyle(element).cursor)).toBe('grabbing');
  await page.mouse.move(panStart.x + 54, panStart.y + 28, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('#game-stage')).toHaveAttribute('data-camera-tracking', 'free');
  await expect(page.locator('#game-stage')).toHaveAttribute('data-last-pan-moved', 'true');
  await expect.poll(async () => Number(await threeCanvas.getAttribute('data-pan-count'))).toBeGreaterThan(0);

  await page.getByRole("button", { name: "100", exact: true }).click();
  await expect(page.locator('#game-stage')).toHaveAttribute('data-camera-tracking', 'follow');
  await expect(page.locator("#active-actor-label")).toHaveText("돌범");
  await observeNextMotion(actor100, "attack");
  await page.getByRole("button", { name: "2번 기본 공격" }).click();
  await expect(actor100).toHaveAttribute("data-observed-motion", "attack");
  await page.waitForTimeout(900);
  await observeNextMotion(actor100, "attack");
  await page.keyboard.press('Space');
  await expect(actor100).toHaveAttribute("data-observed-motion", "attack");

  await page.getByRole("button", { name: "200", exact: true }).click();
  await expect(page.locator("#active-actor-label")).toHaveText("피치");
  expect(await actor200.locator(".actor-sprite").evaluate((element) => Number.parseFloat(getComputedStyle(element).width))).toBe(68);
  await expect(actor200.locator('.actor-motion')).toHaveCount(0);
  await expect(page.locator('#zoom-value')).toHaveText('100%');
  await expect(threeCanvas).toHaveAttribute('data-camera-zoom', '1.290');
  await expect(page.locator("#game-stage")).toHaveAttribute("data-movement-interval-ms", "420");
  await expect(page.locator("#game-stage")).toHaveAttribute("data-cell-projection", "32x24");
  const startX = Number(await actor200.getAttribute("data-world-x"));
  const startY = Number(await actor200.getAttribute("data-world-y"));
  await page.keyboard.down("KeyD");
  await expect(actor200).toHaveAttribute("data-travel-state", "moving");
  await expect(actor200).toHaveAttribute("data-animation-cycle-ms", "420");
  await page.waitForTimeout(520);
  await page.keyboard.up("KeyD");
  await expect(actor200).toHaveAttribute("data-direction", "e");
  await expect.poll(async () => Number(await actor200.getAttribute("data-world-x"))).toBeGreaterThan(startX);
  const { endX, endY } = await actor200.evaluate((element) => ({
    endX: Number((element as HTMLElement).dataset.worldX),
    endY: Number((element as HTMLElement).dataset.worldY),
  }));
  expect(endX - startX).toBeGreaterThanOrEqual(1);
  expect(startY - endY).toBeCloseTo(endX - startX, 5);

  // 현재 cell이 끝나기 전에는 다음 키의 방향 row로 선회하지 않는다.
  await page.getByRole("button", { name: "스폰 위치로 돌아가기" }).click();
  await page.keyboard.down("KeyD");
  await expect(actor200).toHaveAttribute("data-travel-state", "moving");
  await actor200.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "d", code: "KeyD", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW", bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await actor200.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", code: "KeyW", bubbles: true })));
  await expect(actor200).toHaveAttribute("data-travel-state", "settled");
  await expect(actor200).toHaveAttribute("data-direction", "n");
  await observeNextMotion(actor200, "cast");
  await page.getByRole("button", { name: "3번 쇼크스턴" }).click();
  await expect(actor200).toHaveAttribute("data-observed-motion", "cast");

  const originalSkillIcons = page.locator('#hotbar .hotbar-slot[data-skill-id]:not([data-skill-id="basic-attack"]):not([data-skill-id=""]) img');
  await expect(originalSkillIcons).toHaveCount(3);
  for (const icon of await originalSkillIcons.all()) {
    expect(await icon.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }

  await observeNextMotion(actor200, "attack");
  await page.keyboard.press("Digit4");
  await expect(actor200).toHaveAttribute("data-observed-motion", "attack");

  const stageBounds = await page.locator("#game-stage").boundingBox();
  expect(stageBounds).not.toBeNull();
  const beforeNumberTeleport = {
    x: Number(await actor200.getAttribute("data-world-x")),
    y: Number(await actor200.getAttribute("data-world-y")),
  };
  await page.mouse.move(stageBounds!.x + stageBounds!.width * 0.7, stageBounds!.y + stageBounds!.height * 0.42);
  await observeNextMotion(actor200, "cast");
  await page.keyboard.press("Digit1");
  await expect(actor200).toHaveAttribute("data-observed-motion", "cast");
  await expect.poll(async () => `${await actor200.getAttribute("data-world-x")},${await actor200.getAttribute("data-world-y")}`)
    .not.toBe(`${beforeNumberTeleport.x},${beforeNumberTeleport.y}`);

  const beforeWheelTeleport = `${await actor200.getAttribute("data-world-x")},${await actor200.getAttribute("data-world-y")}`;
  await page.mouse.move(stageBounds!.x + stageBounds!.width * 0.32, stageBounds!.y + stageBounds!.height * 0.52);
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await expect.poll(async () => `${await actor200.getAttribute("data-world-x")},${await actor200.getAttribute("data-world-y")}`)
    .not.toBe(beforeWheelTeleport);

  const secondSlot = page.locator('#hotbar [data-slot="1"]');
  const fourthSlot = page.locator('#hotbar [data-slot="3"]');
  await page.evaluate(() => {
    const from = document.querySelector<HTMLElement>('#hotbar [data-slot="1"]');
    const to = document.querySelector<HTMLElement>('#hotbar [data-slot="3"]');
    if (!from || !to) throw new Error('핫바 드래그 대상이 없습니다.');
    const transfer = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  });
  await expect(secondSlot).toHaveAttribute("data-skill-id", "common-double-arrow");
  await expect(fourthSlot).toHaveAttribute("data-skill-id", "basic-attack");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bunfirvil:hotbar:v1") || "[]")[3])).toBe("basic-attack");

  const firstOption = page.locator('.option-card input[type="checkbox"]').first();
  const firstOptionPreview = page.locator(".option-card .option-preview img").first();
  await expect(firstOptionPreview).toBeVisible();
  expect(await firstOptionPreview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const firstOptionId = await firstOption.getAttribute("data-option-id");
  expect(firstOptionId).toBeTruthy();
  const propsBeforeOption = Number(await threeCanvas.getAttribute("data-apartment-prop-count"));
  await firstOption.setChecked(true, { force: true });
  await expect(page.locator("#option-selected-count")).toHaveText("1개");
  await expect(page.locator("#option-total")).not.toHaveText(/^0/);
  await expect(page.locator("#stage-option-chips")).not.toContainText("기본 마감");
  await expect(page.locator("#stage-option-total")).toHaveText(await page.locator("#option-total").innerText());
  const optionCategories = page.locator('#option-categories');
  await expect.poll(async () => optionCategories.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '주방 벽/상판·냉장고장', exact: true })).toBeVisible();
  const optionList = page.locator('#option-list');
  const optionSummary = page.locator('.option-summary');
  await expect.poll(async () => optionList.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  const summaryTop = (await optionSummary.boundingBox())!.y;
  await optionList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(async () => optionList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(Math.abs((await optionSummary.boundingBox())!.y - summaryTop)).toBeLessThan(1);
  expect((await page.locator('#option-total').innerText()).replace(/\s/g, '')).toMatch(/^\d{1,3}(,\d{3})*원$/);
  expect(await page.locator('.option-card .option-copy b').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(11);
  expect(await page.locator('.stage-tip').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(10);
  expect(await page.locator('.stage-option-chips b').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(9);
  await page.locator('#option-categories button', { hasText: '시스템에어컨' }).click();
  const generalAcCard = page.locator('.system-ac-card[data-system-ac-tier="general"]');
  await expect(generalAcCard).toBeVisible();
  await generalAcCard.getByRole('button', { name: '설치 대수 1 증가' }).click();
  await expect(generalAcCard.locator('output')).toHaveText('2대');
  await generalAcCard.getByRole('button', { name: '설치 대수 1 증가' }).click();
  // 59A 공개 계약은 3대 패키지가 없어 원본 팔레트와 같이 다음 제공 대수인 4대로 이동한다.
  await expect(page.locator('.system-ac-card[data-system-ac-tier="general"] output')).toHaveText('4대');
  await expect.poll(async () => Number(await threeCanvas.getAttribute("data-apartment-prop-count"))).toBeGreaterThan(propsBeforeOption);
  await expect(threeCanvas).toHaveAttribute("data-interior-placement-status", "verified");
  await page.getByRole("button", { name: "적용만 보기" }).click();
  await expect(page.getByRole("button", { name: "전체 보기" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => page.locator("#option-list .option-card").count()).toBeGreaterThan(0);
  expect(await page.locator("#option-list .option-card").evaluateAll((cards) => cards.every((card) => card.classList.contains("is-selected")))).toBe(true);
  await page.getByRole("button", { name: "전체 보기" }).click();
  const savedQuote = await page.locator("#option-total").innerText();
  const savedMapId = await mapSelect.inputValue();

  await page.getByRole("button", { name: "가구 배치", exact: true }).click();
  const furnitureCards = page.locator("#furniture-list .furniture-card");
  await expect.poll(async () => furnitureCards.count()).toBeGreaterThan(30);
  expect(await furnitureCards.first().locator('b').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(9);
  const furniturePreview = furnitureCards.first().locator("img");
  await expect(furniturePreview).toBeVisible();
  expect(await furniturePreview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await furnitureCards.first().click();
  const authoringCanvas = page.locator("#three-world-canvas");
  const authoringBounds = await authoringCanvas.boundingBox();
  expect(authoringBounds).not.toBeNull();
  const zoomBefore = Number(await authoringCanvas.getAttribute("data-camera-zoom"));
  const actorScaleBefore = Number(await actor200.getAttribute("data-world-scale"));
  await page.mouse.move(authoringBounds!.x + authoringBounds!.width / 2, authoringBounds!.y + authoringBounds!.height / 2);
  await page.mouse.wheel(0, -420);
  await expect.poll(async () => Number(await authoringCanvas.getAttribute("data-camera-zoom"))).toBeGreaterThan(zoomBefore);
  await expect.poll(async () => Number(await actor200.getAttribute("data-world-scale"))).toBeGreaterThan(actorScaleBefore);
  await expect.poll(async () => Math.abs(
    Number(await actor200.getAttribute("data-world-scale")) - Number(await authoringCanvas.getAttribute("data-camera-zoom")),
  )).toBeLessThan(.01);
  await expect(page.locator("#zoom-value")).not.toHaveText("100%");
  await page.mouse.click(authoringBounds!.x + authoringBounds!.width / 2, authoringBounds!.y + authoringBounds!.height / 2);
  await expect(page.locator("#furniture-count")).toHaveText("1개");
  await expect(page.locator("#furniture-selection-toolbar")).toBeVisible();
  await expect.poll(async () => Number(await authoringCanvas.getAttribute("data-selected-editor-x"))).toBeGreaterThan(0);
  const placedSelectionX = Number(await authoringCanvas.getAttribute("data-selected-editor-x"));
  const placedSelectionY = Number(await authoringCanvas.getAttribute("data-selected-editor-y"));
  await page.getByRole("button", { name: "적용만 보기" }).click();
  await expect(page.locator('#furniture-list [data-furniture-prop-id]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.locator('#furniture-list [data-furniture-prop-id]').click();
  await expect(page.locator("#furniture-selection-toolbar")).toBeVisible();
  await expect(page.locator("#furniture-status")).toContainText("배치 목록에서 가구를 선택했습니다");
  await page.getByRole("button", { name: "전체 보기" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#furniture-selection-toolbar")).toBeHidden();
  await page.mouse.click(authoringBounds!.x + placedSelectionX, authoringBounds!.y + placedSelectionY);
  await expect(page.locator("#furniture-selection-toolbar")).toBeVisible();
  await expect(page.locator("#furniture-status")).toContainText("가구를 선택했습니다");
  const placedMapId = await mapSelect.inputValue();
  const selectedFurnitureName = await page.locator("#furniture-selection-name").innerText();
  expect(selectedFurnitureName.trim().length).toBeGreaterThan(0);

  // 옵션 탭에서도 좌클릭 선택은 이름표+RPG 금색 마스크, 우클릭은 전체 조작 메뉴를 연다.
  await page.getByRole("button", { name: "옵션", exact: true }).click();
  await expect(page.locator("#game-stage")).toHaveAttribute("data-selected-furniture-mode", "name");
  await expect(page.locator("#furniture-selection-toolbar")).toHaveClass(/is-name-only/);
  await expect(authoringCanvas).toHaveAttribute("data-selected-editor-mask", "rpg-gold");
  const optionClickX = Number(await authoringCanvas.getAttribute("data-selected-editor-x"));
  const optionClickY = Number(await authoringCanvas.getAttribute("data-selected-editor-y"));
  await page.mouse.click(authoringBounds!.x + optionClickX, authoringBounds!.y + optionClickY);
  await expect(page.locator("#game-stage")).toHaveAttribute("data-selected-furniture-mode", "name");
  await expect(page.locator("#furniture-selection-name")).toHaveText(selectedFurnitureName);
  await expect(page.locator("#furniture-status")).toContainText("L 키로 가까운 벽");
  await page.keyboard.press("KeyL");
  await expect(page.locator("#furniture-selection-toolbar")).toHaveClass(/is-wall-snap/);
  await expect.poll(async () => Number(await authoringCanvas.getAttribute("data-selected-editor-x"))).toBeGreaterThan(0);
  await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>("#game-stage");
    stage?.addEventListener("contextmenu", (event) => {
      stage.dataset.lastContextMenuPrevented = String(event.defaultPrevented);
    }, { once: true });
  });
  // 선택 이름표가 가구를 덮고 있어도 브라우저 메뉴 대신 현재 선택 제품의 RPG 조작 메뉴가 열린다.
  await page.locator("#furniture-selection-toolbar").click({ button: "right" });
  await expect(page.locator("#game-stage")).toHaveAttribute("data-last-context-menu-prevented", "true");
  await expect(page.locator("#game-stage")).toHaveAttribute("data-selected-furniture-mode", "menu");
  await expect(page.locator("#furniture-selection-toolbar")).not.toHaveClass(/is-name-only/);
  await expect(page.getByRole("button", { name: "가구 벽 자석" })).toBeVisible();
  await page.keyboard.press("KeyL");
  await page.getByRole("button", { name: "가구 배치", exact: true }).click();

  await page.keyboard.down("Shift");
  await page.mouse.move(authoringBounds!.x + placedSelectionX, authoringBounds!.y + placedSelectionY);
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Shift");
  expect(await page.evaluate((mapId) => JSON.parse(localStorage.getItem(`bunfirvil:layout:v1:${mapId}`) || '{}').props?.[0]?.yawDeg, placedMapId)).toBe(270);
  await page.getByRole("button", { name: "화면 가구 오른쪽 90도 회전" }).click();
  expect(await page.evaluate((mapId) => JSON.parse(localStorage.getItem(`bunfirvil:layout:v1:${mapId}`) || '{}').props?.[0]?.yawDeg, placedMapId)).toBe(0);
  const mainSelectionX = Number(await authoringCanvas.getAttribute("data-selected-editor-x"));
  const mainSelectionY = Number(await authoringCanvas.getAttribute("data-selected-editor-y"));
  const beforeMainDrag = await page.evaluate((mapId) => JSON.stringify(JSON.parse(localStorage.getItem(`bunfirvil:layout:v1:${mapId}`) || '{}').props?.[0]?.positionMeters), placedMapId);
  const beforeFurniturePan = Number(await authoringCanvas.getAttribute('data-pan-count') || 0);
  await page.mouse.move(authoringBounds!.x + mainSelectionX, authoringBounds!.y + mainSelectionY);
  await page.mouse.down();
  await page.mouse.move(authoringBounds!.x + mainSelectionX + 24, authoringBounds!.y + mainSelectionY, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await authoringCanvas.getAttribute('data-pan-count') || 0)).toBeGreaterThan(beforeFurniturePan);
  expect(await page.evaluate((mapId) => JSON.stringify(JSON.parse(localStorage.getItem(`bunfirvil:layout:v1:${mapId}`) || '{}').props?.[0]?.positionMeters), placedMapId)).toBe(beforeMainDrag);
  const beforeRelocate = await page.evaluate((mapId) => JSON.stringify(JSON.parse(localStorage.getItem(`bunfirvil:layout:v1:${mapId}`) || '{}').props?.[0]?.positionMeters), placedMapId);
  await page.getByRole("button", { name: "가구 재배치" }).click();
  await page.mouse.click(authoringBounds!.x + authoringBounds!.width * .61, authoringBounds!.y + authoringBounds!.height * .56);
  await expect.poll(async () => page.evaluate((mapId) => JSON.stringify(JSON.parse(localStorage.getItem(`bunfirvil:layout:v1:${mapId}`) || '{}').props?.[0]?.positionMeters), placedMapId)).not.toBe(beforeRelocate);
  await page.keyboard.press("Delete");
  await expect(page.locator("#furniture-count")).toHaveText("0개");
  await furnitureCards.first().click();
  await page.mouse.click(authoringBounds!.x + authoringBounds!.width / 2, authoringBounds!.y + authoringBounds!.height / 2);
  await expect(page.locator("#furniture-count")).toHaveText("1개");

  await page.reload();
  await expect(page.locator("#stage-loader")).toBeHidden();
  await expect(page.getByLabel("검수맵 선택")).toHaveValue(savedMapId);
  await expect(page.locator(`#option-list input[data-option-id="${firstOptionId}"]`)).toBeChecked();
  await expect(page.locator("#option-total")).toHaveText(savedQuote);
  await expect(page.locator('#hotbar [data-slot="3"]')).toHaveAttribute("data-skill-id", "basic-attack");

  await page.goto("guides/?guide=b-option");
  await expect(page.locator("body")).toHaveAttribute("data-guide-id", "b-option");
  await expect(page.locator("#guideTitle")).toHaveText("옵션 가이드");
  await expect(page.locator("#markdownBody")).toContainText("시스템 에어컨");
  await expect(page.locator("#markdownBody table")).toHaveCount(1);
  await expect(page.locator("#markdownSource")).toContainText("# 옵션 팔레트 사용법");
  await expect(page.getByRole("link", { name: "GitHub에서 Markdown 수정" })).toHaveAttribute("href", /src\/guides\/content\/b-option\.md$/);

  expect(forbiddenRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("runs the map review, interior editor, and JSON workflow", async ({ page }) => {
  const forbiddenRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/^wss?:/i.test(url) || /socket\.io/i.test(url) || new URL(url).pathname.includes("/api/")) {
      forbiddenRequests.push(url);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("manage/");
  await expect(page.locator("#loadingState")).toBeHidden();
  await expect(page.locator("#errorState")).toBeHidden();
  await expect(page.locator(".map-card")).toHaveCount(4);
  await expect(page.locator(".map-card img").first()).toBeVisible();
  expect(await page.locator(".map-card img").first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator("#interiorEditor")).toHaveAttribute("data-loading", "false");
  await expect.poll(async () => page.locator("#editorAssetList .editor-asset").count()).toBeGreaterThan(30);
  const editorPreview = page.locator("#editorAssetList .editor-asset img").first();
  await expect(editorPreview).toBeVisible();
  expect(await editorPreview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByLabel('평면 A B형 선택').selectOption('B');
  await expect(page.locator('#interiorEditor')).toHaveAttribute('data-loading', 'false');
  await expect(page.locator('#interiorEditor')).toHaveAttribute('data-plan-variant', 'B');
  await expect(page.locator('#editorPlanCanvas')).toHaveAttribute('data-plan-variant', 'B');
  await expect(page.locator('#editorThreeCanvas')).toHaveAttribute('data-plan-variant', 'B');
  await page.locator("#editorAssetList .editor-asset").first().click();
  await expect(page.locator("#interiorEditor")).toHaveAttribute("data-local-prop-count", "1");
  await expect(page.locator("#editorPlanCanvas")).toHaveAttribute("data-local-prop-count", "1");
  await expect.poll(async () => Number(await page.locator("#editorThreeCanvas").getAttribute("data-apartment-prop-count"))).toBeGreaterThan(0);
  await page.getByRole("button", { name: "+90°" }).click();
  await page.getByRole("button", { name: "⇆ 좌우 반전" }).click();
  const editorMapId = await page.locator("#editorMapSelect").inputValue();
  expect(await page.evaluate((mapId) => JSON.parse(localStorage.getItem(`bunfirvil:layout:v1:${mapId}`) || '{}').props?.[0]?.yawDeg, editorMapId)).toBe(90);
  const editorCanvas = page.locator("#editorThreeCanvas");
  await expect(editorCanvas).toHaveAttribute("data-selected-editor-prop-id", /local-/);
  const editorBounds = await editorCanvas.boundingBox();
  expect(editorBounds).not.toBeNull();
  const selectedX = Number(await editorCanvas.getAttribute("data-selected-editor-x"));
  const selectedY = Number(await editorCanvas.getAttribute("data-selected-editor-y"));
  const beforeEditorDrag = await page.evaluate((mapId) => JSON.stringify(JSON.parse(localStorage.getItem(`bunfirvil:layout:v1:${mapId}`) || '{}').props?.[0]?.positionMeters), editorMapId);
  await page.mouse.move(editorBounds!.x + selectedX, editorBounds!.y + selectedY);
  await page.mouse.down();
  await page.mouse.move(editorBounds!.x + selectedX + 20, editorBounds!.y + selectedY + 4, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate((mapId) => JSON.stringify(JSON.parse(localStorage.getItem(`bunfirvil:layout:v1:${mapId}`) || '{}').props?.[0]?.positionMeters), editorMapId)).not.toBe(beforeEditorDrag);

  const map55b = page.locator(".map-card").filter({ hasText: "55B 세대 검증" });
  await map55b.getByLabel("검수 상태").selectOption("pass");
  await map55b.getByLabel("검수 메모").fill("정적 렌더링 확인 완료");
  await page.reload();
  await expect(page.locator("#loadingState")).toBeHidden();
  const restored55b = page.locator(".map-card").filter({ hasText: "55B 세대 검증" });
  await expect(restored55b.getByLabel("검수 상태")).toHaveValue("pass");
  await expect(restored55b.getByLabel("검수 메모")).toHaveValue("정적 렌더링 확인 완료");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "전체 JSON 내보내기" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^bunfirvil-reviews-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const exportedBundle = JSON.parse(await readFile(downloadedPath!, "utf8"));
  expect(exportedBundle.schemaVersion).toBe(1);
  expect(exportedBundle.reviews).toHaveLength(4);
  expect(exportedBundle.reviews).toEqual(expect.arrayContaining([
    expect.objectContaining({
      mapId: "bundang-first-village-55b-prototype",
      status: "pass",
      notes: "정적 렌더링 확인 완료",
    }),
  ]));

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "로컬 기록 초기화" }).click();
  for (const status of await page.getByLabel("검수 상태").all()) await expect(status).toHaveValue("unreviewed");
  for (const notes of await page.getByLabel("검수 메모").all()) await expect(notes).toHaveValue("");
  await expect(page.locator("#passCount")).toHaveText("0");

  const importPayload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    reviews: [{
      mapId: "bundang-first-village-55b-prototype",
      status: "pass",
      notes: "JSON 복원 확인",
      selectedOptionIds: [],
      updatedAt: new Date().toISOString(),
    }],
  };
  await page.locator("#importFile").setInputFiles({
    name: "reviews.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importPayload)),
  });
  await expect(page.locator("#messageRegion")).toContainText("1개 맵의 검수자료를 가져왔습니다");
  const imported55b = page.locator(".map-card").filter({ hasText: "55B 세대 검증" });
  await expect(imported55b.getByLabel("검수 상태")).toHaveValue("pass");
  await expect(imported55b.getByLabel("검수 메모")).toHaveValue("JSON 복원 확인");

  expect(forbiddenRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("loads the standalone building and interior administrators", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto("building-admin/");
  await expect(page.getByRole('heading', { name: '분퍼빌 건축물 관리자' })).toBeVisible();
  await expect(page.locator('#buildingPlanCanvas')).toHaveAttribute('data-plan-ready', 'true');
  await expect.poll(async () => Number(await page.locator('#buildingPlanCanvas').getAttribute('data-structure-count'))).toBeGreaterThan(20);
  await expect.poll(async () => page.locator('#buildingTree [data-structure-key]').count()).toBeGreaterThan(20);
  await page.locator('#buildingPlanVariant').selectOption('B');
  await expect(page.locator('#buildingStatus')).toContainText('B형');
  await page.locator('#buildingTree [data-structure-key^="wall:"]').first().click();
  await expect(page.locator('#buildingInspector')).toContainText('WALL');
  await page.locator('#buildingReviewStatus').selectOption('pass');
  await page.locator('#buildingNotes').fill('건축 구조 검수 확인');
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('bunfirvil:building-admin:v1:')))).toBe(true);

  await page.goto("interior-admin/");
  await expect(page.getByRole('heading', { name: '분퍼빌 인테리어 관리자' })).toBeVisible();
  await expect(page.locator('#interiorEditor')).toHaveAttribute('data-loading', 'false');
  await expect.poll(async () => page.locator('#editorAssetList .editor-asset').count()).toBeGreaterThan(30);
  await expect(page.locator('#editorAssetList .editor-asset img').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-interior-admin-ready', 'true');
  expect(errors).toEqual([]);
});
