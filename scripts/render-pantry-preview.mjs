/** Render the pantry preview from the SAME procedural implementation as the map. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const base = '/naksaeng/bunfirvil/';
const output = resolve('public/assets/options/previews/entry-pantry-system-shelf-v6.webp');
const server = await createServer({
  configFile: resolve('vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: true },
  plugins: [{
    name: 'pantry-preview-only',
    configureServer(instance) {
      instance.middlewares.use((request, response, next) => {
        if (!request.url?.endsWith('/__pantry-preview')) return next();
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><head><title>Pantry recipe preview</title></head><body style="margin:0"><canvas width="512" height="512"></canvas></body></html>');
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
  await page.goto(`http://127.0.0.1:${address.port}${base}__pantry-preview`);
  const dataUrl = await page.evaluate(async (root) => {
    const THREE = await import(root + 'node_modules/three/build/three.module.js');
    const { ThreeWorldRenderer, STRUCTURAL_PROP_ASSETS, BUNDANG_INTERIOR_LIGHTING } = await import(root + 'src/game/three-world.ts');
    const asset = STRUCTURAL_PROP_ASSETS.find(item => item.assetId === 'entry-pantry-rounded-system-cabinet');
    if (!asset || asset.parts.length !== 10) throw new Error('Corrected open-entry recipe is required.');

    // No live game is constructed: use its exact pure geometry/material methods.
    const factory = Object.create(ThreeWorldRenderer.prototype);
    factory.apartment = { geometry: { cellSizeMeters: 1 } };
    factory.variants = new Map([['pet-warm-ivory', { primary: '#e8e5dc', secondary: '#f5f3ec', accent: '#aaa79f' }]]);
    const model = factory.proceduralProp({
      assetId: asset.assetId, dimensionsMeters: [1.6, .48, 2.15], materialVariantId: 'pet-warm-ivory',
    }, asset);

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
    light.position.set(-3, 6, 5);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = light.shadow.camera.bottom = -3;
    light.shadow.camera.right = light.shadow.camera.top = 3;
    light.shadow.bias = -.0002;
    scene.add(light);
    const fill = new THREE.DirectionalLight(BUNDANG_INTERIOR_LIGHTING.fill, BUNDANG_INTERIOR_LIGHTING.fillIntensity);
    fill.position.set(8, 5, 8);
    scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#b9c4bf', roughness: .95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.004;
    floor.receiveShadow = true;
    scene.add(floor);
    const camera = new THREE.OrthographicCamera(-1.58, 1.58, 1.58, -1.58, .1, 50);
    camera.position.set(3.5, 2.8, 4.4);
    camera.lookAt(0, 1.08, 0);
    renderer.render(scene, camera);
    const image = canvas.toDataURL('image/webp', .82);
    scene.traverse(mesh => { if (mesh.isMesh) { mesh.geometry.dispose(); (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose()); } });
    renderer.dispose();
    return image;
  }, base);
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!dataUrl.startsWith('data:image/webp;') || bytes.length >= 25 * 1024) throw new Error('Preview must be a compact WebP under 25KiB.');
  await mkdir(resolve('public/assets/options/previews'), { recursive: true });
  await writeFile(output, bytes);
  console.log(JSON.stringify({ output, width: 512, height: 512, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
