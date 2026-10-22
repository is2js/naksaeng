import { describe, expect, it } from "vitest";
import { DISTRICT_BLOCKS } from "./blocks";

describe("낙생지구 단지 포털", () => {
  it("A1은 기존 앱으로 연결하고 준비 중 단지는 이동 경로를 제공하지 않는다", () => {
    expect(DISTRICT_BLOCKS).toEqual([
      { id: "A1", name: "e편한세상 분당퍼스트빌리지", status: "available", path: "bunfirvil/" },
      { id: "A2", name: "서비스 준비 중", status: "planned", path: null },
    ]);
    expect(new Set(DISTRICT_BLOCKS.map((block) => block.id)).size).toBe(DISTRICT_BLOCKS.length);
    for (const block of DISTRICT_BLOCKS) {
      if (block.path) expect(block.path).toMatch(/^[a-z0-9-]+\/$/);
      if (block.status === "planned") expect(block.path).toBeNull();
    }
  });
});
