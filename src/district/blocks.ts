export interface DistrictBlockEntry {
  id: string;
  name: string;
  status: "available" | "planned";
  path: string | null;
}

export const DISTRICT_BLOCKS: readonly DistrictBlockEntry[] = [
  { id: "A1", name: "e편한세상 분당퍼스트빌리지", status: "available", path: "bunfirvil/" },
  { id: "A2", name: "서비스 준비 중", status: "planned", path: null },
];
