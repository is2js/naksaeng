import type { ApartmentGeometry, ApartmentInteriorProp } from './types';

const WALL_GAP_METERS = .005;
const round = (value: number): number => Math.round(value * 1e9) / 1e9;

/** Fit the fixed 59A bathroom-2 tub to the actual finished wall faces.
 * The exact floorplan warp changes the span while product dimensions remain rigid.
 * Run on local geometry before plan transforms and before collision cells are rebuilt.
 */
export function fitBundang59ABathtub(geometry: ApartmentGeometry, source: ApartmentGeometry): boolean {
  const west = geometry.wallSegments?.find(wall => wall.id === 'bathroom-2-west-before');
  const east = geometry.wallSegments?.find(wall => wall.id === 'outer-east');
  const bathrooms = geometry.optionAnchors?.bathrooms as Record<string, Record<string, any>> | undefined;
  const tub = bathrooms?.['bathroom-2']?.wetFixture;
  if (!west || !east || !tub || tub.assetId !== 'bathtub-built-in'
    || tub.localOverride === true || tub.userPlaced === true
    || !Array.isArray(tub.positionMeters) || !Array.isArray(tub.dimensionsMeters)
    || !Array.isArray(west.a) || !Array.isArray(west.b) || !Array.isArray(east.a) || !Array.isArray(east.b)) return false;
  const [westX, westY] = west.a.map(Number), [westEndX, westEndY] = west.b.map(Number);
  const [eastX, eastY] = east.a.map(Number), [eastEndX, eastEndY] = east.b.map(Number);
  const tubY = Number(tub.positionMeters[1]);
  const westThickness = Number(west.thicknessMeters), eastThickness = Number(east.thicknessMeters);
  const yaw = ((Number(tub.yawDeg) || 0) % 360 + 360) % 360;
  if (![westX, westY, westEndX, westEndY, eastX, eastY, eastEndX, eastEndY, tubY, westThickness, eastThickness].every(Number.isFinite)
    || westThickness <= 0 || eastThickness <= 0 || Math.abs(westX - westEndX) > 1e-7 || Math.abs(eastX - eastEndX) > 1e-7
    || (Math.abs(yaw) > 1e-7 && Math.abs(yaw - 180) > 1e-7)
    || tubY < Math.min(westY, westEndY) || tubY > Math.max(westY, westEndY)
    || tubY < Math.min(eastY, eastEndY) || tubY > Math.max(eastY, eastEndY)) return false;
  const leftFace = westX + westThickness / 2, rightFace = eastX - eastThickness / 2;
  const width = round(rightFace - leftFace - 2 * WALL_GAP_METERS);
  if (width <= 0 || rightFace <= leftFace) return false;
  const center = round((leftFace + rightFace) / 2);
  tub.positionMeters = [center, ...tub.positionMeters.slice(1)];
  tub.dimensionsMeters = [width, ...tub.dimensionsMeters.slice(1)];

  // Keep the fallback base prop (collision and physical laser geometry) in sync
  // with the same anchor used by the generated option-runtime renderer.
  for (const prop of geometry.interiorProps || []) {
    if (prop.anchorId !== 'bathroom-2.wetFixture' || prop.assetId !== 'bathtub-built-in'
      || prop.localOverride === true || prop.userPlaced === true || prop.localDeleted === true
      || Boolean(prop.sourcePropId) || /^local-/.test(String(prop.id || ''))) continue;
    prop.positionMeters = [center, ...(prop.positionMeters || tub.positionMeters).slice(1)];
    prop.dimensionsMeters = [width, ...(Array.isArray(prop.dimensionsMeters) ? prop.dimensionsMeters : tub.dimensionsMeters).slice(1)];
    alignRenderWidth(prop, width);
  }
  fitAdjacentBathroomFixtures(geometry, source, rightFace, tub);
  return true;
}

/** Keep the original basin product size and make the least forward adjustment
 * needed to clear the wall-to-wall tub and toilet. B/D authored positions are
 * retained when already clear; fixed option anchors and fallback props agree.
 */
function fitAdjacentBathroomFixtures(
  geometry: ApartmentGeometry,
  source: ApartmentGeometry,
  eastFace: number,
  tub: Record<string, any>,
): void {
  const sourceBath = (source.optionAnchors?.bathrooms as Record<string, any> | undefined)?.['bathroom-2'];
  const anchors = geometry.optionAnchors as Record<string, any> | undefined;
  const bath = anchors?.bathrooms?.['bathroom-2'];
  const basin = bath?.basin, toilet = bath?.toilet;
  const sourceDimensions = sourceBath?.basin?.dimensionsMeters;
  const south = geometry.wallSegments?.find(wall => wall.id === 'bathroom-2-south');
  if (!basin || !toilet || basin.localOverride === true || basin.userPlaced === true
    || toilet.localOverride === true || toilet.userPlaced === true
    || !Array.isArray(sourceDimensions) || sourceDimensions.length < 3
    || !sourceDimensions.slice(0, 3).every((n: unknown) => Number.isFinite(n) && Number(n) > 0)
    || !Array.isArray(basin.positionMeters) || !Array.isArray(toilet.positionMeters)
    || !Array.isArray(south?.a) || !Array.isArray(south?.b)) return;
  const dimensions = sourceDimensions.map(Number);
  const tubCenterY = Number(tub.positionMeters[1]), tubDepth = Number(tub.dimensionsMeters[1]);
  const [southY, southEndY] = [Number(south.a[1]), Number(south.b[1])];
  const southThickness = Number(south.thicknessMeters);
  const positionValues = [...basin.positionMeters.slice(0, 2), ...toilet.positionMeters.slice(0, 2)].map(Number);
  if (![tubCenterY, tubDepth, southY, southEndY, southThickness, ...positionValues].every(Number.isFinite)
    || tubDepth <= 0 || southThickness <= 0 || Math.abs(southY - southEndY) > 1e-7) return;

  const gap = .02, toiletWidth = .4;
  const basinX = round(eastFace - dimensions[1] / 2 - WALL_GAP_METERS);
  const minBasinY = tubCenterY + tubDepth / 2 + gap + dimensions[0] / 2;
  const southFace = southY - southThickness / 2;
  const variants = anchors?.planVariantOverrides as Record<string, any> | undefined;
  const overrideBaths = Object.values(variants || {}).map(value => value?.bathrooms?.roomOverrides?.['bathroom-2']).filter(Boolean);
  const planned = [null, ...overrideBaths].map(override => {
    const basinPosition = Array.isArray(override?.basin?.positionMeters) ? override.basin.positionMeters : basin.positionMeters;
    const toiletPosition = Array.isArray(override?.toilet?.positionMeters) ? override.toilet.positionMeters : toilet.positionMeters;
    const basinY = Math.max(Number(basinPosition[1]), minBasinY);
    const toiletY = Math.max(Number(toiletPosition[1]), basinY + dimensions[0] / 2 + gap + toiletWidth / 2);
    return { override, basinY: round(basinY), toiletY: round(toiletY) };
  });
  if (planned.some(row => !Number.isFinite(row.basinY) || !Number.isFinite(row.toiletY)
    || row.toiletY + toiletWidth / 2 + gap > southFace + 1e-8)) return;
  const base = planned[0];
  basin.positionMeters = [basinX, base.basinY, ...basin.positionMeters.slice(2)];
  basin.dimensionsMeters = [...dimensions];
  toilet.positionMeters = [Number(toilet.positionMeters[0]), base.toiletY, ...toilet.positionMeters.slice(2)];
  for (const row of planned.slice(1)) {
    const override = row.override;
    if (Array.isArray(override?.basin?.positionMeters)) {
      override.basin.positionMeters = [basinX, row.basinY, ...override.basin.positionMeters.slice(2)];
    }
    if (Array.isArray(override?.toilet?.positionMeters)) {
      override.toilet.positionMeters = [Number(override.toilet.positionMeters[0]), row.toiletY, ...override.toilet.positionMeters.slice(2)];
    }
  }
  for (const prop of geometry.interiorProps || []) {
    if (prop.localOverride === true || prop.userPlaced === true || prop.localDeleted === true
      || Boolean(prop.sourcePropId) || /^local-/.test(String(prop.id || ''))) continue;
    if (prop.anchorId === 'bathroom-2.basin' && prop.assetId === 'vanity-basin-compact') {
      prop.positionMeters = [...basin.positionMeters];
      prop.dimensionsMeters = [...dimensions];
      if (Array.isArray(prop.renderDimensionsMeters)) prop.renderDimensionsMeters = [...dimensions];
      else if (prop.renderDimensionsMeters && typeof prop.renderDimensionsMeters === 'object') {
        prop.renderDimensionsMeters = { ...prop.renderDimensionsMeters, width: dimensions[0], depth: dimensions[1], height: dimensions[2] };
      }
    } else if (prop.anchorId === 'bathroom-2.toilet' && prop.assetId === 'toilet-floor-mounted') {
      prop.positionMeters = [...toilet.positionMeters];
    }
  }
}

function alignRenderWidth(prop: ApartmentInteriorProp, width: number): void {
  if (Array.isArray(prop.renderDimensionsMeters)) {
    prop.renderDimensionsMeters = [width, ...prop.renderDimensionsMeters.slice(1)];
  } else if (prop.renderDimensionsMeters && typeof prop.renderDimensionsMeters === 'object') {
    prop.renderDimensionsMeters = { ...prop.renderDimensionsMeters, width };
  }
}
