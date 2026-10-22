import { describe, expect, it } from "vitest";
import type { BOptionEntryV1 } from "./contracts";
import { SALE_CALCULATOR_PREFERENCES_SESSION_KEY } from "../game/sale-calculator-preferences";
import {
  BUILDING_ADMIN_KEY_PREFIX,
  HOTBAR_KEY,
  LAYOUT_KEY_PREFIX,
  REVIEW_KEY_PREFIX,
  resetAllBunfirvilLocalData,
  resetCurrentMapOptionsAndLayout,
  validateReviewBundle,
} from "./storage";

const options: BOptionEntryV1[] = [
  {
    id: "base",
    label: "기본 마감",
    category: "마감",
    price: 0,
    description: "",
    compatibleUnitTypes: ["51A"],
    requires: [],
    excludes: [],
  },
  {
    id: "upgrade",
    label: "마감 업그레이드",
    category: "마감",
    price: 100,
    description: "",
    compatibleUnitTypes: ["51A"],
    requires: ["base"],
    excludes: [],
  },
];

describe("validateReviewBundle", () => {
  it("deduplicates selected options and keeps valid local review data", () => {
    const bundle = validateReviewBundle({
      schemaVersion: 1,
      exportedAt: "2026-08-27T00:00:00.000Z",
      reviews: [{
        mapId: "bundang-first-village-51a-prototype",
        status: "pass",
        notes: "확인",
        selectedOptionIds: ["base", "upgrade", "base"],
        updatedAt: "2026-08-27T00:00:00.000Z",
      }],
    }, options);
    expect(bundle.reviews[0]?.selectedOptionIds).toEqual(["base", "upgrade"]);
  });

  it("rejects a selection whose dependency is missing", () => {
    expect(() => validateReviewBundle({
      schemaVersion: 1,
      reviews: [{
        mapId: "bundang-first-village-51a-prototype",
        status: "unreviewed",
        notes: "",
        selectedOptionIds: ["upgrade"],
      }],
    }, options)).toThrow(/필수 옵션/);
  });
});

function memoryStorage(entries: Record<string, string>): Storage {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("Bunfirvil local storage reset", () => {
  const mapId = "bundang-first-village-51a-prototype";

  it("clears only current-map options and layout while preserving review and other scopes", () => {
    const reviewKey = `${REVIEW_KEY_PREFIX}${mapId}`;
    const storage = memoryStorage({
      [reviewKey]: JSON.stringify({
        mapId,
        status: "pass",
        notes: "보존할 메모",
        selectedOptionIds: ["base"],
        updatedAt: "2026-08-27T00:00:00.000Z",
      }),
      [`${LAYOUT_KEY_PREFIX}${mapId}`]: JSON.stringify({ props: [{ id: "chair" }] }),
      [`${BUILDING_ADMIN_KEY_PREFIX}${mapId}:A`]: "building-review",
      [HOTBAR_KEY]: "hotbar",
    });

    resetCurrentMapOptionsAndLayout(mapId, storage, new Date("2026-09-02T00:00:00.000Z"));

    expect(JSON.parse(storage.getItem(reviewKey) || "{}")).toMatchObject({
      status: "pass",
      notes: "보존할 메모",
      selectedOptionIds: [],
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(storage.getItem(`${LAYOUT_KEY_PREFIX}${mapId}`)).toBeNull();
    expect(storage.getItem(`${BUILDING_ADMIN_KEY_PREFIX}${mapId}:A`)).toBe("building-review");
    expect(storage.getItem(HOTBAR_KEY)).toBe("hotbar");
  });

  it("removes only Bunfirvil keys during the full reset", () => {
    const storage = memoryStorage({
      [`${REVIEW_KEY_PREFIX}${mapId}`]: "review",
      [`${LAYOUT_KEY_PREFIX}${mapId}`]: "layout",
      [`${BUILDING_ADMIN_KEY_PREFIX}${mapId}:B`]: "building-review",
      [HOTBAR_KEY]: "hotbar",
      "another-pages-project:state": "keep",
    });

    const session = memoryStorage({
      [SALE_CALCULATOR_PREFERENCES_SESSION_KEY]: "scenario",
      "bunfirvil:household-verification:v1": "authentication",
      "another-pages-project:session": "keep-session",
    });
    const result = resetAllBunfirvilLocalData(storage, session);

    expect(result.removedKeys).toHaveLength(4);
    expect(storage.getItem("another-pages-project:state")).toBe("keep");
    expect(storage.length).toBe(1);
    expect(session.getItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY)).toBeNull();
    expect(session.getItem("bunfirvil:household-verification:v1")).toBe("authentication");
    expect(session.getItem("another-pages-project:session")).toBe("keep-session");
  });
});
