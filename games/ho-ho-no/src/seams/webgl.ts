// The renderer seam on WebGLRenderer: GLSL throughout, as the original was
// written. The floor was a three-custom-shader-material, which has no WebGPU
// path; it is a plain `onBeforeCompile` patch of MeshToonMaterial here, and its
// node equivalent on the other side.
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshToonMaterial,
  Points,
  ShaderMaterial,
  Uniform,
  Vector2,
  VSMShadowMap,
  WebGLRenderer,
  WebGLRenderTarget,
  type Texture,
} from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { LOOK, type Burst, type BurstSpec, type RendererSeam, type SeamOptions, type Snow, type SnowSpec } from '../seam'

export async function createSeam({ canvas, scene, camera, width, height, pixelRatio }: SeamOptions): Promise<RendererSeam> {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = VSMShadowMap
  renderer.setClearColor(LOOK.clearColor)

  // The scene renders into a multisampled target — at a pixel ratio of 1,
  // where the canvas's own antialiasing is lost to the composer — then the
  // vignette, then tone mapping and the sRGB conversion in the output pass.
  const target = new WebGLRenderTarget(1, 1, { samples: pixelRatio <= 1 ? 4 : 0 })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const vignette = new ShaderPass(vignetteShader())
  composer.addPass(vignette)
  composer.addPass(new OutputPass())

  // Snow and bursts size their discs against the drawing buffer's height.
  const resolution = new Vector2()

  const setSize = (width: number, height: number, pixelRatio: number) => {
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    composer.setPixelRatio(pixelRatio)
    composer.setSize(width, height)
    resolution.set(width * pixelRatio, height * pixelRatio)
  }
  setSize(width, height, pixelRatio)

  return {
    kind: 'webgl',
    backend: 'WebGL',
    canvas,
    toonMaterial: (map, gradientMap) => new MeshToonMaterial({ map, gradientMap }),
    floorMaterial,
    snow: (spec) => snow(spec, resolution),
    burst: (spec) => burst(spec, resolution),
    setAnimationLoop: (frame) => renderer.setAnimationLoop(frame),
    render: () => composer.render(),
    setSize,
  }
}

function vignetteShader() {
  const { radius, softness, darkness, color } = LOOK.vignette
  return {
    uniforms: {
      tDiffuse: { value: null },
      uRadius: { value: radius },
      uSoftness: { value: softness },
      uDarkness: { value: darkness },
      uColor: { value: new Color(color) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vUv = uv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uRadius;
      uniform float uSoftness;
      uniform float uDarkness;
      uniform vec3 uColor;

      void main() {
        vec3 sceneColor = texture2D(tDiffuse, vUv).rgb;
        // An ellipse fitted to the screen, the corners at 1. The original meant
        // a circle, but set its aspect only on a resize; the game was played
        // with this, so this is the look.
        float d = length(vUv - 0.5) / length(vec2(0.5));
        float edge = smoothstep(uRadius, uRadius + max(uSoftness, 1e-5), d);
        float vignette = mix(1.0, 1.0 - uDarkness, edge);
        gl_FragColor = vec4(mix(uColor, sceneColor, vignette), 1.0);
      }
    `,
  }
}

function floorMaterial(noise: Texture): MeshToonMaterial {
  const { color1, color2, scale } = LOOK.floor
  const material = new MeshToonMaterial()
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNoiseTexture = { value: noise }
    shader.uniforms.uScale = { value: scale }
    shader.uniforms.uColor1 = { value: new Color(color1) }
    shader.uniforms.uColor2 = { value: new Color(color2) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFloorUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFloorUv = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D uNoiseTexture;
        uniform float uScale;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        varying vec2 vFloorUv;`,
      )
      // Two reads of the voronoi, half a tile apart; their sum runs past 1,
      // and the unclamped mix past the second colour is part of the look.
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 floorUv = vFloorUv * uScale;
        float floorNoise = texture2D(uNoiseTexture, floorUv).r + texture2D(uNoiseTexture, floorUv + vec2(0.0, 0.5)).r;
        diffuseColor = vec4(mix(uColor1, uColor2, floorNoise), 1.0);`,
      )
  }
  return material
}

function snow(spec: SnowSpec, resolution: Vector2): Snow {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(spec.positions, 3))
  geometry.setAttribute('aScale', new BufferAttribute(spec.scales, 1))
  geometry.setAttribute('aMovement', new BufferAttribute(spec.movements, 1))

  const time = new Uniform(0)
  const material = new ShaderMaterial({
    uniforms: {
      uSize: { value: spec.size },
      uSpeed: { value: spec.speed },
      uResolution: { value: resolution },
      uTime: time,
      uColor: { value: spec.color },
      uFadeNear: { value: spec.fadeNear },
      uFadeFar: { value: spec.fadeFar },
    },
    vertexShader: /* glsl */ `
      uniform float uSize;
      uniform float uSpeed;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uFadeNear;
      uniform float uFadeFar;
      attribute float aScale;
      attribute float aMovement;
      varying float vOpacity;

      void main() {
        vec3 flake = position;
        // Fall, looping over a 22-unit column, and swirl sideways.
        flake.y -= uTime * uSpeed * aScale;
        flake.y = mod(flake.y + 2.0, 22.0) - 2.0;
        flake.x += sin(uTime * uSpeed + aMovement * 10.0) * 0.2;

        vec4 viewPosition = viewMatrix * modelMatrix * vec4(flake, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = uSize * uResolution.y * aScale / -viewPosition.z;
        vOpacity = smoothstep(uFadeNear, uFadeFar, -viewPosition.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vOpacity;

      void main() {
        float disc = 1.0 - step(0.5, distance(gl_PointCoord, vec2(0.5)));
        gl_FragColor = vec4(uColor, disc * vOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  })

  return {
    object: new Points(geometry, material),
    update: (seconds) => {
      time.value = seconds
    },
  }
}

function burst(spec: BurstSpec, resolution: Vector2): Burst {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(spec.positions, 3))
  geometry.setAttribute('aScale', new BufferAttribute(spec.scales, 1))

  const progress = new Uniform(0)
  const material = new ShaderMaterial({
    uniforms: {
      uSize: { value: spec.size },
      uResolution: { value: resolution },
      uColor1: { value: spec.colors[0] },
      uColor2: { value: spec.colors[1] },
      uProgress: progress,
    },
    vertexShader: /* glsl */ `
      uniform float uSize;
      uniform vec2 uResolution;
      uniform float uProgress;
      attribute float aScale;

      void main() {
        // Out from the centre, down, and smaller as it goes.
        vec3 disc = position * uProgress;
        disc.y -= uProgress * 3.0;

        vec4 viewPosition = viewMatrix * modelMatrix * vec4(disc, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = uSize * uResolution.y * aScale * (1.0 - uProgress) / -viewPosition.z;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor1;
      uniform vec3 uColor2;

      void main() {
        float disc = 1.0 - step(0.5, distance(gl_PointCoord, vec2(0.5)) + 0.25);
        vec3 color = mix(uColor1, uColor2, gl_PointCoord.y) * disc;
        gl_FragColor = vec4(color, disc);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  })

  // Reused with a fresh scatter each time, so bounds computed from the first
  // would be wrong for the next; a burst is small and short-lived anyway.
  const object = new Points(geometry, material)
  object.frustumCulled = false
  return {
    object,
    setProgress: (value) => {
      progress.value = value
    },
    refresh: () => {
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.aScale.needsUpdate = true
    },
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}
