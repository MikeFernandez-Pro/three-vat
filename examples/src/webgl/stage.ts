// Everything around the crowd on the WebGL path: renderer, camera, lights,
// ground, environment and fog. Deliberately *not* shared with the WebGPU page
// (ADR-0011) — every line here names `WebGLRenderer` or a material that comes
// with it, and a harness that hid that would hide the one thing a reader came
// to see.
//
// The crowd itself is not built here. This is the room; `webgl_crowd.ts` brings
// the robots.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ColorEnvironment } from "three/addons/environments/ColorEnvironment.js";
import type { DemoParams, EnvPresetName } from "../params.js";

// Every preset is generated procedurally through PMREMGenerator.fromScene, so
// the demo stays asset-free (no .hdr to ship or fetch) and works offline.
const ENV_PRESETS: Record<EnvPresetName, (() => THREE.Scene) | null> = {
  none: null,
  sky: () => gradientEnv("#8ec8ea", "#e8d5b0"),
  sunset: () => gradientEnv("#2b3a67", "#ff8c42"),
  dusk: () => gradientEnv("#1b2140", "#6d4f8c"),
  room: () => new RoomEnvironment(),
  neutral: () => new ColorEnvironment(new THREE.Color(0xbfbfbf)),
};

export const ENV_PRESET_NAMES = Object.keys(ENV_PRESETS) as EnvPresetName[];

// A vertical two-stop gradient sphere — cheap stand-in for a sky HDR.
function gradientEnv(top: string, bottom: string): THREE.Scene {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const env = new THREE.Scene();
  env.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 32),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide }),
    ),
  );
  return env;
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
  ground: THREE.Mesh;
  groundMaterial: THREE.MeshStandardMaterial;
  /**
   * Add a crowd to the scene, and tell the shadow toggle where it is. Once on
   * the demo; once per encoding on an example that bakes both and shows one
   * (ADR-0019) — the hidden crowd takes the toggle too, so it is right when shown.
   */
  setCrowd(crowd: THREE.Mesh): void;
  applyBackground(): void;
  applyEnvironment(): void;
  applyFog(): void;
  applyShadows(): void;
}

/** Build the room: renderer on the page, scene lit, ground down, sky up. */
export function createStage(params: DemoParams): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = params.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // ACES filmic rolls off the directional light's highlights instead of clipping
  // them to white, which matters once an environment map is added on top.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = params.exposure;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, 12, 34);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 0);
  controls.enableDamping = true;
  controls.minDistance = 4;
  controls.maxDistance = params.maxZoom;

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const ambient = new THREE.AmbientLight(new THREE.Color(params.ambientColor), params.ambientIntensity);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(new THREE.Color(params.sunColor), params.sunIntensity);
  sun.position.set(params.sunX, params.sunY, params.sunZ);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -40;
  sun.shadow.camera.right = sun.shadow.camera.top = 40;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const groundMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(params.groundColor),
    roughness: params.groundRoughness,
    metalness: params.groundMetalness,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.visible = params.groundVisible;
  scene.add(ground);

  // The crowds a page builds, once it hands them over — the shadow toggle has
  // to reach them, and nothing else here does.
  const crowds: THREE.Mesh[] = [];

  const fog = new THREE.Fog(params.fogColor, params.fogNear, params.fogFar);
  const pmrem = new THREE.PMREMGenerator(renderer);
  // Hold the render target, not just its texture: the target owns the GPU memory,
  // and disposing only the texture leaks a cubemap per preset switch.
  let envTarget: THREE.WebGLRenderTarget | null = null;

  // Fog does not affect scene.background, so when fog is on the backdrop has to
  // *be* the fog color. Otherwise the env/CSS sky shows through unfogged.
  function applySceneBackground() {
    if (params.fogEnabled) {
      scene.background = fog.color;
      return;
    }
    scene.background = params.envAsBackground && envTarget ? envTarget.texture : null;
  }

  const stage: Stage = {
    renderer,
    scene,
    camera,
    controls,
    ambient,
    sun,
    ground,
    groundMaterial,

    setCrowd(mesh) {
      // Both in one call: a crowd added to the scene but never handed over here
      // would render, and then quietly ignore the shadow toggle.
      crowds.push(mesh);
      scene.add(mesh);
    },

    applyBackground() {
      document.body.style.background = `linear-gradient(to bottom, ${params.bgTop}, ${params.bgBottom})`;
    },

    applyEnvironment() {
      envTarget?.dispose();
      envTarget = null;

      const make = ENV_PRESETS[params.envPreset];
      if (make) {
        const envScene = make();
        envTarget = pmrem.fromScene(envScene);
        // The source scene has served its purpose once the PMREM is generated.
        // RoomEnvironment/ColorEnvironment ship their own dispose(); the gradient
        // scenes are plain Scenes, so walk them by hand.
        const disposable = envScene as THREE.Scene & { dispose?: () => void };
        if (typeof disposable.dispose === "function") {
          disposable.dispose();
        } else {
          envScene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            const mat = mesh.material as THREE.MeshBasicMaterial;
            mat.map?.dispose();
            mat.dispose();
          });
        }
      }

      scene.environment = envTarget ? envTarget.texture : null;
      scene.environmentIntensity = params.envIntensity;
      scene.backgroundIntensity = params.envIntensity;
      applySceneBackground();
    },

    applyFog() {
      fog.color.set(params.fogColor);
      fog.near = Math.min(params.fogNear, params.fogFar);
      fog.far = Math.max(params.fogFar, fog.near + 0.001);
      scene.fog = params.fogEnabled ? fog : null;
      // scene.background is not fogged by the renderer, so paint it with the fog
      // color; otherwise empty pixels (and an env sky) stay crystal clear.
      applySceneBackground();
    },

    /**
     * Toggle the whole shadow pass. Turning it off drops the depth-pass draw
     * calls (one per material group, plus the ground), which is visible live in
     * the draw counter — the point of exposing it.
     *
     * `shadowMap.enabled` is baked into each material's compiled program, so
     * every material has to be flagged for recompile or the flip is silently
     * ignored.
     */
    applyShadows() {
      const on = params.shadows;
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      ground.receiveShadow = on;
      for (const crowd of crowds) {
        crowd.castShadow = on;
        crowd.receiveShadow = on;
      }
      scene.traverse((o) => {
        const material = (o as THREE.Mesh).material;
        if (!material) return;
        for (const m of Array.isArray(material) ? material : [material]) {
          m.needsUpdate = true;
        }
      });
    },
  };

  stage.applyBackground();
  stage.applyEnvironment();
  stage.applyFog();
  return stage;
}
