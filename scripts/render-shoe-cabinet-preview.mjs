/** Regenerate the premium shoe cabinet card from the exact in-game recipe. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const base = '/naksaeng/bunfirvil/';
const outputDir = resolve('public/assets/options/previews');
const output = resolve(outputDir, 'entry-open-premium-shoe-cabinet-v2.webp');
const catalog = JSON.parse(await readFile(resolve('public/generated/catalog.v1.json'), 'utf8'));
const server = await createServer({
  configFile: resolve('vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: true },
  plugins: [{
    name: 'shoe-cabinet-preview-only',
    configureServer(instance) {
      instance.middlewares.use((request, response, next) => {
        if (!request.url?.endsWith('/__shoe-cabinet-preview')) return next();
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><head><title>Premium shoe cabinet preview</title></head><body style="margin:0"><canvas width="512" height="512"></canvas></body></html>');
      });
    },
  }],
});

let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${address.port}${base}__shoe-cabinet-preview`);
  const dataUrl = await page.evaluate(async ({ root, interiorPath, recipePath }) => {
    const THREE = await import(root + 'node_modules/three/build/three.module.js');
    const { ThreeWorldRenderer, mergeRuntimeAssetCatalogs, BUNDANG_INTERIOR_LIGHTING } = await import(root + 'src/game/three-world.ts');
    const [interior, recipe] = await Promise.all([interiorPath, recipePath].map(path => fetch(root + path).then(response => {
      if (!response.ok) throw new Error(`Cannot load preview catalog: ${path}`);
      return response.json();
    })));
    const asset = mergeRuntimeAssetCatalogs(interior.assets, recipe.assets).get('entry-shoe-cabinet-tall');
    if (!asset?.parts?.length) throw new Error('Shoe cabinet base recipe not found.');

    // Render only the existing map factory, not a parallel approximation of its mesh.
    const factory = Object.create(ThreeWorldRenderer.prototype);
    factory.apartment = { geometry: { cellSizeMeters: 1 } };
    factory.variants = new Map();
    const model = factory.proceduralProp({
      assetId: asset.assetId, sourceOptionId: 'entry-open-premium-shoe-cabinet', fixedOptionLayout: true,
      materialVariantId: 'pet-warm-ivory', dimensionsMeters: [1.55, .35, 2.2],
      shoeCabinetFloatingRevision: 'suspended-base-v1', shoeCabinetFloatingGapMeters: .17,
    }, asset);
    if (model.userData.shoeCabinetFloatingGapMeters !== .17) throw new Error('Suspended cabinet recipe is required.');
    model.position.y = .018;

    const canvas = document.querySelector('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(512, 512);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = BUNDANG_INTERIOR_LIGHTING.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#c7cfcc');
    scene.add(model, new THREE.HemisphereLight(BUNDANG_INTERIOR_LIGHTING.sky,
      BUNDANG_INTERIOR_LIGHTING.ground, BUNDANG_INTERIOR_LIGHTING.hemisphereIntensity));
    model.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
    const light = new THREE.DirectionalLight(BUNDANG_INTERIOR_LIGHTING.sun, BUNDANG_INTERIOR_LIGHTING.sunIntensity);
    light.position.set(-2, 5, 4);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = light.shadow.camera.bottom = -3;
    light.shadow.camera.right = light.shadow.camera.top = 3;
    light.shadow.bias = -.0002;
    scene.add(light);
    const fill = new THREE.DirectionalLight(BUNDANG_INTERIOR_LIGHTING.fill, BUNDANG_INTERIOR_LIGHTING.fillIntensity);
    fill.position.set(8, 5, 8);
    scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#aab4b0', roughness: .95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.004;
    floor.receiveShadow = true;
    scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#c5cdca', roughness: .95 }));
    wall.position.z = -.205;
    wall.receiveShadow = true;
    scene.add(wall);
    const camera = new THREE.OrthographicCamera(-1.43, 1.43, 1.43, -1.43, .1, 50);
    camera.position.set(2.1, 1.78, 5.3);
    camera.lookAt(0, 1.08, 0);
    renderer.render(scene, camera);
    const image = canvas.toDataURL('image/webp', .82);
    scene.traverse(mesh => { if (mesh.isMesh) { mesh.geometry.dispose(); (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose()); } });
    renderer.dispose();
    return image;
  }, { root: base, interiorPath: catalog.renderAssets.interiorCatalogUrl, recipePath: catalog.renderAssets.recipeCatalogUrl });
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!dataUrl.startsWith('data:image/webp;') || bytes.length >= 25 * 1024) throw new Error('Preview must be a compact WebP under 25KiB.');
  await mkdir(outputDir, { recursive: true });
  await writeFile(output, bytes);
  console.log(JSON.stringify({ output, width: 512, height: 512, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
