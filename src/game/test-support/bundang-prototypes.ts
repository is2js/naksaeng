import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ShowcaseCatalog, WorldChunk, WorldObject } from '../types';

/** Fresh source objects for metric contract tests; never writes the generated snapshot. */
export async function readBundangPrototypeApartments(): Promise<Map<string, WorldObject>> {
  const publicRoot = path.join(process.cwd(), 'public');
  const catalog = JSON.parse(await readFile(path.join(publicRoot, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  const result = new Map<string, WorldObject>();
  for (const map of catalog.maps) {
    const chunkRoot = path.join(path.dirname(path.join(publicRoot, ...map.manifestUrl.split('/'))), 'chunks');
    for (const filename of (await readdir(chunkRoot)).filter(name => name.endsWith('.json')).sort()) {
      const chunk = JSON.parse(await readFile(path.join(chunkRoot, filename), 'utf8')) as WorldChunk;
      const apartment = (chunk.objects || []).find(object => object.type === 'enterable-apartment-unit-v1' && object.geometry);
      if (apartment) { result.set(map.unitType, apartment); break; }
    }
  }
  return result;
}
