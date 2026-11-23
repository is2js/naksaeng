import {
  Color, DepthTexture, DoubleSide, LinearFilter, Material, Mesh, NoBlending, OrthographicCamera,
  PlaneGeometry, RedFormat, Scene, ShaderMaterial, Vector2, WebGLRenderer, WebGLRenderTarget,
} from 'three';

const OUTLINE_COLOR = 0x52f4bc;
const OUTLINE_WIDTH_CSS_PX = 2.65;

/** Draw a depth-aware contour over the beauty pass, without replacing façade materials. */
export function createBuildingOutline(renderer: WebGLRenderer, owners: ReadonlyMap<Mesh, string>) {
  const depth = new DepthTexture(1, 1);
  const target = new WebGLRenderTarget(1, 1, {
    format: RedFormat, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, depthTexture: depth,
  });
  let selectedId = '';
  const mask = new ShaderMaterial({
    uniforms: { selected: { value: 0 } },
    side: DoubleSide,
    blending: NoBlending,
    vertexShader: `
      void main() {
        vec4 local = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * local;
      }
    `,
    fragmentShader: `
      uniform float selected;
      void main() {
        if (selected < 0.0) discard;
        gl_FragColor = vec4(selected, 0.0, 0.0, 1.0);
      }
    `,
  });
  mask.onBeforeRender = (_renderer, _scene, _camera, _geometry, object, group) => {
    if (!(object instanceof Mesh)) return;
    const index = group && 'materialIndex' in group && typeof group.materialIndex === 'number' ? group.materialIndex : 0;
    const source: Material | undefined = Array.isArray(object.material) ? object.material[index] : object.material;
    // Transparent foreground glass does not hide the silhouette behind it.
    mask.uniforms.selected.value = source?.transparent ? -1 : Number(owners.get(object) === selectedId);
    mask.uniformsNeedUpdate = true;
  };

  const composite = new ShaderMaterial({
    uniforms: {
      silhouette: { value: target.texture },
      sceneDepth: { value: depth },
      ink: { value: new Color(OUTLINE_COLOR) },
      stepUv: { value: new Vector2(1, 1) },
      depthSlop: { value: 0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying vec2 coord;
      void main() {
        coord = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D silhouette;
      uniform sampler2D sceneDepth;
      uniform vec3 ink;
      uniform vec2 stepUv;
      uniform float depthSlop;
      varying vec2 coord;

      float visibleNeighbor(vec2 delta, float frontDepth) {
        vec2 sampleAt = coord + delta * stepUv;
        float selectedPixel = texture2D(silhouette, sampleAt).r;
        if (selectedPixel < 0.015) return 0.0;
        float neighborDepth = texture2D(sceneDepth, sampleAt).r;
        return selectedPixel * step(neighborDepth - depthSlop, frontDepth);
      }

      void main() {
        float inside = texture2D(silhouette, coord).r;
        if (inside > 0.995) discard;
        float frontDepth = texture2D(sceneDepth, coord).r;
        float edge = max(visibleNeighbor(vec2(1.0, 0.0), frontDepth), visibleNeighbor(vec2(-1.0, 0.0), frontDepth));
        edge = max(edge, max(visibleNeighbor(vec2(0.0, 1.0), frontDepth), visibleNeighbor(vec2(0.0, -1.0), frontDepth)));
        edge = max(edge, max(visibleNeighbor(vec2(0.7071, 0.7071), frontDepth), visibleNeighbor(vec2(-0.7071, 0.7071), frontDepth)));
        edge = max(edge, max(visibleNeighbor(vec2(0.7071, -0.7071), frontDepth), visibleNeighbor(vec2(-0.7071, -0.7071), frontDepth)));
        float alpha = clamp(edge - inside, 0.0, 1.0);
        if (alpha < 0.025) discard;
        gl_FragColor = vec4(ink, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const quadGeometry = new PlaneGeometry(2, 2);
  const quad = new Mesh(quadGeometry, composite);
  quad.frustumCulled = false;
  const overlay = new Scene();
  overlay.add(quad);
  const overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const background = new Color();
  let width = 1;
  let height = 1;

  return {
    resize(cssWidth: number, cssHeight: number) {
      // Keep the auxiliary buffer at CSS resolution even on high-DPI phones.
      width = cssWidth;
      height = cssHeight;
      composite.uniforms.stepUv.value.set(OUTLINE_WIDTH_CSS_PX / width, OUTLINE_WIDTH_CSS_PX / height);
    },
    render(world: Scene, camera: OrthographicCamera, id: string) {
      selectedId = id;
      target.setSize(width, height);
      const passBefore = renderer.getRenderTarget();
      const overrideBefore = world.overrideMaterial;
      const clearAlpha = renderer.getClearAlpha();
      const shadowBefore = renderer.shadowMap.enabled;
      const autoClear = renderer.autoClear;
      renderer.getClearColor(background);
      // Orthographic depth is linear; tolerate contour antialiasing but do not
      // bleed in front of a nearer tower. The mask unions all faces of this ID.
      composite.uniforms.depthSlop.value = 1.2 / (camera.far - camera.near);
      try {
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = true;
        renderer.shadowMap.enabled = false;
        world.overrideMaterial = mask;
        renderer.render(world, camera);
        renderer.setRenderTarget(passBefore);
        renderer.autoClear = false;
        renderer.render(overlay, overlayCamera);
      } finally {
        world.overrideMaterial = overrideBefore;
        renderer.setClearColor(background, clearAlpha);
        renderer.setRenderTarget(passBefore);
        renderer.shadowMap.enabled = shadowBefore;
        renderer.autoClear = autoClear;
      }
    },
    dispose() {
      target.dispose();
      mask.dispose();
      composite.dispose();
      quadGeometry.dispose();
    },
  };
}
