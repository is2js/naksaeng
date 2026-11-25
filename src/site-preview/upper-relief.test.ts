import { Box3, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { refineFacilityExteriors } from './facility-exteriors';
import { SITE_FACILITIES } from './facility-markers';
import { UPPER_DISTRICT_GRADE, UPPER_MAIN_DECK, upperDistrictRoadX, upperDistrictStreetRise } from './site-upper-main-layout';

const atPlan = (px: number, pz: number, y = 12) => new Vector3((px - 490) * .52, y, (pz - 540) * .52);

it('ends the green seam at the shared parcel shoulders rather than covering the river', () => {
  const site = new Group();
  refineFacilityExteriors(site);
  const park = site.getObjectByName('SM_Rebuilt_Seam_Park')!;
  const down = new Raycaster(atPlan(327, 565), new Vector3(0, -1, 0));
  expect(down.intersectObject(park, true)).toHaveLength(0);
  // Just west of the dashed common parcel edge (not in the channel itself).
  down.ray.origin.copy(atPlan(362, 576));
  expect(down.intersectObject(park, true)).toHaveLength(0);
  down.ray.origin.copy(atPlan(371, 576));
  expect(down.intersectObject(park, true).length).toBeGreaterThan(0);
  down.ray.origin.copy(atPlan(404, 531));
  expect(down.intersectObject(park, true).length).toBeGreaterThan(0);
  expect(new Box3().setFromObject(park).min.x).toBeCloseTo(atPlan(348, 539).x, 3);
});

it('keeps the Community II and retail façades at one exposed storey with a walk in front', () => {
  const site = new Group();
  refineFacilityExteriors(site);
  const community = site.getObjectByName('SM_Rebuilt_Community_Terraces_community-2')!;
  const retail = site.getObjectByName('SM_Rebuilt_Upper_Retail_Frontage')!;
  for (const [group, roof] of [[community, 7.72], [retail, 7.58]] as const) {
    const glass = group.getObjectByName(`${group.name}_courtGlassShade`)!;
    const walls = new Box3().setFromObject(glass);
    expect(walls.min.y).toBeCloseTo(roof - 3.05 + .12, 2);
    expect(walls.max.y).toBeCloseTo(roof - .45, 2);
  }
  expect(community.getObjectByName(`${community.name}_courtPaver`)?.userData.siteSurface).toBe(true);
});

it('sets the park above the gate, lift landing and kids station without covering the descending ramp', () => {
  const site = new Group(), parcels = new Group();
  parcels.name = 'SM_Parcels_Roads_And_Stream';
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.name = 'MAT_Site_Grass';
  const terrain = new PlaneGeometry(95, 132, 54, 70);
  terrain.rotateX(-Math.PI / 2);
  const grass = new Mesh(terrain, material);
  grass.position.copy(atPlan(329, 257, 3));
  parcels.add(grass);
  site.add(parcels);
  refineFacilityExteriors(site);
  const down = new Raycaster(atPlan(289, 166), new Vector3(0, -1, 0));
  const group = site.getObjectByName('SM_Rebuilt_Upper_Main_Entry')!;
  const roof = group.getObjectByName(`${group.name}_siteGrass`)!;
  const play = site.getObjectByName('SM_Brochure_DeForet_Play')!;
  expect(down.intersectObject(roof)).toHaveLength(0); // garage cap does not blanket the park lawn
  expect(down.intersectObject(grass)[0]?.point.y).toBeCloseTo(UPPER_MAIN_DECK.roofY, 4);
  expect(down.intersectObject(play, true)[0]?.point.y).toBeGreaterThan(UPPER_MAIN_DECK.roofY);
  down.ray.origin.copy(atPlan(310, 241)); // covered part of approach, exactly on the deck level
  expect(down.intersectObject(roof)[0]?.point.y).toBeCloseTo(UPPER_MAIN_DECK.roofY, 1);
  down.ray.origin.copy(atPlan(329, 244)); // exposed part: asphalt only, not green triangles or roof
  expect(down.intersectObject(roof)).toHaveLength(0);
  expect(down.intersectObject(grass, true)).toHaveLength(0);
  const rampY = down.intersectObject(group.getObjectByName(`${group.name}_asphalt`)!)[0]?.point.y;
  expect(rampY).toBeLessThan(UPPER_DISTRICT_GRADE.arrivalY - .4);
  expect(rampY).toBeGreaterThan(UPPER_DISTRICT_GRADE.arrivalY - 1.5);
  const lift = SITE_FACILITIES.find(s => s.id === 'elevator-110')!;
  const kids = SITE_FACILITIES.find(s => s.id === 'kids-station-110')!;
  down.ray.origin.set(lift.x, 24, lift.z);
  expect(down.intersectObject(group, true)[0]?.point.y).toBeCloseTo(lift.y!, 4);
  down.ray.origin.set(kids.x, 12, kids.z);
  expect(down.intersectObject(group, true)[0]?.point.y).toBeCloseTo(kids.y!, 4);
  expect(lift.x).toBeGreaterThan(atPlan(342.4, 218.1).x);
  expect(kids.x).toBeGreaterThan(lift.x);
  expect(kids.y).toBeGreaterThan(UPPER_DISTRICT_GRADE.arrivalY);
  expect(kids.y).toBeLessThan(UPPER_MAIN_DECK.roofY);
  expect(kids.roofMark?.halfWidth).toBe(UPPER_MAIN_DECK.kids.halfWidth);
  down.ray.origin.copy(atPlan(250, 272));
  expect(down.intersectObject(grass)[0]?.point.y).toBeCloseTo(UPPER_DISTRICT_GRADE.arrivalY, 4);
  down.ray.origin.copy(atPlan(400, 325)); // wooded side of the public road
  expect(down.intersectObject(grass)[0]?.point.y).toBeCloseTo(3, 2);
  for (const id of ['Main', 'Open']) {
    const group = site.getObjectByName(`SM_Rebuilt_Upper_${id}_Entry`)!;
    const asphalt = group.getObjectByName(`${group.name}_asphalt`)!;
    const roof = group.getObjectByName(`${group.name}_siteGrass`)!;
    const road = new Box3().setFromObject(asphalt);
    if (id === 'Main') expect(road.min.y).toBeLessThan(UPPER_DISTRICT_GRADE.arrivalY - 1.7);
    else {
      expect(road.min.y).toBeGreaterThan(.26);
      expect(road.max.y-road.min.y).toBeLessThan(.42);
    }
    expect(new Box3().setFromObject(roof).max.y).toBeGreaterThan(3.1);
  }
});

it('grades the public asphalt and paint together from the auxiliary entrance to the main entrance', () => {
  const site = new Group(), street = new Group();
  street.name = 'SM_District_Arterial_Road_And_Sidewalk';
  const positions = [254, 340, 422, 640];
  const stops = (materialName: string, height: number) => positions.map(pz => {
    const z = atPlan(0, pz).z;
    const surface = new Mesh(new PlaneGeometry(.5, .05).rotateX(-Math.PI/2), new MeshBasicMaterial());
    surface.position.set(upperDistrictRoadX(z), height, z);
    surface.material.name = materialName;
    street.add(surface);
    return surface;
  });
  const asphalt = stops('MAT_District_Charcoal_Asphalt', .58);
  const paint = stops('MAT_District_Lane_Marking', .60);
  const verge = stops('MAT_District_Graded_Verge', .568);
  site.add(street);
  refineFacilityExteriors(site);
  const top = (mesh: Mesh) => new Box3().setFromObject(mesh).max.y;
  expect(top(asphalt[0]!)).toBeCloseTo(UPPER_DISTRICT_GRADE.arrivalY, 4);
  expect(top(asphalt[1]!)).toBeCloseTo(UPPER_DISTRICT_GRADE.lowerRoadY + upperDistrictStreetRise(atPlan(0, 340).z), 2);
  expect(top(asphalt[2]!)).toBeCloseTo(UPPER_DISTRICT_GRADE.lowerRoadY, 4);
  expect(top(asphalt[3]!)).toBeCloseTo(UPPER_DISTRICT_GRADE.lowerRoadY, 4);
  for (let i = 0; i < positions.length; i++) expect(top(paint[i]!) - top(asphalt[i]!)).toBeCloseTo(.02, 4);
  expect(top(asphalt[1]!) - top(verge[1]!)).toBeGreaterThan(.15);
});
