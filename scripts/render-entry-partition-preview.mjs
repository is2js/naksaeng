/** Same panel/rail factories as the game; no generated snapshot edits. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const base = '/naksaeng/bunfirvil/';
const output = resolve('public/assets/options/previews/entry-sliding-partition-door-v2.webp');
const server = await createServer({
  configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true },
  plugins: [{ name: 'entry-partition-preview-only', configureServer(instance) {
    instance.middlewares.use((request, response, next) => {
      if (!request.url?.endsWith('/__entry-partition-preview')) return next();
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><title>Sliding entry panel preview</title></head><body style="margin:0"><canvas width="512" height="512"></canvas></body></html>');
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}${base}__entry-partition-preview`);
  const dataUrl = await page.evaluate(async root => {
    const THREE = await import(root + 'node_modules/three/build/three.module.js');
    const { createEntrySlidingPanel, createEntrySlidingRail } = await import(root + 'src/game/entry-partition-model.ts');
    const canvas = document.querySelector('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(512, 512); renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#deddd7');
    scene.add(new THREE.HemisphereLight('#f8fafc', '#77776e', 1.8));
    const sun = new THREE.DirectionalLight('#fff8ec', 2);
    sun.position.set(-3, 5, 4); scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#c8c5bb', roughness: .95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.003; scene.add(floor);
    // 55B-sized leaf parked against the left wall, with the clear entry on the right.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.12, 2.45, .12), new THREE.MeshStandardMaterial({ color: '#e4e4dd', roughness: .97 }));
    wall.position.set(-.56, 1.225, -.18); scene.add(wall);
    const leaf = createEntrySlidingPanel({ dimensionsMeters: [1.09, .04, 2.2], partitionHandleSide: 1 }, 1);
    leaf.position.set(-.555, .012, 0); scene.add(leaf);
    const top = createEntrySlidingRail({ dimensionsMeters: [2.2, .048, .028] }, 1);
    top.position.y = 2.22; scene.add(top);
    const bottom = createEntrySlidingRail({ dimensionsMeters: [2.2, .024, .010] }, 1);
    bottom.position.y = .001; scene.add(bottom);
    const camera = new THREE.OrthographicCamera(-1.65, 1.65, 1.65, -1.65, .1, 50);
    camera.position.set(3.4, 2.6, 5.8); camera.lookAt(-.05, 1.12, 0);
    renderer.render(scene, camera);
    const image = canvas.toDataURL('image/webp', .85);
    const materials = new Set();
    scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
    });
    materials.forEach(material => material.dispose()); renderer.dispose();
    return image;
  }, base);
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!dataUrl.startsWith('data:image/webp;') || bytes.length >= 25 * 1024) throw new Error('Preview must be WebP under 25KiB.');
  await mkdir(resolve('public/assets/options/previews'), { recursive: true }); await writeFile(output, bytes);
  console.log(JSON.stringify({ output, width: 512, height: 512, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
} finally { await browser?.close(); await server.close(); }
