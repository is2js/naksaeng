import * as THREE from 'three';
import type { ApartmentInteriorProp } from './types';
import { ENTRY_PARTITION_PROFILE, entrySlidingPanelDimensions, entrySlidingPanelFrameWidths } from './entry-partition-profile';

type Dimensions = [number, number, number];

function frameMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#242825', roughness: .78, metalness: .12, envMapIntensity: .12 });
}

function box(group: THREE.Group, name: string, size: Dimensions, position: Dimensions,
  material: THREE.Material, cellSize: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size.map(value => Math.max(.001, value) / cellSize) as Dimensions), material);
  mesh.name = name;
  mesh.position.set(...position.map(value => value / cellSize) as Dimensions);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);
  return mesh;
}

/** One parked/fixed sliding leaf. Position/yaw/parking are owned by the layout. */
export function createEntrySlidingPanel(prop: ApartmentInteriorProp, cellSizeMeters: number): THREE.Group {
  const cellSize = Math.max(.01, Number(cellSizeMeters) || .5);
  const dimensions = entrySlidingPanelDimensions(prop.dimensionsMeters);
  const [width, depth, height] = dimensions;
  const { frame: frameWidth, mullion } = entrySlidingPanelFrameWidths(dimensions);
  const innerHeight = Math.max(.001, height - frameWidth * 2);
  const paneWidth = Math.max(.001, (width - frameWidth * 2 - mullion) / 2);
  const group = new THREE.Group();
  group.name = 'entry-sliding-panel';
  group.userData.entryPartitionPart = 'panel';
  group.userData.entryPartitionMaterial = 'dark-frame-smoked-glass-v2';
  const frame = frameMaterial();
  for (const side of [-1, 1]) {
    box(group, `entry-partition-frame-side-${side}`, [frameWidth, height, depth],
      [side * (width - frameWidth) / 2, height / 2, 0], frame, cellSize);
    box(group, `entry-partition-frame-horizontal-${side}`, [width - frameWidth * 2, frameWidth, depth],
      [0, side < 0 ? frameWidth / 2 : height - frameWidth / 2, 0], frame, cellSize);
  }
  box(group, 'entry-partition-mullion', [mullion, innerHeight, depth], [0, height / 2, 0], frame, cellSize);
  const glass = new THREE.MeshStandardMaterial({
    color: '#343b37', roughness: .62, metalness: 0, envMapIntensity: .08,
    transparent: true, opacity: .44, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) box(group, `entry-partition-smoked-glass-${side}`, [paneWidth, innerHeight, Math.min(ENTRY_PARTITION_PROFILE.glassThicknessMeters, depth)],
    [side * (paneWidth + mullion) / 2, height / 2, 0], glass, cellSize);
  const handleSide = Number(prop.partitionHandleSide) < 0 ? -1 : 1;
  const handleX = handleSide * Math.max(0, width / 2 - frameWidth - ENTRY_PARTITION_PROFILE.handleInsetMeters);
  const handleHeight = Math.min(ENTRY_PARTITION_PROFILE.handleHeightMeters, height * .18);
  const handleHalfDepth = ENTRY_PARTITION_PROFILE.handleDepthMeters / 2;
  for (const side of [-1, 1]) box(group, `entry-partition-handle-${side}`, [ENTRY_PARTITION_PROFILE.handleWidthMeters, handleHeight, ENTRY_PARTITION_PROFILE.handleDepthMeters],
    [handleX, height * .48, side * Math.max(handleHalfDepth, depth / 2 - handleHalfDepth)], frame, cellSize);
  // Geometry and layout remain separate. The caller supplies the source yaw;
  // the parent layout owns any additional odd-plan-reflection correction.
  if (prop.mirrored) group.scale.x = -1;
  return group;
}

/** Independent upper/lower wall rail, respecting millimetre authored thickness. */
export function createEntrySlidingRail(prop: ApartmentInteriorProp, cellSizeMeters: number): THREE.Group {
  const cellSize = Math.max(.01, Number(cellSizeMeters) || .5);
  const size = entrySlidingPanelDimensions(prop.dimensionsMeters, [2.2, .048, .028]);
  const group = new THREE.Group();
  group.name = 'entry-sliding-rail';
  group.userData.entryPartitionPart = 'rail';
  box(group, 'entry-partition-rail-body', [size[0], size[2], size[1]], [0, size[2] / 2, 0], frameMaterial(), cellSize);
  if (prop.mirrored) group.scale.x = -1;
  return group;
}
