import { describe, expect, it } from 'vitest';
import { strToU8, zlibSync } from 'fflate';
import type { ShowcaseCatalog } from './types';
import {
  BundangShareError,
  BUNDANG_SHARE_MAX_FURNITURE,
  BUNDANG_SHARE_MAX_JSON_BYTES,
  bundangReadOnlyShareUrl,
  createBundangReadOnlyShare,
  decodeBundangReadOnlyShare,
  encodeBundangReadOnlyShare,
  shareTokenFromHash,
  sharedFurnitureProps,
  validateBundangReadOnlyShare,
  validateBundangReadOnlyShareMetadata,
} from './read-only-share';

const catalog = {
  schemaVersion: 1, exportId: 'test', generatedAt: '', characters: [], skills: [], defaultHotbar: [], renderAssets: undefined,
  maps: [{ id: 'bundang-first-village-55b-prototype', label: '55B', unitType: '55B', revision: '1', renderer: 'three-pbr', width: 64, height: 64, chunkCount: 16, assetBytes: 0, spawn: { x: 1, y: 1 }, manifestUrl: '', minimapUrl: '' }],
  bOptions: [{ id: 'option-1', label: '옵션', category: '주방', price: 1, description: '', compatibleUnitTypes: ['55B'], requires: [], excludes: [] }],
} satisfies ShowcaseCatalog;
const assets = [{ assetId: 'sofa', displayNameKo: '소파', category: '거실', defaultDimensionsMeters: [2, 1, 1], materialVariantIds: ['oak'] }];

describe('read-only share', () => {
  it('keeps original v1 links without an author readable', () => {
    const legacy = { schemaVersion: 1, mapId: catalog.maps[0].id, unitType: '55B', planVariant: 'A', livingFacing: 'south-west', selectedOptionIds: [], furniture: [] };
    expect(validateBundangReadOnlyShare(legacy, catalog, assets).sharedByNickname).toBe('공유자');
    expect(() => validateBundangReadOnlyShare({ ...legacy, sharedByNickname: '' }, catalog, assets)).toThrow();
  });
  it('round-trips only the allowed showcase state', () => {
    const state = createBundangReadOnlyShare({
      sharedByNickname: '돌범',
      mapId: catalog.maps[0].id, unitType: '55B', planVariant: 'A', selectedOptionIds: ['option-1'],
      furniture: [{ id: 'local-private', assetId: 'sofa', positionMeters: [2.345, 4.321], yawDeg: 90, mirrored: true, materialVariantId: 'oak', privateNote: 'drop-me' }],
    });
    const token = encodeBundangReadOnlyShare(state);
    const restored = validateBundangReadOnlyShare(decodeBundangReadOnlyShare(token), catalog, assets);
    expect(restored.furniture[0]).toEqual({ assetId: 'sofa', positionMeters: [2.35, 4.32], yawDeg: 90, mirrored: true, materialVariantId: 'oak' });
    expect(restored.sharedByNickname).toBe('돌범');
    expect(JSON.stringify(restored)).not.toMatch(/privateNote|building|household|operator/);
    expect(sharedFurnitureProps(restored, assets)[0].id).toBe('local-shared-1');
    const url = bundangReadOnlyShareUrl('https://is2js.github.io/bunfirvil/?actor=200', restored);
    expect(url).not.toContain('actor=');
    expect(shareTokenFromHash(new URL(url).hash)).toBe(token);
  });

  it('round-trips a geometry revision without migrating the shared furniture coordinates', () => {
    const state = createBundangReadOnlyShare({
      sharedByNickname: '공유자', mapId: catalog.maps[0].id, unitType: '55B', planVariant: 'A', selectedOptionIds: [],
      furniture: [{ assetId: 'sofa', positionMeters: [9.75, 6.25], yawDeg: 90, mirrored: false }],
      geometryRevision: 'bundang-55b-geometry-v2',
    });
    const restored = validateBundangReadOnlyShare(decodeBundangReadOnlyShare(encodeBundangReadOnlyShare(state)), catalog, assets);
    expect(restored.geometryRevision).toBe('bundang-55b-geometry-v2');
    expect(restored.furniture[0].positionMeters).toEqual([9.75, 6.25]);
    for (const geometryRevision of ['', '<script>', 'a'.repeat(81), 2]) {
      expect(() => validateBundangReadOnlyShare({ ...state, geometryRevision }, catalog, assets)).toThrow(BundangShareError);
    }
  });

  it('rejects incompatible or malformed state', () => {
    const invalid = { schemaVersion: 1, sharedByNickname: '돌범', mapId: catalog.maps[0].id, unitType: '55B', planVariant: 'A', livingFacing: 'south-west', selectedOptionIds: ['unknown'], furniture: [] };
    expect(() => validateBundangReadOnlyShare(invalid, catalog, assets)).toThrow(BundangShareError);
    expect(() => createBundangReadOnlyShare({
      sharedByNickname: '', mapId: catalog.maps[0].id, unitType: '55B', planVariant: 'A', selectedOptionIds: [], furniture: [],
    })).toThrow(BundangShareError);
    expect(() => decodeBundangReadOnlyShare('%%%')).toThrow(BundangShareError);
  });

  it('does not silently treat broken or unsupported share fragments as ordinary visits', () => {
    expect(shareTokenFromHash('#building=105')).toBeNull();
    for (const hash of ['#share=', '#share=v1.', '#share=v2.token']) {
      expect(() => shareTokenFromHash(hash)).toThrow(BundangShareError);
    }
  });

  it('rejects a false decompression size without allocating the claimed payload', () => {
    const compressed = zlibSync(strToU8(JSON.stringify('x'.repeat(BUNDANG_SHARE_MAX_JSON_BYTES * 4))));
    const envelope = new Uint8Array(4 + compressed.length);
    envelope.set(compressed, 4);
    for (const declared of [0, 16, BUNDANG_SHARE_MAX_JSON_BYTES, BUNDANG_SHARE_MAX_JSON_BYTES + 1]) {
      new DataView(envelope.buffer).setUint32(0, declared, true);
      expect(() => decodeBundangReadOnlyShare(Buffer.from(envelope).toString('base64url'))).toThrow(BundangShareError);
    }
  });

  it('derives the facing once and rejects furniture overflow instead of dropping furniture', () => {
    const input = {
      sharedByNickname: '돌범', mapId: catalog.maps[0].id, unitType: '55B', planVariant: 'B' as const,
      selectedOptionIds: [],
      furniture: Array.from({ length: BUNDANG_SHARE_MAX_FURNITURE }, (_, index) => ({
        id: `local-${index}`, assetId: 'sofa', positionMeters: [2, 4], yawDeg: Infinity,
      })),
    };
    const state = createBundangReadOnlyShare(input);
    expect(state.livingFacing).toBe('south-east');
    expect(state.furniture).toHaveLength(BUNDANG_SHARE_MAX_FURNITURE);
    expect(state.furniture[0].yawDeg).toBe(0);
    expect(validateBundangReadOnlyShareMetadata(state, catalog).mapId).toBe(input.mapId);
    expect(validateBundangReadOnlyShare(decodeBundangReadOnlyShare(encodeBundangReadOnlyShare(state)), catalog, assets)).toEqual(state);
    expect(() => createBundangReadOnlyShare({ ...input, furniture: [...input.furniture, input.furniture[0]] })).toThrow(BundangShareError);
  });
});
