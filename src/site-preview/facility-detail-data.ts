import { DAYCARE_CUTAWAY_YAW_DEGREES } from './facility-daycare-placement';

export type FacilityDetailId = 'community-1' | 'community-2' | 'daycare-104';
export type FacilityFloorId = 'b1' | '1f' | '2f';
export type FacilityPoint = readonly [x: number, z: number];
export type FacilityRoomKind = 'program' | 'service' | 'circulation' | 'outdoor';

export interface FacilityRoom {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly polygon: readonly FacilityPoint[];
  readonly center: FacilityPoint;
  readonly kind: FacilityRoomKind;
  /** A subdivision shares this room's printed caption and selection. */
  readonly labelGroup?: string;
}

export interface FacilityWall {
  readonly id: string;
  readonly start: FacilityPoint;
  readonly end: FacilityPoint;
  readonly thickness: number;
  readonly exterior?: boolean;
}

export interface FacilityOpening {
  readonly id: string;
  readonly wallId: string;
  readonly start: FacilityPoint;
  readonly end: FacilityPoint;
  readonly kind: 'door' | 'passage' | 'window';
}

export interface FacilityFloor {
  readonly id: FacilityFloorId;
  readonly label: string;
  readonly outline: readonly FacilityPoint[];
  readonly rooms: readonly FacilityRoom[];
  readonly walls: readonly FacilityWall[];
  readonly openings: readonly FacilityOpening[];
}

export interface FacilityDetailPlan {
  readonly id: FacilityDetailId;
  readonly label: string;
  readonly description: string;
  readonly sourceNote: string;
  readonly floors: readonly FacilityFloor[];
}

type DraftRoom = FacilityRoom;
type DraftOpening = readonly [from: number, to: number, kind: FacilityOpening['kind']];
type DraftWall = readonly [start: FacilityPoint, end: FacilityPoint, openings?: readonly DraftOpening[]];
type OutlineRun = { readonly segment: number; readonly openings: readonly DraftOpening[] };

const rectangular = (left: number, top: number, right: number, bottom: number): readonly FacilityPoint[] => [
  [left, top], [right, top], [right, bottom], [left, bottom],
];

function room(id: string, label: string, kind: FacilityRoomKind, description: string,
  shape: readonly [number, number, number, number] | readonly FacilityPoint[], at?: FacilityPoint): DraftRoom {
  if (typeof shape[0] === 'number') {
    const [left, top, right, bottom] = shape as readonly [number, number, number, number];
    return { id, label, kind, description, polygon: rectangular(left, top, right, bottom), center: at ?? [(left + right) / 2, (top + bottom) / 2] };
  }
  if (!at) throw new Error(`Missing interior anchor: ${id}`);
  return { id, label, kind, description, polygon: shape as readonly FacilityPoint[], center: at };
}

const door = (from: number, to: number): DraftOpening => [from, to, 'door'];
const gap = (from: number, to: number): DraftOpening => [from, to, 'passage'];
const win = (from: number, to: number): DraftOpening => [from, to, 'window'];

// Source: 260707_단지배치도.pdf, p.5 exploded views, rectified along their two wall axes.
// Private drafting coordinates below follow the rectified wall strokes, not the page text.
// Scale is proportional to the p.4/site-model footprint (there is no room dimension schedule).
// Rotation to +X east / +Z south is applied HERE once; renderers use north = -Z directly.
function makeFloor(id: FacilityFloorId, label: string, origin: FacilityPoint, scale: FacilityPoint, degrees: number,
  outline: readonly FacilityPoint[], rooms: readonly DraftRoom[], interior: readonly DraftWall[], outerOpenings: readonly OutlineRun[]): FacilityFloor {
  const angle = degrees * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  function toWorld([u, v]: FacilityPoint): FacilityPoint {
    const x = (u - origin[0]) * scale[0], z = (v - origin[1]) * scale[1];
    return [x * c - z * s, x * s + z * c];
  }
  function between(a: FacilityPoint, b: FacilityPoint, t: number): FacilityPoint {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  const outerSpecs: readonly DraftWall[] = outline.map((start, i) => [start, outline[(i + 1) % outline.length], outerOpenings.find((row) => row.segment === i)?.openings]);
  const walls: FacilityWall[] = [];
  const openings: FacilityOpening[] = [];
  for (const [index, [start, end, apertures]] of [...outerSpecs, ...interior].entries()) {
    const exterior = index < outerSpecs.length;
    const wallId = `${id}-wall-${index + 1}`;
    const a = toWorld(start), b = toWorld(end);
    walls.push({ id: wallId, start: a, end: b, exterior, thickness: exterior ? .24 : .15 });
    apertures?.forEach(([from, to, kind], openingIndex) => openings.push({
      id: `${wallId}-opening-${openingIndex + 1}`, wallId, start: between(a, b, from), end: between(a, b, to), kind,
    }));
  }
  return { id, label, outline: outline.map(toWorld), rooms: rooms.map((r) => ({ ...r, polygon: r.polygon.map(toWorld), center: toWorld(r.center) })), walls, openings };
}

// The p.5 upper-left cutaway has two perpendicular wings. Fit the long
// fitness/library wing towards the NE from the SW cap; the golf/office wing
// then runs SE from the corner, as in the p.4 footprint and p.5 location key.
// The drawing breaks between golf and offices; retain the connecting strip
// shown on the site outline without assigning it an unprinted room program.
const communityOneOutline: readonly FacilityPoint[] = [
  [0,-8],[32,-8],[32,0],[424,0],[424,14],[453,14],[453,-8],[970,-8],
  [982,266],[973,282],[996,282],[996,497],[985,517],[810,517],[798,510],
  [792,282],[804,266],[790,266],[790,135],[490,135],[490,142],[55,142],
  [27,139],[10,129],[0,113],
];

const communityOneRooms: readonly DraftRoom[] = [
  room('fitness','피트니스','program','긴 날개 끝의 체력단련 공간입니다. 안내도에는 운동기구 구역과 유리 입면 쪽 운동 구역이 이어져 있습니다.',
    [[0,0],[198,0],[198,61],[245,61],[245,133],[60,133],[30,131],[15,124],[9,112],[0,109]],[136,94]),
  room('group-exercise','G.X룸','program','피트니스 안쪽에 접한 그룹 운동 공간입니다.',[198,0,323,61]),
  room('body-check','바디체크룸','program','피트니스와 인포메이션 사이, 유리 입면 쪽의 체력 측정 공간입니다.',[248,88,307,137]),
  room('information','인포메이션','program','운동 시설과 커뮤니티라운지를 잇는 안내 공간입니다.',[349,22,425,84]),
  room('community-lounge','커뮤니티라운지','program','인포메이션과 라운지카페 사이에 접한 휴게 공간입니다.',[374,84,452,137]),
  room('lockers','라커룸','service','긴 연결 복도 안쪽에 표시된 라커룸입니다.',[453,-8,535,40]),
  room('wc-long-wing','화장실','service','라커룸과 샤워룸 사이의 공용 화장실입니다.',[535,-8,612,40]),
  room('lounge-library','라운지카페(작은도서관)','program','긴 날개의 유리 입면을 따라 테이블과 작은도서관이 이어지는 공간입니다.',[492,59,730,135]),
  room('showers','샤워룸(남/여)','service','화장실 이후, 골프 시설 쪽까지 이어지는 샤워 공간입니다.',[612,-8,871,40]),
  room('screen-golf','스크린골프룸','program','두 날개가 꺾이는 끝의 스크린골프 공간입니다.',[871,-8,970,47]),
  room('mini-gym','미니짐','program','작은도서관과 실내골프연습장 사이의 소규모 운동 공간입니다.',[730,58,790,135]),
  room('indoor-driving-range','실내골프연습장','program','꺾인 날개의 안쪽에 연습 타석이 길게 이어지는 공간입니다.',
    [[854,47],[970,47],[982,266],[804,266],[804,204],[854,204]],[914,155]),
  room('meeting','멀티룸(주민회의실)','program','골프 구역을 지난 날개 끝, 생활지원 구역 맞은편의 주민회의 공간입니다.',[898,331,996,373]),
  room('life-support','생활지원센터','service','날개 끝의 내측 면에 놓인 단지 생활지원 공간입니다.',[810,404,886,473]),
  room('housing-welfare','생애안심주거복지센터','service','생활지원센터와 같은 날개 안쪽에 이어지는 주거복지 공간입니다.',[798,306,886,391]),
  room('staff-break','근로자휴게실(남/여)','service','생활지원 구역 맨 끝에 표시된 근로자 휴게 공간입니다.',
    [[887,475],[994,475],[994,497],[985,517],[887,517]],[941,499]),
  room('wc-office-wing','화장실','service','주민회의실 위쪽에 별도로 표시된 공용 화장실입니다.',[898,283,994,331]),
  room('long-passage','연결 복도','circulation','라커룸·샤워룸과 라운지카페 사이를 지나 골프 시설 쪽으로 이어지는 동선입니다.',[453,40,854,58]),
];

const communityOneWalls: readonly DraftWall[] = [
  [[198,0],[198,61]], [[198,61],[323,61],[door(.74,.93)]], [[323,0],[323,61]],
  [[248,88],[307,88],[door(.66,.91)]], [[248,88],[248,137]], [[307,88],[307,137]],
  [[307,109],[349,109]], [[349,22],[424,22],[door(.10,.30)]], [[349,22],[349,83],[gap(.57,.91)]],
  [[374,84],[452,84],[gap(.27,.77)]], [[374,84],[374,134]], [[452,84],[452,136]],
  [[453,14],[453,40]], [[453,40],[871,40],[door(.07,.11),door(.24,.28),door(.42,.46),door(.68,.72),door(.89,.93)]],
  [[535,-8],[535,40]], [[612,-8],[612,40]], [[674,-8],[674,40],[gap(.58,.89)]], [[783,-8],[783,40],[gap(.57,.86)]],
  [[871,-8],[871,40]], [[871,47],[970,47],[door(.12,.34)]],
  [[492,59],[790,59],[gap(.09,.23),gap(.48,.62),door(.87,.94)]], [[492,59],[492,135]], [[730,59],[730,135]],
  [[790,59],[790,135],[door(.22,.42)]], [[854,59],[854,204],[gap(.27,.55),gap(.73,.94)]],
  [[790,135],[854,135]], [[804,204],[854,204],[gap(.34,.77)]],
  [[804,266],[982,266],[gap(.24,.52)]],
  [[798,306],[886,306]], [[886,283],[886,474],[door(.19,.27),door(.65,.74)]],
  [[798,391],[886,391]], [[798,404],[886,404]], [[799,473],[887,473],[door(.70,.92)]],
  [[898,283],[898,459],[door(.19,.25),door(.37,.44),gap(.75,.86)]],
  [[898,331],[995,331]], [[898,373],[995,373]], [[898,397],[995,397]], [[898,442],[995,442]],
  [[887,475],[994,475],[door(.27,.42),door(.70,.84)]], [[887,475],[887,517]], [[937,475],[937,517]],
];

const communityOneFloor = makeFloor('b1','단층',[567,160],[.094,.121],-42,communityOneOutline,communityOneRooms,communityOneWalls,[
  { segment: 10, openings: [win(.18,.59)] },
  { segment: 12, openings: [win(.35,.58),win(.68,.86)] },
  { segment: 14, openings: [win(.11,.30),win(.46,.64),door(.76,.94)] },
  { segment: 19, openings: [win(.06,.16),win(.21,.33),win(.39,.51),win(.56,.69),win(.73,.83),win(.87,.95)] },
  { segment: 21, openings: [win(.05,.13),door(.20,.30),win(.35,.44),win(.67,.78),win(.84,.95)] },
]);

const communityOutline: readonly FacilityPoint[] = [
  [146,648],[210,648],[210,610],[492,610],[492,648],[557,648],[557,614],[624,614],
  [624,633],[864,633],[864,581],[925,581],[925,490],[934,490],[934,390],[1272,390],
  [1272,494],[1176,494],[1176,530],[1106,530],[1106,603],[1218,603],[1218,803],
  [817,803],[817,775],[796,775],[796,803],[621,803],[621,745],[559,745],
  [559,775],[245,775],[245,731],[146,731],
];

const communityRooms: readonly DraftRoom[] = [
  room('edu-lounge','에듀라운지','program','커뮤니티센터 Ⅱ의 북서쪽 끝에 있는 교육·교류 공간입니다.',[[146,674],[250,674],[250,706],[211,706],[211,731],[146,731]],[196,701]),
  room('wc-edu','화장실','service','도면에서 에듀라운지 가까이에 표시된 화장실입니다.',[210,610,321,674]),
  room('multi-room','멀티룸','program','에듀라운지와 같은 날개에 있는 다목적 활동 공간입니다.',[321,610,492,674]),
  room('private-office','프라이빗오피스룸','program','수변 쪽 긴 창을 따라 작은 업무 칸들이 배치된 공간입니다.',[318,706,559,775]),
  room('care-center','다함께돌봄센터','program','긴 동선 중앙의 돌봄 공간입니다. 큰 활동 공간과 안쪽 구획이 이어집니다.',[[559,698],[864,698],[864,723],[817,723],[817,775],[796,775],[796,803],[621,803],[621,745],[559,745]],[711,720]),
  { ...room('care-rooms','다함께돌봄센터','program','',[624,633,782,698]), labelGroup: 'care-center' },
  room('wc-care','화장실','service','중앙 돌봄 공간 옆에 표시된 화장실입니다.',[782,633,864,698]),
  room('side-room','연결부 부속 구획','service','꺾이는 복도에 접한 작은 구획입니다. 상세 용도는 원본에서 확인되지 않습니다.',[864,633,984,721]),
  room('kids-lab','키즈랩','program','키즈라운지와 나란히 있는 작은 활동 공간입니다.',[870,722,1018,803]),
  room('kids-lounge','키즈라운지(공동육아공간)','program','남동쪽 모서리의 공동육아 공간입니다. 큰 놀이기구가 도면에 표시되어 있습니다.',[[984,635],[1106,635],[1106,603],[1218,603],[1218,803],[1096,803],[1096,766],[1018,766],[1018,721],[984,721]],[1129,718]),
  room('sports-court','스포츠코트','program','긴 복도가 꺾여 들어가는 북동쪽 날개 끝의 실내 코트입니다.',[1018,390,1272,494]),
  room('wc-sports','화장실','service','스포츠코트 입구에 인접한 화장실입니다.',[934,390,1018,490]),
  room('wc-junction','화장실','service','스포츠코트로 이어지는 복도에 인접한 화장실입니다.',[925,490,1018,581]),
  room('main-hall','연결 복도','circulation','에듀라운지와 돌봄센터 쪽으로 이어지는 긴 동선입니다.',[250,674,553,706]),
  room('sports-hall','스포츠코트 연결 복도','circulation','코트와 키즈라운지를 잇는 꺾인 동선입니다.',[[1018,494],[1176,494],[1176,530],[1106,530],[1106,634],[984,634],[984,581],[1018,581]],[1068,555]),
];

const communityWalls: readonly DraftWall[] = [
  [[146,674],[321,674],[gap(.48,.64),door(.78,.92)]], [[321,610],[321,674]],
  [[321,674],[557,674],[door(.1,.21),door(.56,.66),gap(.86,.98)]],
  [[248,706],[559,706],[gap(.07,.19),door(.30,.37),door(.48,.55),door(.66,.73),door(.86,.93)]],
  [[318,706],[318,775]], [[377,706],[377,775]], [[437,706],[437,775]], [[497,706],[497,775]], [[559,706],[559,745],[gap(.14,.68)]],
  [[557,614],[557,674]], [[624,633],[624,698],[door(.76,.98)]], [[682,633],[682,698]], [[782,633],[782,698]],
  [[624,698],[864,698],[door(.09,.20),door(.40,.51),door(.83,.96)]], [[864,633],[864,721]],
  [[864,721],[1018,721],[gap(.13,.35),door(.70,.84)]], [[870,721],[870,803],[gap(.09,.31)]],
  [[1018,721],[1018,803],[gap(.28,.53)]], [[1018,766],[1096,766]], [[1096,766],[1096,803]],
  [[984,633],[1018,633],[gap(.15,.92)]], [[1018,581],[1106,581],[gap(.20,.74)]],
  [[925,581],[1018,581],[door(.64,.87)]], [[1018,390],[1018,581],[door(.31,.41),door(.73,.84)]],
  [[934,490],[1018,490],[door(.26,.53)]], [[1018,494],[1176,494],[door(.36,.57)]],
];

const communityFloor = makeFloor('b1','단층',[704,611],[.069,.080],47,communityOutline,communityRooms,communityWalls,[
  { segment: 15, openings: [win(.08,.31),win(.38,.58),win(.65,.90)] },
  { segment: 21, openings: [win(.10,.31),win(.39,.65),win(.72,.92)] },
  { segment: 22, openings: [win(.10,.28),win(.37,.51),win(.62,.83)] },
  { segment: 23, openings: [door(.19,.76)] }, { segment: 26, openings: [win(.12,.36),win(.49,.79)] },
  { segment: 30, openings: [win(.08,.21),win(.28,.40),win(.46,.58),win(.65,.77),win(.83,.93)] },
  { segment: 31, openings: [door(.17,.76)] }, { segment: 32, openings: [win(.10,.36),door(.53,.84)] },
]);

const childRoom = (id: string, shape: Parameters<typeof room>[4], at?: FacilityPoint) =>
  room(id, '보육실', 'program', '아이들이 돌봄과 놀이 활동을 하는 공간입니다. 연령·반 이름은 안내도에 표시되어 있지 않습니다.', shape, at);
const childWc = (id: string, a: number, b: number, c: number, d: number) =>
  room(id, '유아화장실', 'service', '보육실 가까이에 도면으로 구분된 어린이용 화장실입니다.', [a,b,c,d]);
const adultWc = (id: string, a: number, b: number, c: number, d: number) =>
  room(id, '화장실', 'service', '중앙 동선에 접한 공용 화장실입니다.', [a,b,c,d]);
const stair = (a: number, b: number, c: number, d: number) =>
  room('stairs', '계단', 'circulation', '절개 투시도에서 계단 단이 보이는 층간 동선입니다.', [a,b,c,d]);
const lift = (a: number, b: number, c: number, d: number) =>
  room('elevator', '승강기', 'circulation', '계단 옆의 수직 이동 코어로 판독한 구간입니다.', [a,b,c,d]);

// The same shaft/stair core aligns both storeys. Keep the diagonal building
// and the p.5 vestibule between the director's room and the first nursery.
// The playground-facing short front is the original recess between rooms,
// not a due-east cut across its corner. Exact porch/door dimensions are unknown.
const daycareVestibule = [[321,679],[401,679],[401,746],[321,746]] as const;
const daycareOneOutline: readonly FacilityPoint[] = [
  [243,657],[321,657],daycareVestibule[0],daycareVestibule[1],[401,660],[544,660],[544,1017],[595,1017],[595,1048],
  [591,1048],[591,1090],[698,1090],[698,1179],[521,1179],[521,1170],[243,1170],
];
const daycareOneRooms: readonly DraftRoom[] = [
  room('director','원장실','program','현관 바로 옆의 원장실입니다.',[243,657,321,732]),
  room('entry','어린이집 입구','circulation','동쪽 유아놀이터 쪽에서 들어와 중앙 복도로 이어지는 현관입니다.',daycareVestibule,[361,707]),
  room('hall-1','중앙 복도','circulation','현관에서 양편의 보육실과 계단, 식당으로 이어지는 공용 복도입니다.',[[243,732],[321,732],[321,746],[401,746],[401,1017],[544,1017],[544,1048],[294,1048],[294,1005],[359,1005],[359,798],[243,798]],[379,1009]),
  childRoom('nursery-west',[243,798,359,911]), childWc('child-wc-west',243,911,323,954), adultWc('adult-wc-west',323,911,359,954),
  stair(243,954,359,1005), lift(243,1005,294,1048),
  childRoom('nursery-ne',[[401,660],[544,660],[544,734],[439,734],[439,775],[401,775]],[468,699]),
  childWc('child-wc-ne',439,734,544,775), childRoom('nursery-east-2',[401,775,544,847]), childRoom('nursery-east-3',[401,847,544,914]),
  adultWc('adult-wc-east',401,914,463,956), childWc('child-wc-east',463,914,544,956), childRoom('nursery-east-4',[401,956,544,1017]),
  childRoom('nursery-sw',[243,1048,334,1170]), childWc('child-wc-sw',334,1086,384,1170), childRoom('nursery-se',[384,1048,459,1170]),
  room('dining','식당','program','조리실과 붙어 있는 식사 공간입니다.',[459,1048,521,1170],[492,1135]),
  room('kitchen','조리실','service','식당 옆으로 돌출된 별도 조리 공간입니다.',[[521,1048],[591,1048],[591,1090],[698,1090],[698,1179],[521,1179]],[611,1129]),
];
const daycareOneWalls: readonly DraftWall[] = [
  [[243,732],[321,732],[door(.66,.94)]], [daycareVestibule[0],[321,732]], [daycareVestibule[1],[401,775],[door(.45,.63)]],
  [[321,746],[401,746],[gap(.21,.79)]],
  [[243,798],[359,798]], [[359,798],[359,911],[door(.74,.90)]],
  [[243,911],[359,911],[door(.39,.57),door(.78,.94)]], [[323,911],[323,954]],
  [[243,954],[359,954]], [[359,911],[359,1005],[door(.11,.31),gap(.77,.97)]], [[243,1005],[359,1005]], [[294,1005],[294,1048],[door(.16,.75)]],
  [[401,775],[544,775],[door(.57,.70)]], [[439,734],[544,734],[door(.73,.87)]], [[439,734],[439,775]],
  [[401,775],[401,1017],[door(.17,.25),door(.39,.47),door(.62,.71),door(.89,.97)]],
  [[401,847],[544,847]], [[401,914],[544,914],[door(.59,.70)]], [[463,914],[463,956]], [[401,956],[544,956],[door(.69,.82)]], [[401,1017],[544,1017]],
  [[243,1048],[521,1048],[door(.24,.31),door(.53,.60),gap(.91,.98)]], [[334,1048],[334,1170],[door(.54,.70)]],
  [[334,1086],[384,1086]], [[384,1048],[384,1170],[door(.61,.75)]], [[459,1048],[459,1170]],
  [[521,1048],[521,1170],[door(.34,.49)]],
];

const daycareTwoOutline: readonly FacilityPoint[] = [
  [715,224],[1020,224],[1020,280],[1033,280],[1033,603],[947,603],[947,723],[730,723],[730,280],[715,280],
];
const daycareTwoRooms: readonly DraftRoom[] = [
  room('terrace','2층 외부 공간','outdoor','2층 투시도에서 난간으로 둘러싸인 외부 공간입니다. 개방·이용 여부는 원본에 명시되어 있지 않습니다.',[715,224,1020,280]),
  room('teachers','교사실','program','2층 외부 공간 인근의 교사실입니다.',[730,280,842,349]),
  room('hall-2','중앙 복도','circulation','계단·승강기에서 양편의 보육실과 교사실로 이어지는 공용 복도입니다.',[[842,280],[892,280],[892,570],[1033,570],[1033,603],[947,603],[947,596],[783,596],[783,553],[844,553],[844,349],[842,349]],[865,530]),
  childRoom('nursery-west',[730,349,844,461]), childWc('child-wc-west',730,461,809,504), adultWc('adult-wc-west',809,461,844,504),
  stair(730,504,844,553), lift(730,553,783,596),
  childRoom('nursery-ne',[892,324,1033,463]), adultWc('adult-wc-east',892,463,948,505), childWc('child-wc-east',948,463,1033,505),
  childRoom('nursery-east-middle',[892,505,1033,570]), childRoom('nursery-sw',[730,596,821,723]),
  childWc('child-wc-sw',821,636,871,723), childRoom('nursery-se',[871,596,947,723]),
];
const daycareTwoWalls: readonly DraftWall[] = [
  [[730,280],[1020,280],[win(.04,.31),door(.44,.54),win(.72,.94)]],
  [[842,280],[842,349],[door(.68,.90)]], [[730,349],[844,349]], [[844,349],[844,461],[door(.72,.91)]],
  [[730,461],[844,461],[door(.37,.56),door(.79,.96)]], [[809,461],[809,504]], [[730,504],[844,504]],
  [[844,461],[844,553],[door(.12,.29),gap(.73,.96)]], [[730,553],[844,553]], [[783,553],[783,596],[door(.15,.70)]],
  [[892,324],[1033,324]], [[892,280],[892,570],[door(.29,.36),door(.67,.73),door(.89,.96)]],
  [[892,463],[1033,463],[door(.64,.78)]], [[948,463],[948,505]], [[892,505],[1033,505],[door(.66,.80)]], [[892,570],[1033,570]],
  [[730,596],[947,596],[door(.32,.42),door(.66,.75)]], [[821,596],[821,723],[door(.57,.72)]],
  [[871,596],[871,723],[door(.62,.76)]], [[821,636],[871,636]],
];

const daycareOne = makeFloor('1f','1층',[397,913],[.052,.052],DAYCARE_CUTAWAY_YAW_DEGREES,daycareOneOutline,daycareOneRooms,daycareOneWalls,[
  { segment: 0, openings: [win(.14,.43),win(.58,.85)] }, { segment: 2, openings: [door(.25,.75)] },
  { segment: 4, openings: [win(.11,.29),win(.39,.57),win(.66,.86)] },
  { segment: 5, openings: [win(.05,.13),win(.22,.35),win(.40,.51),win(.55,.68),win(.85,.96)] },
  { segment: 12, openings: [win(.32,.47),win(.54,.73)] }, { segment: 14, openings: [win(.05,.14),win(.29,.47),win(.75,.94)] },
  { segment: 15, openings: [win(.05,.18),win(.21,.33),win(.59,.71),win(.75,.83),win(.87,.93)] },
]);
const daycareTwo = makeFloor('2f','2층',[885,466],[.052,.052],DAYCARE_CUTAWAY_YAW_DEGREES,daycareTwoOutline,daycareTwoRooms,daycareTwoWalls,[
  { segment: 3, openings: [win(.23,.33),win(.37,.47),win(.52,.57),win(.77,.86)] },
  { segment: 6, openings: [win(.17,.30),win(.72,.91)] },
  { segment: 7, openings: [win(.08,.17),win(.20,.30),win(.59,.68),win(.73,.83),win(.89,.95)] },
]);

const scaleDisclaimer = '공급안내문 5쪽의 절개 투시도를 바탕으로 벽과 공간을 다시 그린 참고용 모형입니다. 안내 이미지에 치수가 없어 비례를 사용했고, 세부 문과 가구 위치는 실제와 다를 수 있습니다.';

export const FACILITY_DETAIL_PLANS: Readonly<Record<FacilityDetailId, FacilityDetailPlan>> = {
  'community-1': {
    id: 'community-1', label: '커뮤니티센터 Ⅰ', floors: [communityOneFloor],
    description: '105·106동 앞에서 중앙공원을 감싸는 커뮤니티시설입니다. 피트니스와 작은도서관이 있는 긴 날개가 꺾여 골프연습장과 생활지원시설로 이어집니다.',
    sourceNote: `${scaleDisclaimer} 방향은 4쪽 붉은 영역과 5쪽 위치도에 맞췄습니다. 두 날개 사이의 연결부는 절개 투시도와 단지배치도의 외곽을 함께 보고 추정했습니다.`,
  },
  'community-2': {
    id: 'community-2', label: '커뮤니티센터 Ⅱ', floors: [communityFloor],
    description: '109동 아래에 자리한 커뮤니티센터입니다. 북서쪽 에듀라운지에서 동남쪽 키즈라운지로 이어지고, 꺾인 북동쪽 날개 끝에 스포츠코트가 있습니다.',
    sourceNote: `${scaleDisclaimer} 방향은 4쪽 붉은 영역과 5쪽 우상단 위치도의 N 표시를 기준으로 맞췄습니다.`,
  },
  'daycare-104': {
    id: 'daycare-104', label: '국공립어린이집', floors: [daycareOne, daycareTwo],
    description: '104동 옆 어린이집의 두 층입니다. 유아놀이터 쪽 현관과 중앙 복도에서 보육실, 교사 공간과 지원 시설이 갈라집니다.',
    sourceNote: `${scaleDisclaimer} 두 층의 계단·승강기 코어를 맞췄습니다. 1층 현관은 동쪽 유아놀이터를 향하는 짧은 입면 중앙에 두었으며 포치와 문의 치수는 추정입니다.`,
  },
};
