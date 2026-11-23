export type SiteFacilityKind = 'main-entrance' | 'sub-entrance' | 'recycling' | 'elevator' | 'stairs'
  | 'community' | 'guesthouse' | 'daycare' | 'kids-station' | 'senior' | 'security';

export interface SiteFacility {
  readonly id: string;
  readonly kind: SiteFacilityKind;
  readonly label: string;
  readonly x: number;
  readonly z: number;
  /** Optional explicit model height; ordinary markers use the rendered terrain or a facility roof. */
  readonly y?: number;
}

// Source: supplied 260707_단지배치도.pdf, page 4, left site-plan image, north rotated 90° clockwise.
// These are approximate diagram pixels, not surveyed coordinates. The same 989 × 1058 frame,
// [490, 540] origin and 0.52 m/pixel are used by art/site-preview/layout.v1.json and the v9 GLB.
// Centers come from the legend symbols and leader dots, not from the printed text baselines.
function at(id: string, kind: SiteFacilityKind, label: string, east: number, south: number): SiteFacility {
  return { id, kind, label, x: (east - 490) * 0.52, z: (south - 540) * 0.52 };
}

export const SITE_FACILITIES: readonly SiteFacility[] = [
  // The triangles sit outside the property line in the PDF. Anchor the labels at the matching modeled drive approaches.
  at('main-101', 'main-entrance', '주출입구', 715.4, 925.7),
  at('main-110', 'main-entrance', '주출입구', 354, 266.3),
  at('sub-105', 'sub-entrance', '부출입구', 630, 543.7),
  at('sub-109', 'sub-entrance', '부출입구', 446.4, 432.8),

  // The red residential pentagons only; the three gray-blue retail recycling symbols are a different category.
  at('recycling-106', 'recycling', '쓰레기 분리수거장', 686.5, 671.5),
  at('recycling-107-east', 'recycling', '쓰레기 분리수거장', 665.1, 753.8),
  at('recycling-107-park', 'recycling', '쓰레기 분리수거장', 651.3, 736.2),
  at('recycling-101-north', 'recycling', '쓰레기 분리수거장', 624.9, 869.9),
  at('recycling-101-south', 'recycling', '쓰레기 분리수거장', 607.3, 883.8),
  at('recycling-103', 'recycling', '쓰레기 분리수거장', 540.1, 745.6),
  at('recycling-104-north', 'recycling', '쓰레기 분리수거장', 523.1, 608.7),
  at('recycling-104-east', 'recycling', '쓰레기 분리수거장', 505.5, 625.1),
  at('recycling-112', 'recycling', '쓰레기 분리수거장', 390.5, 62.5),
  at('recycling-111', 'recycling', '쓰레기 분리수거장', 189.4, 53.7),
  at('recycling-110-north', 'recycling', '쓰레기 분리수거장', 239.1, 204.4),
  at('recycling-109', 'recycling', '쓰레기 분리수거장', 293.1, 349.4),

  at('elevator-101', 'elevator', '외부 E/V', 634.9, 903.2),
  at('elevator-community-1', 'elevator', '외부 E/V', 552.6, 666.5),
  at('elevator-community-2', 'elevator', '외부 E/V', 386.7, 480),
  at('elevator-110', 'elevator', '외부 E/V', 317.6, 208.8),
  at('elevator-t202', 'elevator', '외부 E/V', 293.7, 380.8),
  // These markers show printed symbols; they do not add stairs or attest to walkable connections in the model.
  at('stairs-106', 'stairs', '지하 출입 계단', 658.8, 641.4),
  at('stairs-111', 'stairs', '지하 출입 계단', 291.2, 121.5),
  at('stairs-t203', 'stairs', '지하 출입 계단', 216.5, 202.5),

  at('community-1', 'community', '커뮤니티센터 1 (B1)', 560.2, 648.3),
  at('community-2', 'community', '커뮤니티센터 2 (B1)', 366, 490.7),
  // The 112 B1 label is printed over the high-rise footprint. Keep it at grade just beside the same wing.
  at('guesthouse-112', 'guesthouse', '112동 게스트하우스 (B1)', 336, 104),
  // The center of the modeled 2F building puts the marker on the roof rather than its parapet or approach.
  at('daycare-104', 'daycare', '어린이집 (1·2F)', 428, 581),
  at('kids-station-101', 'kids-station', '키즈스테이션', 654.4, 921.4),
  at('kids-station-110', 'kids-station', '키즈스테이션', 326.4, 210),
  at('senior-102', 'senior', '시니어라운지', 511.8, 903.2),

  // Three guards are modeled as roofs; the fourth uses the plan location by the 109 ramp, not a nearby tower.
  at('security-101', 'security', '경비실', 706.2, 940.2),
  at('security-105', 'security', '경비실', 608, 531),
  at('security-109', 'security', '경비실', 457.1, 454.3),
  at('security-110', 'security', '경비실', 344.9, 276.1),
];
