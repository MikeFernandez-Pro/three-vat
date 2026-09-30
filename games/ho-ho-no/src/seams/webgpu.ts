// The renderer seam on WebGPURenderer, in TSL. WebGPURenderer falls back to
// its own WebGL 2 backend where there is no WebGPU, so this module runs
// everywhere that one does.
//
// WebGPU draws a point one pixel wide whatever the shader asks, so the snow
// and the bursts are instanced sprites: a quad per flake.
//
// The crowds are the library's TSL decode path: the toon node material with
// the decode as its `positionNode`, which the shadow pass reads as well.
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Color,
  InstancedBufferAttribute,
  LinearToneMapping,
  PCFShadowMap,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  Sprite,
  VSMShadowMap,
  type InstancedMesh,
  type Texture,
} from 'three'
import type { Inspector } from 'three/examples/jsm/inspector/Inspector.js'
import type { VAT, VATInstance, VATPlaybackTexture } from 'three-vat'
import { createVATMesh, getMaxTextureSize, vatNodes, type VATTimeUniform } from 'three-vat/tsl'
import { MeshToonNodeMaterial, PointsNodeMaterial, RenderPipeline, WebGPURenderer, type Node } from 'three/webgpu'
import {
  Fn,
  distance,
  float,
  instancedBufferAttribute,
  length,
  mix,
  mod,
  modelViewMatrix,
  pass,
  screenUV,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Burst, BurstSpec, RendererSeam, SeamOptions, Snow, SnowSpec, Toon } from '../seam'

const CLEAR_COLOR = '#cbe1f7'

/**
 * The original's scene-wide look, as uniforms: one page draws one camp, and
 * the debug panel tunes them live, as the original's did.
 */
const LOOK = {
  vignette: { radius: uniform(0.46), softness: uniform(1), darkness: uniform(1), color: uniform(new Color('#5ebaf8')) },
  floor: { color1: uniform(new Color('#d0f1ff')), color2: uniform(new Color('#88b0d2')), scale: uniform(4) },
  snow: { color: uniform(new Color()), fadeNear: uniform(0), fadeFar: uniform(0) },
}

export async function createSeam({ canvas, scene, camera, width, height, pixelRatio, softShadows, debug }: SeamOptions): Promise<RendererSeam> {
  const renderer = new WebGPURenderer({ canvas, antialias: true })
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = softShadows ? VSMShadowMap : PCFShadowMap
  renderer.setClearColor(CLEAR_COLOR)
  // three's own inspector, downloaded only when asked for: its frame timings,
  // console and viewer, and a parameters tab the panel's groups go in.
  const inspector = debug ? new (await import('three/examples/jsm/inspector/Inspector.js')).Inspector() : null
  if (inspector) renderer.inspector = inspector
  await renderer.init()
  // The frame's cost first, where the panel opens; the look's folders under it.
  const countFrame = inspector ? inspectFrame(inspector, renderer) : null
  if (inspector) inspectLook(inspector, renderer)

  // The scene pass, the vignette, then the pipeline's own tone mapping and
  // sRGB output.
  const scenePass = pass(scene, camera, { samples: pixelRatio <= 1 ? 4 : 0 })
  const pipeline = new RenderPipeline(renderer)
  pipeline.outputNode = vignette(scenePass.getTextureNode())

  const setSize = (width: number, height: number, pixelRatio: number) => {
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
  }
  setSize(width, height, pixelRatio)

  // One clock for both crowds, and the ceiling their playback textures count against.
  const vatTime: VATTimeUniform = uniform(0)
  const maxTextureSize = getMaxTextureSize(renderer)
  const toon = ({ map, gradientMap }: Toon) => new MeshToonNodeMaterial({ map, gradientMap })

  return {
    inspector,
    backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2',
    toonMaterial: toon,
    floorMaterial,
    vatTime,
    maxTextureSize,
    dressHorde: (mesh: InstancedMesh, vat: VAT, playback: VATPlaybackTexture, look: Toon) => {
      // Told its carrier, the decode reads each instance's row at its instance
      // index, and re-applies the instance matrix itself.
      const material = toon(look)
      material.positionNode = vatNodes(vat, { time: vatTime, playback, carrier: mesh }).positionNode
      mesh.material = material
    },
    vatCrowd: (vat: VAT, instances: VATInstance[], look: Toon) =>
      createVATMesh({ ...vat, materials: vat.materials.map(() => toon(look)) }, instances, {
        time: vatTime,
        maxTextureSize,
      }),
    snow: (spec) => {
      const made = snow(spec)
      if (inspector) inspectSnow(inspector)
      return made
    },
    burst,
    setAnimationLoop: (frame) => void renderer.setAnimationLoop(frame),
    render: () => {
      pipeline.render()
      countFrame?.()
    },
    setSize,
  }
}

/** The original's debug folders for what the seam owns from the start: the renderer, the vignette and the floor. */
function inspectLook(inspector: Inspector, renderer: WebGPURenderer): void {
  const tones = inspector.createParameters('Renderer')
  const toneMappings = {
    None: NoToneMapping,
    Linear: LinearToneMapping,
    Reinhard: ReinhardToneMapping,
    ACESFilmic: ACESFilmicToneMapping,
    AgX: AgXToneMapping,
    Neutral: NeutralToneMapping,
  }
  // The pipeline notices a new tone mapping on its own and rebuilds its output.
  tones.add(renderer, 'toneMapping', toneMappings).name('tone mapping')
  tones.add(renderer, 'toneMappingExposure', 0, 3, 0.01).name('exposure')

  const { vignette, floor } = LOOK
  const edge = inspector.createParameters('Vignette')
  edge.add(vignette.radius, 'value', -1, 1, 0.001).name('radius')
  edge.add(vignette.softness, 'value', 0, 1, 0.001).name('softness')
  edge.add(vignette.darkness, 'value', 0, 1, 0.001).name('darkness')
  edge.addColor(vignette.color, 'value').name('color')

  const ground = inspector.createParameters('Floor')
  ground.addColor(floor.color1, 'value').name('color 1')
  ground.addColor(floor.color2, 'value').name('color 2')
  ground.add(floor.scale, 'value', 0, 100, 0.001).name('scale')
}

/**
 * What the frame just drawn cost, off `renderer.info`, which the animation
 * loop resets once a frame: every pass counted, the shadow map's, the scene's
 * and the vignette's quad. The snow and the bursts are sprites, so triangles. Copies, so an editor typed in writes nothing back.
 */
function inspectFrame(inspector: Inspector, renderer: WebGPURenderer): () => void {
  const readout = { draws: 0, passes: 0, triangles: 0 }
  const frame = inspector.createParameters('Frame')
  frame.add(readout, 'draws').name('draw calls').listen()
  frame.add(readout, 'passes').name('render passes').listen()
  frame.add(readout, 'triangles').listen()
  return () => {
    const { drawCalls, frameCalls, triangles } = renderer.info.render
    Object.assign(readout, { draws: drawCalls, passes: frameCalls, triangles })
  }
}

/** The snow's folder, once there is snow: the panel shows the values its spec gave it. */
function inspectSnow(inspector: Inspector): void {
  const { snow } = LOOK
  const flakes = inspector.createParameters('Snow')
  flakes.addColor(snow.color, 'value').name('color')
  flakes.add(snow.fadeNear, 'value', -50, 150, 0.1).name('fade near')
  flakes.add(snow.fadeFar, 'value', -50, 150, 0.1).name('fade far')
}

function vignette(sceneColor: Node<'vec4'>) {
  const { radius, softness, darkness, color } = LOOK.vignette
  return Fn(() => {
    // An ellipse fitted to the screen, the corners at 1.
    const d = length(screenUV.sub(0.5)).div(Math.SQRT1_2)
    const edge = smoothstep(radius, radius.add(softness.max(1e-5)), d)
    const amount = mix(1, darkness.oneMinus(), edge)
    return vec4(mix(color, sceneColor.rgb, amount), 1)
  })()
}

function floorMaterial(noise: Texture): MeshToonNodeMaterial {
  const { color1, color2, scale } = LOOK.floor
  const floorUv = uv().mul(scale)
  // Two reads of the voronoi, half a tile apart; their sum runs past 1, and
  // the unclamped mix past the second colour is part of the look.
  const amount = texture(noise, floorUv).r.add(texture(noise, floorUv.add(vec2(0, 0.5))).r)
  const material = new MeshToonNodeMaterial()
  material.colorNode = vec4(mix(color1, color2, amount), 1)
  return material
}

function snow(spec: SnowSpec): Snow {
  const start = instancedBufferAttribute<'vec3'>(new InstancedBufferAttribute(spec.positions, 3), 'vec3')
  const scale = instancedBufferAttribute<'float'>(new InstancedBufferAttribute(spec.scales, 1), 'float')
  const movement = instancedBufferAttribute<'float'>(new InstancedBufferAttribute(spec.movements, 1), 'float')
  const time = uniform(0)
  const speed = float(spec.speed)

  const flake = Fn(() => {
    // Fall, looping over a 22-unit column, and swirl sideways.
    const y = mod(start.y.sub(time.mul(speed).mul(scale)).add(2), 22).sub(2)
    const x = start.x.add(sin(time.mul(speed).add(movement.mul(10))).mul(0.2))
    return vec3(x, y, start.z)
  })()
  const depth = modelViewMatrix.mul(vec4(flake, 1)).z.negate()

  const material = new PointsNodeMaterial({ transparent: true, depthWrite: false })
  material.alphaToCoverage = false
  material.positionNode = flake
  // The original's `gl_PointSize` scaled by the drawing buffer's height;
  // three's size attenuation scales a sprite by half of it, hence the 2.
  material.sizeNode = scale.mul(spec.size * 2)
  const { color, fadeNear, fadeFar } = LOOK.snow
  color.value.copy(spec.color)
  fadeNear.value = spec.fadeNear
  fadeFar.value = spec.fadeFar
  material.colorNode = color
  material.opacityNode = disc(0.5).mul(varying(smoothstep(fadeNear, fadeFar, depth)))

  const object = new Sprite(material)
  object.count = spec.scales.length
  object.frustumCulled = false
  return {
    object,
    update: (seconds) => {
      time.value = seconds
    },
  }
}

function burst(spec: BurstSpec): Burst {
  const directions = new InstancedBufferAttribute(spec.positions, 3)
  const scales = new InstancedBufferAttribute(spec.scales, 1)
  const tints = new InstancedBufferAttribute(spec.tints, 3)
  const direction = instancedBufferAttribute<'vec3'>(directions, 'vec3')
  const scale = instancedBufferAttribute<'float'>(scales, 'float')
  const tint = instancedBufferAttribute<'vec3'>(tints, 'vec3')
  const progress = uniform(0)

  const material = new PointsNodeMaterial({ transparent: true, depthWrite: false })
  material.alphaToCoverage = false
  // Out from the centre, up or down, and smaller as it goes.
  material.positionNode = direction.mul(progress.mul(spec.spread)).add(vec3(0, progress.mul(spec.rise), 0))
  material.sizeNode = scale.mul(progress.oneMinus()).mul(spec.size * 2)
  const inside = disc(0.25)
  material.colorNode = tint.mul(inside)
  material.opacityNode = inside

  const object = new Sprite(material)
  object.count = spec.scales.length
  object.frustumCulled = false
  return {
    object,
    setProgress: (value) => {
      progress.value = value
    },
    refresh: () => {
      directions.needsUpdate = true
      scales.needsUpdate = true
      tints.needsUpdate = true
    },
  }
}

/** 1 inside a disc of `radius` about the sprite's centre, 0 outside: a hard edge, as `step` gives. */
function disc(radius: number) {
  return step(distance(uv(), vec2(0.5)), float(radius))
}
