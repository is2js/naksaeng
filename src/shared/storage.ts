import {
  MAP_IDS,
  type BOptionEntryV1,
  type LocalReviewBundleV1,
  type LocalReviewV1,
  type MapId,
  type ReviewStatus,
} from "./contracts";
import { clearSaleCalculatorPreferences } from "../game/sale-calculator-preferences";

export const REVIEW_KEY_PREFIX = "bunfirvil:review:v1:";
export const LAYOUT_KEY_PREFIX = "bunfirvil:layout:v1:";
export const BUILDING_ADMIN_KEY_PREFIX = "bunfirvil:building-admin:v1:";
export const HOTBAR_KEY = "bunfirvil:hotbar:v1";
const STATUSES = new Set<ReviewStatus>(["unreviewed", "pass", "needs-work"]);

export function emptyReview(mapId: MapId): LocalReviewV1 {
  return {
    mapId,
    status: "unreviewed",
    notes: "",
    selectedOptionIds: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function loadReview(mapId: MapId): LocalReviewV1 {
  try {
    const raw = localStorage.getItem(`${REVIEW_KEY_PREFIX}${mapId}`);
    if (!raw) return emptyReview(mapId);
    return validateReview(JSON.parse(raw), mapId, []);
  } catch {
    return emptyReview(mapId);
  }
}

export function saveReview(review: LocalReviewV1): void {
  localStorage.setItem(`${REVIEW_KEY_PREFIX}${review.mapId}`, JSON.stringify(review));
}

export interface StorageResetResult {
  removedKeys: string[];
  updatedKeys: string[];
}

export function resetCurrentMapOptionsAndLayout(
  mapId: string,
  storage: Storage = localStorage,
  now = new Date(),
): StorageResetResult {
  const reviewKey = `${REVIEW_KEY_PREFIX}${mapId}`;
  const layoutKey = `${LAYOUT_KEY_PREFIX}${mapId}`;
  const removedKeys: string[] = [];
  const updatedKeys: string[] = [];
  const rawReview = storage.getItem(reviewKey);
  if (rawReview) {
    try {
      const review = JSON.parse(rawReview) as Record<string, unknown>;
      if (review && typeof review === "object" && !Array.isArray(review)) {
        storage.setItem(reviewKey, JSON.stringify({
          ...review,
          selectedOptionIds: [],
          updatedAt: now.toISOString(),
        }));
        updatedKeys.push(reviewKey);
      } else {
        storage.removeItem(reviewKey);
        removedKeys.push(reviewKey);
      }
    } catch {
      storage.removeItem(reviewKey);
      removedKeys.push(reviewKey);
    }
  }
  if (storage.getItem(layoutKey) !== null) {
    storage.removeItem(layoutKey);
    removedKeys.push(layoutKey);
  }
  return { removedKeys, updatedKeys };
}

export function isBunfirvilStorageKey(key: string): boolean {
  return key === HOTBAR_KEY
    || key.startsWith(REVIEW_KEY_PREFIX)
    || key.startsWith(LAYOUT_KEY_PREFIX)
    || key.startsWith(BUILDING_ADMIN_KEY_PREFIX);
}

export function resetAllBunfirvilLocalData(storage: Storage = localStorage, session?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): StorageResetResult {
  const targets: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isBunfirvilStorageKey(key)) targets.push(key);
  }
  targets.forEach((key) => storage.removeItem(key));
  clearSaleCalculatorPreferences(session);
  return { removedKeys: targets, updatedKeys: [] };
}

export function validateReview(
  value: unknown,
  expectedMapId: MapId | undefined,
  options: BOptionEntryV1[],
): LocalReviewV1 {
  if (!value || typeof value !== "object") throw new Error("검수 항목 형식이 잘못되었습니다.");
  const row = value as Partial<LocalReviewV1>;
  if (!MAP_IDS.includes(row.mapId as MapId)) throw new Error("알 수 없는 맵 ID입니다.");
  if (expectedMapId && row.mapId !== expectedMapId) throw new Error("맵 ID가 저장 위치와 다릅니다.");
  if (!STATUSES.has(row.status as ReviewStatus)) throw new Error("알 수 없는 검수 상태입니다.");
  if (typeof row.notes !== "string" || row.notes.length > 10_000) throw new Error("메모가 너무 길거나 잘못되었습니다.");
  if (!Array.isArray(row.selectedOptionIds) || !row.selectedOptionIds.every((id) => typeof id === "string")) {
    throw new Error("옵션 목록이 잘못되었습니다.");
  }
  const selected = [...new Set(row.selectedOptionIds)];
  if (options.length) {
    const byId = new Map(options.map((option) => [option.id, option]));
    for (const id of selected) {
      const option = byId.get(id);
      if (!option) throw new Error(`허용되지 않은 옵션입니다: ${id}`);
      if (option.requires.some((required) => !selected.includes(required))) {
        throw new Error(`${option.label}의 필수 옵션이 선택되지 않았습니다.`);
      }
      const requiresAny = option.requiresAny ?? [];
      if (requiresAny.length > 0 && !requiresAny.some((required) => selected.includes(required))) {
        throw new Error(`${option.label}에 필요한 대체 옵션이 선택되지 않았습니다.`);
      }
      if (option.excludes.some((excluded) => selected.includes(excluded))) {
        throw new Error(`${option.label}과 함께 선택할 수 없는 옵션이 있습니다.`);
      }
    }
  }
  return {
    mapId: row.mapId as MapId,
    status: row.status as ReviewStatus,
    notes: row.notes,
    selectedOptionIds: selected,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
  };
}

export function validateReviewBundle(value: unknown, options: BOptionEntryV1[]): LocalReviewBundleV1 {
  if (!value || typeof value !== "object") throw new Error("검수 bundle이 JSON 객체가 아닙니다.");
  const bundle = value as Partial<LocalReviewBundleV1>;
  if (bundle.schemaVersion !== 1 || !Array.isArray(bundle.reviews)) {
    throw new Error("지원하지 않는 검수 bundle입니다.");
  }
  const reviews = bundle.reviews.map((review) => validateReview(review, undefined, options));
  if (new Set(reviews.map((review) => review.mapId)).size !== reviews.length) {
    throw new Error("같은 맵의 검수 항목이 중복되었습니다.");
  }
  return {
    schemaVersion: 1,
    exportedAt: typeof bundle.exportedAt === "string" ? bundle.exportedAt : new Date().toISOString(),
    reviews,
  };
}
