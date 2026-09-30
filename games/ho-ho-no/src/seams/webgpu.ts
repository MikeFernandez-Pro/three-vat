// The renderer seam on WebGPURenderer, in TSL. WebGPURenderer falls back to
// its own WebGL 2 backend where there is no WebGPU, so this module runs
// everywhere that one does.
//
// WebGPU draws a point one pixel wide whatever the shader asks, so the snow
// and the bursts are instanced sprites: a quad per flake.
//
// The crowds are the library's TSL decode path: the toon node material with
// the decode as its `positionNode`, which the shadow pass reads as well.
import { Color, InstancedBufferAttribute, Sprite, VSMShadowMap, ACESFilmicToneMapping, type BatchedMesh, type Texture } from 'three'
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

/** The original's scene-wide look. */
const LOOK = {
  clearColor: '#cbe1f7',
  vignette: { radius: 0.46, softness: 1, darkness: 1, color: '#5ebaf8' },
  floor: { color1: '#d0f1ff', color2: '#88b0d2', scale: 4 },
} as const

export async function createSeam({ canvas, scene, camera, width, height, pixelRatio }: SeamOptions): Promise<RendererSeam> {
  const renderer = new WebGPURenderer({ canvas, antialias: true })
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = VSMShadowMap
  renderer.setClearColor(LOOK.clearColor)
  await renderer.init()

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
    backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2',
    toonMaterial: toon,
    floorMaterial,
    vatTime,
    maxTextureSize,
    dressBatch: (batch: BatchedMesh, vat: VAT, playback: VATPlaybackTexture, look: Toon) => {
      // Told its carrier, the decode reads each instance's row through the
      // batch's indirect index, and re-applies the batch's own transform.
      const material = toon(look)
      material.positionNode = vatNodes(vat, { time: vatTime, playback, carrier: batch }).positionNode
      batch.material = material
    },
    vatCrowd: (vat: VAT, instances: VATInstance[], look: Toon) =>
      createVATMesh({ ...vat, materials: vat.materials.map(() => toon(look)) }, instances, {
        time: vatTime,
        maxTextureSize,
      }),
    snow,
    burst,
    setAnimationLoop: (frame) => void renderer.setAnimationLoop(frame),
    render: () => pipeline.render(),
    setSize,
  }
}

function vignette(sceneColor: Node<'vec4'>) {
  const { radius, softness, darkness, color } = LOOK.vignette
  return Fn(() => {
    // An ellipse fitted to the screen, the corners at 1.
    const d = length(screenUV.sub(0.5)).div(Math.SQRT1_2)
    const edge = smoothstep(radius, radius + Math.max(softness, 1e-5), d)
    const amount = mix(1, 1 - darkness, edge)
    return vec4(mix(uniform(new Color(color)), sceneColor.rgb, amount), 1)
  })()
}

function floorMaterial(noise: Texture): MeshToonNodeMaterial {
  const { color1, color2, scale } = LOOK.floor
  const floorUv = uv().mul(scale)
  // Two reads of the voronoi, half a tile apart; their sum runs past 1, and
  // the unclamped mix past the second colour is part of the look.
  const amount = texture(noise, floorUv).r.add(texture(noise, floorUv.add(vec2(0, 0.5))).r)
  const material = new MeshToonNodeMaterial()
  material.colorNode = vec4(mix(uniform(new Color(color1)), uniform(new Color(color2)), amount), 1)
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
  material.colorNode = uniform(spec.color)
  material.opacityNode = disc(0.5).mul(varying(smoothstep(spec.fadeNear, spec.fadeFar, depth)))

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
