// The ground: one flat plane under a tiled, hand-painted floor and its normal
// map, `public/textures/floor.png` and `floor-normal.png`, one set of
// coordinates reading both; or earth, `ground.png` and `ground-normal.png`,
// which the woods start on; or painted dirt, `dirt.png`, on a flat normal map; or one of the hand-painted stylized sets
// in `floors/`, the goose game's, which starts on the grass. The panel's floor folder picks which, and sets how light it is,
// how saturated, which way its hue turns, how big a tile is on the ground, which way it is turned, and how deep its relief,
// through uniforms, so a slider recompiles nothing. In the goose game the old road (road.ts) is laid over it in stone,
// its slabs laid along it and across, so they follow it round its bends.
import { Color, DataTexture, DataUtils, FloatType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Mesh, NearestFilter, RGFormat, RGBAFormat, Vector4, type Node, NoColorSpace, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, Vector3, type Texture } from 'three/webgpu'
import { abs, cameraViewMatrix, clamp, dot, float, hue, ivec2, max, min, mix, mx_noise_float, normalWorld, positionWorld, pow, renderGroup, saturation, smoothstep, step, texture, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { SHORE_FIELD, SHORE_REACH, type ShoreField } from './pond'
import { ROAD_REACH, type RoadField } from './road'
import { ShellToonMaterial } from './shell'
import { createStrokes } from './strokes'

/** How far the plane runs from the centre: past the largest arena, into the fog. */
const EXTENT = 60

/** A hand-painted set's colour and normal map, in public/textures/floors/`set`/. */
const handPainted = (set: string) => ({ map: `./textures/floors/${set}/color.webp`, normals: `./textures/floors/${set}/normal.webp` })

/** The floors there are: each a painting and its normal map, in public/textures. */
export const FLOORS = {
  flagstones: { map: './textures/floor.png', normals: './textures/floor-normal.png' },
  earth: { map: './textures/ground.png', normals: './textures/ground-normal.png' },
  // Painted dirt, leaves, twigs, stones and moss: it came with no normal map, so its own is flat.
  dirt: { map: './textures/dirt.png', normals: './textures/dirt-normal.png' },
  // The goose game's hand-painted sets, 2026-10-21, the only floors its folder offers: the Stylized_GrassAndDirt pack's
  // colour and OpenGL normal maps, cut from 4096 to 2048, then to 1024 in WebP (2026-10-30). Its plain starts on the grass.
  stylized_grass_01: handPainted('stylized_grass_01'),
  stylized_dirt_01: handPainted('stylized_dirt_01'),
  stylized_sand_01: handPainted('stylized_sand_01'),
  stylized_stones_02: handPainted('stylized_stones_02'),
}
export type FloorName = keyof typeof FLOORS
/** The floors the goose game's folder offers: the stylized sets. */
export const STYLIZED_FLOORS = (Object.keys(FLOORS) as FloorName[]).filter((name) => name.startsWith('stylized_'))

/** What the floor folder edits. */
export interface FloorLook {
  /** Which floor is laid. */
  texture: FloorName
  /** Brightness, as a multiplier: 1 the painting's own, less darker, more lighter. */
  lightness: number
  /** Colour strength: 1 the painting's own, 0 grey, more richer. */
  saturation: number
  /** How far round the colour wheel its colours turn, degrees: 0 the painting's own. */
  hue: number
  /** How wide one tile of the floor is on the ground, in metres. */
  scale: number
  /** How deep the relief: 1 the normal map as painted, 0 flat, more steeper. */
  relief: number
  /** How far the tiles are turned on the ground, degrees: 0 as painted. */
  rotation: number
}

export interface Floor {
  readonly mesh: Mesh
  /** Its shell, the same material as the rats': the floor folder's shading and toon steps. */
  readonly material: ShellToonMaterial
  /** Take the floor folder's values. */
  set(look: FloorLook): void
  /** Take the bed's values, where the floor has one: nothing otherwise. */
  setBed(look: BedLook): void
  /** Where the water lies, m, for the bed under it to take less light: nothing where the floor has no bed. */
  setWaterLevel(level: number): void
  /** Where the pond's shore is, for the bed's beach to reach out past it: nothing where the floor has no bed. */
  setShore(field: ShoreField): void
  /** Take the values of the ground under the wells, where the floor has it: nothing otherwise. */
  setWellGround(look: WellGroundLook): void
  /** Where the wells stand, m, the first WELLS of them, for the ground under them: nothing where the floor has none. */
  setWells(wells: readonly { x: number; z: number }[]): void
  /** Take the road's values, where the floor has one: nothing otherwise. */
  setRoadLook(look: RoadLook): void
  /** Where the road runs, for its stones: nothing where the floor has no road. */
  setRoad(field: RoadField): void
}

/** The road's stones: a stone set's colour, normal and height maps, the height a 16-bit PNG, which WebP cannot hold. */
const ROAD_SET = './textures/surfaces/stone_wall_01'
const ROAD_FILES = ['color.webp', 'normal.webp', 'height.png']
/** The lowest and the highest of its height map, as read: the joints and the tops of the slabs. */
const ROAD_LOW = 0.3
const ROAD_HIGH = 0.73
/** How light its joints are, linear, from where they start to where they are all joint: the slabs are darker. */
const JOINT_FROM = 0.5
const JOINT_TO = 0.62

/**
 * The old road (road.ts) on the floor: slabs of stone where the road is, the
 * dirt in their joints, each slab sinking into the dirt from its edges in, its
 * low edges first, as less of the road is left, broken up in patches by the
 * noise.
 */
export interface RoadLook {
  /** How wide the road is, m, and how far past that its edge fades, m. */
  width: number
  edge: number
  /** How far the noise moves its edge in and out, m, and how wide one of its patches is, m. */
  wobble: number
  patchSize: number
  /** How much a slab's height keeps it, its edges going first; and how much the noise's patches take or leave of it. */
  breakup: number
  patches: number
  /** The stones' own painting, as the floor's, but laid along the road: their tiles turned by `rotation` from its way. */
  lightness: number
  saturation: number
  hue: number
  scale: number
  rotation: number
  relief: number
}

/** The road as first laid, 2026-10-24, set again on 2026-10-25: a path's width of grey-blue slabs laid crosswise, deep in relief, dimmed and muted to sit in the dirt, half again as big as painted. */
export function defaultRoadLook(): RoadLook {
  return { width: 1.05, edge: 0.5, wobble: 0.35, patchSize: 1.6, breakup: 2.2, patches: 0.3, lightness: 0.55, saturation: 0.55, hue: 0, scale: 2.4, rotation: 90, relief: 3 }
}

/** How many wells the floor lays its ground under. */
export const WELLS = 4

/**
 * The ground under a well (gooseplay.ts): another set, the grass, all of it out
 * to a reach round the well's middle, fading into the floor past it along a
 * line the noise wavers, broken up by the two paintings, as the pond's beach is.
 */
export interface WellGroundLook {
  /** Which set is laid under the well. */
  texture: FloorName
  /** How far its middle is off the well's, m, along x and z. */
  x: number
  z: number
  /** How far out from its middle it is all of it, m, and how much further on it fades into the floor, m. */
  radius: number
  fade: number
  /** How far it reaches along x and along z, as a share of the radius: 1 round. */
  scaleX: number
  scaleZ: number
  /** How far the noise moves its edge in and out, m, and how wide one of its wavers is, m. */
  wobble: number
  wobbleSize: number
  /** How much the two paintings break the fade up, as the bed's breakup: 0 a plain cross-fade. */
  breakup: number
  /** Its own painting, as the bed's. */
  lightness: number
  saturation: number
  hue: number
  scale: number
  rotation: number
  relief: number
}

/** The ground under the well: stone, as the panel set it on 2026-10-25 (where and how far out, 2026-10-26), dark and warm, on a narrow oval fading into the dirt. */
export function defaultWellGroundLook(): WellGroundLook {
  return {
    texture: 'stylized_stones_02',
    x: 0.15,
    z: -0.1,
    radius: 3.4,
    fade: 2.55,
    scaleX: 0.6,
    scaleZ: 0.7,
    wobble: 0.8,
    wobbleSize: 1.51,
    breakup: 0.35,
    lightness: 0.36,
    saturation: 1.28,
    hue: -2,
    scale: 3.2,
    rotation: 8,
    relief: 1.65,
  }
}

/**
 * The bed under the floor's level, a pond's (pond.ts): another set, faded in
 * by how far below the floor the ground is, along a line the noise wavers, so
 * the grass gives way to sand down the bank.
 */
export interface BedLook {
  /** Which set the bed is laid with. */
  texture: FloorName
  /** How far below the floor the fade starts, m, and where it is all bed, m. */
  from: number
  to: number
  /** How far the noise moves the fade up and down the bank, m, and how wide one of its wavers is, m. */
  wobble: number
  wobbleSize: number
  /**
   * The beach: how far out past the shore the bed reaches onto the floor, m, fading into it on the way, 0 none, the
   * bed then only down the bank; and how far the noise moves its edge in and out, m.
   */
  beach: number
  beachWobble: number
  /** How far up from the pond's island's waterline its sand reaches, m, fading into the grass on its top; 0 none. */
  islandBeach: number
  /**
   * How much the two paintings break the fade up, by which is lighter where:
   * 0 a plain cross-fade, more the grass giving way first where it is dark,
   * the sand last where it is, so tufts stand into the sand.
   */
  breakup: number
  /**
   * The bed's own painting, apart from the floor's, as the floor folder sets the floor's: how light, how saturated,
   * which way its hue turns, degrees, how wide a tile is, m, which way its tiles are turned, degrees, and how deep
   * its relief, 1 as painted.
   */
  lightness: number
  saturation: number
  hue: number
  scale: number
  rotation: number
  relief: number
  /**
   * The bed's plain colour, and how much of it shows in place of the set's painting, 0 none, 1 all of it, the set's
   * relief kept, as the dead trees' bark and the graves' stone have it.
   */
  colour: number
  plain: number
  /**
   * The water's hold on the light reaching the ground under it, down and back up again: the colour left of white
   * light after a metre of water, the red going first, then the green; and how murky it is, the metres of water that
   * metre counts as, 0 clear.
   */
  underwater: number
  murk: number
}

/** The pond's bed: sand from the shore down, all sand at the water, the line wavering and broken up by the grass. */
export function defaultBedLook(): BedLook {
  // Set from the panel on 2026-10-21: all sand 0.39 m down, the line wavering wide and broken up hard, a beach 2 m
  // out past the shore, its edge plain, a dim, muted, deep-relief sand on turned tiles, the water barely murky.
  return {
    texture: 'stylized_sand_01',
    from: 0.02,
    to: 0.385,
    wobble: 0.215,
    wobbleSize: 3.45,
    beach: 2,
    beachWobble: 0,
    islandBeach: 0.8,
    breakup: 3.1,
    lightness: 0.61,
    saturation: 0.52,
    hue: 4,
    scale: 2.5,
    rotation: 28,
    relief: 2.79,
    // The sand's plain colour alone since 2026-10-27, its normal map kept: the painting's own, as dimmed and muted, on average.
    colour: 0x856655,
    plain: 1,
    underwater: 0x2f7f9a,
    murk: 0.12,
  }
}

/** How light a colour is, by the eye's weights. */
const LUMA = vec3(0.2126, 0.7152, 0.0722)
/** How deep below the floor the bed may first show, m: the floor itself never takes it, however the line wavers. */
const BED_STARTS = 0.01

/** Each floor's painting and normal map, loaded once asked for, kept after: the floor's, or the grass at the dead trees' feet (deadtrees.ts). */
const loaded = new Map<FloorName, Promise<[Texture, Texture]>>()
export function load(name: FloorName): Promise<[Texture, Texture]> {
  let pair = loaded.get(name)
  if (!pair) {
    const loader = new TextureLoader()
    pair = Promise.all([loader.loadAsync(FLOORS[name].map), loader.loadAsync(FLOORS[name].normals)]).then(([map, normals]) => {
      tile(map).colorSpace = SRGBColorSpace
      tile(normals).colorSpace = NoColorSpace
      return [map, normals]
    })
    loaded.set(name, pair)
  }
  return pair
}

/**
 * The floor, laid with `start`. With `slopes`, its map's relief leans off the
 * surface's own normal, not straight up, so a bank in its material (pond.ts)
 * is lit as it slopes; a flat floor looks the same either way. With `bed`, the
 * ground below the floor's level fades to the bed's set (`BedLook`); without,
 * the floor reads nothing more. With `wellGround`, the ground round each well
 * (`setWells`) fades to its set (`WellGroundLook`), under the bed's.
 */
export async function floor(
  start: FloorName = 'flagstones',
  {
    slopes = false,
    bed,
    wellGround,
    road,
  }: {
    slopes?: boolean
    bed?: BedLook
    wellGround?: WellGroundLook
    road?: RoadLook
  } = {},
): Promise<Floor> {
  const [map, normals] = await load(start)
  const bedSet = bed && (await load(bed.texture))
  const wellSet = wellGround && (await load(wellGround.texture))
  const roadSet = road && (await loadRoad())
  /** The floor laid, and the one last asked for: a newer ask while one loads wins. */
  let asked = start

  const lightness = uniform(1)
  const saturated = uniform(1)
  const turned = uniform(0)
  const scale = uniform(1)
  const relief = uniform(1)
  /** The turn's cosine and sine. */
  const turn = uniform(new Vector2(1, 0))

  // The world's x and z turned by the rotation, then scaled to the tile.
  const ground = positionWorld.xz
  const at = vec2(ground.x.mul(turn.x).sub(ground.y.mul(turn.y)), ground.x.mul(turn.y).add(ground.y.mul(turn.x))).div(scale)
  // The map's normal leans east in its red and up the image in its green, its
  // blue out of the floor; up the image is +z on the ground, since the
  // coordinates are the world's x and z, turned back by the rotation. Relief scales the lean.
  const normalTexel = texture(normals, at)
  const colourTexel = texture(map, at)
  // The bed's values, a uniform of the render's group each, since the floor is a still mesh.
  const bedFrom = uniform(0).setGroup(renderGroup)
  const bedTo = uniform(1).setGroup(renderGroup)
  const bedWobble = uniform(0).setGroup(renderGroup)
  const bedWobbleSize = uniform(1).setGroup(renderGroup)
  const bedBreakup = uniform(0).setGroup(renderGroup)
  const beach = uniform(0).setGroup(renderGroup)
  const beachWobble = uniform(0).setGroup(renderGroup)
  const islandBeach = uniform(0).setGroup(renderGroup)
  // The shore's distances, and in green the island's, half floats, filtered, so the beach's edge is smooth between
  // texels; far past any shore and off any island until the pond lays its own. Where on the floor they lie: the
  // square's corner, and one over its width and depth.
  const shoreTexels = new Uint16Array(SHORE_FIELD * SHORE_FIELD * 2)
  for (let k = 0; k < SHORE_FIELD * SHORE_FIELD; k++) {
    shoreTexels[2 * k] = DataUtils.toHalfFloat(SHORE_REACH)
    shoreTexels[2 * k + 1] = DataUtils.toHalfFloat(-SHORE_REACH)
  }
  const shoreMap = new DataTexture(shoreTexels, SHORE_FIELD, SHORE_FIELD, RGFormat, HalfFloatType)
  shoreMap.magFilter = shoreMap.minFilter = LinearFilter
  shoreMap.needsUpdate = true
  const shoreBox = uniform(new Vector4(0, 0, 1, 1)).setGroup(renderGroup)
  const bedLightness = uniform(1).setGroup(renderGroup)
  const bedSaturated = uniform(1).setGroup(renderGroup)
  const bedTurned = uniform(0).setGroup(renderGroup)
  const bedScale = uniform(1).setGroup(renderGroup)
  const bedRelief = uniform(1).setGroup(renderGroup)
  const bedTurn = uniform(new Vector2(1, 0)).setGroup(renderGroup)
  const bedPlainColour = uniform(new Color()).setGroup(renderGroup)
  const bedPlain = uniform(0).setGroup(renderGroup)
  // As linear channels, the colour turned from the panel's sRGB.
  const underwater = uniform(new Vector3(1, 1, 1)).setGroup(renderGroup)
  const murk = uniform(0).setGroup(renderGroup)
  // Below everything until the pond says where its water is.
  const waterLevel = uniform(-1e6).setGroup(renderGroup)
  // The bed on tiles of its own, turned its own way.
  const bedAt = vec2(ground.x.mul(bedTurn.x).sub(ground.y.mul(bedTurn.y)), ground.x.mul(bedTurn.y).add(ground.y.mul(bedTurn.x))).div(bedScale)
  const bedColourTexel = bedSet && texture(bedSet[0], bedAt)
  const bedNormalTexel = bedSet && texture(bedSet[1], bedAt)
  // How far into the bed the ground is, 0 on the floor, 1 all bed: by its depth below the floor, wavered by the noise,
  // and nothing on the floor itself.
  const depth = max(positionWorld.y.negate(), 0)
  const waver = mx_noise_float(vec3(positionWorld.xz.div(bedWobbleSize), 0))
  const downBank = smoothstep(bedFrom, bedTo, depth.add(waver.mul(bedWobble))).mul(smoothstep(0, BED_STARTS, depth))
  // And out past the shore, onto the floor, by how far it is from the shore, its edge wavering by the same noise:
  // all bed inside the shore, so the beach runs on down the bank. None where there is no beach.
  const shoreAt = shoreBox.zw.mul(positionWorld.xz.sub(shoreBox.xy))
  const shoreTexel = texture(shoreMap, shoreAt)
  const pastShore = shoreTexel.r.add(waver.mul(beachWobble))
  const pondBeach = smoothstep(beach, 0, pastShore).mul(step(0.001, beach))
  // On the island, its own sand up from its waterline into the grass on its top instead: all bed inside the pond's
  // shore but there.
  const onIsland = shoreTexel.g
  const islandSand = smoothstep(islandBeach, 0, onIsland.add(waver.mul(beachWobble))).mul(step(0.001, islandBeach))
  const onBeach = mix(pondBeach, islandSand, step(0, onIsland))
  const fade = max(downBank, onBeach)
  // Broken up by the paintings: where the sand is lighter than the grass it shows sooner, most in the middle of the fade.
  const lighter = bedColourTexel ? dot(bedColourTexel.rgb, LUMA).sub(dot(colourTexel.rgb, LUMA)) : float(0)
  const inBed = clamp(fade.add(lighter.mul(bedBreakup).mul(fade).mul(fade.oneMinus()).mul(4)), 0, 1)
  // The ground under the wells, its values a uniform of the render's group each, as the bed's: each well far off
  // until the play says where it stands.
  const wellSpots = Array.from({ length: WELLS }, () => uniform(new Vector2(1e6, 1e6)).setGroup(renderGroup))
  const wellOffset = uniform(new Vector2(0, 0)).setGroup(renderGroup)
  const wellStretch = uniform(new Vector2(1, 1)).setGroup(renderGroup)
  const wellRadius = uniform(0).setGroup(renderGroup)
  const wellFade = uniform(1).setGroup(renderGroup)
  const wellWobble = uniform(0).setGroup(renderGroup)
  const wellWobbleSize = uniform(1).setGroup(renderGroup)
  const wellBreakup = uniform(0).setGroup(renderGroup)
  const wellLightness = uniform(1).setGroup(renderGroup)
  const wellSaturated = uniform(1).setGroup(renderGroup)
  const wellTurned = uniform(0).setGroup(renderGroup)
  const wellScale = uniform(1).setGroup(renderGroup)
  const wellRelief = uniform(1).setGroup(renderGroup)
  const wellTurn = uniform(new Vector2(1, 0)).setGroup(renderGroup)
  const wellAt = vec2(ground.x.mul(wellTurn.x).sub(ground.y.mul(wellTurn.y)), ground.x.mul(wellTurn.y).add(ground.y.mul(wellTurn.x))).div(wellScale)
  const wellColourTexel = wellSet && texture(wellSet[0], wellAt)
  const wellNormalTexel = wellSet && texture(wellSet[1], wellAt)
  // How far out from the nearest well's middle the ground is, in radii stretched along x and z, its edge wavered by
  // noise of its own size: all of it inside the radius, none past the fade.
  const nearestWell = wellSpots.reduce<Node<'float'>>((near, spot) => min(near, ground.sub(spot.add(wellOffset)).div(wellStretch).length()), float(1e6))
  const wellWaver = mx_noise_float(vec3(ground.div(wellWobbleSize), 7.3))
  const wellFadeIn = smoothstep(wellRadius.add(wellFade), wellRadius, nearestWell.add(wellWaver.mul(wellWobble)))
  // Broken up by the paintings, as the bed's fade is.
  const wellLighter = wellColourTexel ? dot(wellColourTexel.rgb, LUMA).sub(dot(colourTexel.rgb, LUMA)) : float(0)
  const inWell = clamp(wellFadeIn.add(wellLighter.mul(wellBreakup).mul(wellFadeIn).mul(wellFadeIn.oneMinus()).mul(4)), 0, 1)
  /** How a map's normal leans on the ground, its texture's x and y running `u` and `v` on it, scaled by its relief; and its height out of the floor. */
  const leanAlong = (texel: Node<'vec4'>, u: Node<'vec2'>, v: Node<'vec2'>, deep: typeof relief) => {
    const mapped = texel.xyz.mul(2).sub(1)
    const x = mapped.x.mul(u.x).add(mapped.y.mul(v.x))
    const z = mapped.x.mul(u.y).add(mapped.y.mul(v.y))
    return { lean: vec3(x.mul(deep), 0, z.mul(deep)), up: mapped.z }
  }
  /** The same, turned back by its tiles' turn on the ground. */
  const leanOf = (texel: Node<'vec4'>, by: typeof turn, deep: typeof relief) => leanAlong(texel, vec2(by.x, by.y.negate()), vec2(by.y, by.x), deep)
  // The road, its values a uniform of the render's group each, as the bed's: nowhere until the play says where it runs.
  const roadMap = texture(roadTexture(new Float32Array([ROAD_REACH, 0, 0, 0]), 1, 1))
  /** The field's corner cell, how many cells a metre, and its last cell's column and row. */
  const roadBox = uniform(new Vector4(0, 0, 1, 0)).setGroup(renderGroup)
  const roadLast = uniform(new Vector2(0, 0)).setGroup(renderGroup)
  const roadHalf = uniform(1).setGroup(renderGroup)
  const roadEdge = uniform(0.5).setGroup(renderGroup)
  const roadWobble = uniform(0).setGroup(renderGroup)
  const roadPatchSize = uniform(1).setGroup(renderGroup)
  const roadBreakup = uniform(0).setGroup(renderGroup)
  const roadPatches = uniform(0).setGroup(renderGroup)
  const roadLightness = uniform(1).setGroup(renderGroup)
  const roadSaturated = uniform(1).setGroup(renderGroup)
  const roadTurned = uniform(0).setGroup(renderGroup)
  const roadScale = uniform(1).setGroup(renderGroup)
  const roadRelief = uniform(1).setGroup(renderGroup)
  const roadTurn = uniform(new Vector2(1, 0)).setGroup(renderGroup)
  // The field between its four nearest cells, mixed here rather than by a sampler, as a float a channel: a half float
  // holds how far along the road to a tenth of a metre up past a hundred, and the slabs would swim.
  const roadCells = clamp(ground.sub(roadBox.xy).mul(roadBox.z), vec2(0), roadLast)
  const roadCell = roadCells.floor()
  const roadBetween = roadCells.sub(roadCell)
  const roadCorner = (x: number, z: number) => roadMap.load(ivec2(min(roadCell.add(vec2(x, z)), roadLast)))
  const [field00, field10, field01, field11] = [roadCorner(0, 0), roadCorner(1, 0), roadCorner(0, 1), roadCorner(1, 1)]
  const roadField = mix(mix(field00, field10, roadBetween.x), mix(field01, field11, roadBetween.x), roadBetween.y)
  // Which way across the road is, as the distance across grows between the cells, and which way along it, square to
  // that; off the road's field, any way.
  const roadAcross = vec2(mix(field10.r.sub(field00.r), field11.r.sub(field01.r), roadBetween.y), mix(field01.r.sub(field00.r), field11.r.sub(field10.r), roadBetween.x))
    .add(vec2(0, 1e-6))
    .normalize()
  const roadAlong = vec2(roadAcross.y, roadAcross.x.negate())
  // The stones laid in the road's own way, along it and across, turned from that by the look's turn: the texture's x
  // and y running so on the ground.
  const roadAt = vec2(roadField.b.mul(roadTurn.x).sub(roadField.r.mul(roadTurn.y)), roadField.b.mul(roadTurn.y).add(roadField.r.mul(roadTurn.x))).div(roadScale)
  const roadU = roadAlong.mul(roadTurn.x).sub(roadAcross.mul(roadTurn.y))
  const roadV = roadAlong.mul(roadTurn.y).add(roadAcross.mul(roadTurn.x))
  const roadColourTexel = roadSet && texture(roadSet[0], roadAt)
  const roadNormalTexel = roadSet && texture(roadSet[1], roadAt)
  const roadHeightTexel = roadSet && texture(roadSet[2], roadAt)
  // How much of the road is here: by how far from its middle, its edge wavered by the noise, and how much of it is
  // left there. A slab keeps by its height, its low edges going first, and in patches by the same noise; its joints
  // are the dirt's, and nothing is laid off the road.
  const roadNoise = mx_noise_float(vec3(ground.div(roadPatchSize), 13.1))
  const onRoad = smoothstep(roadHalf.add(roadEdge), roadHalf, abs(roadField.r).add(roadNoise.mul(roadWobble))).mul(roadField.g)
  const slabHeight = roadHeightTexel ? clamp(roadHeightTexel.r.sub(ROAD_LOW).div(ROAD_HIGH - ROAD_LOW), 0, 1) : float(0.5)
  const keeps = onRoad.mul(slabHeight.sub(0.5).mul(roadBreakup).add(1)).add(roadNoise.mul(roadPatches))
  const joint = roadColourTexel ? smoothstep(JOINT_FROM, JOINT_TO, dot(roadColourTexel.rgb, LUMA)) : float(0)
  const inRoad = smoothstep(0.45, 0.55, keeps).mul(joint.oneMinus()).mul(smoothstep(0, 0.05, onRoad))
  // The floor's lean, the ground's under the wells, the road's and the bed's, each by its own turn and relief, blended as each fades in.
  const plainLean = leanOf(normalTexel, turn, relief)
  const wellLean = wellNormalTexel && leanOf(wellNormalTexel, wellTurn, wellRelief)
  const groundLean = wellLean ? { lean: mix(plainLean.lean, wellLean.lean, inWell), up: mix(plainLean.up, wellLean.up, inWell) } : plainLean
  const roadLean = roadNormalTexel && leanAlong(roadNormalTexel, roadU, roadV, roadRelief)
  const pavedLean = roadLean ? { lean: mix(groundLean.lean, roadLean.lean, inRoad), up: mix(groundLean.up, roadLean.up, inRoad) } : groundLean
  const bedLean = bedNormalTexel && leanOf(bedNormalTexel, bedTurn, bedRelief)
  const lean = bedLean ? mix(pavedLean.lean, bedLean.lean, inBed) : pavedLean.lean
  const up = bedLean ? mix(pavedLean.up, bedLean.up, inBed) : pavedLean.up
  const world = (slopes ? normalWorld.mul(up).add(lean) : vec3(lean.x, up, lean.z)).normalize()
  // The shell paints its strokes over the map's normal, as the camera sees it; a stroke's density counts per metre.
  const material = new ShellToonMaterial({
    painted: { strokes: createStrokes(), extent: 1, base: cameraViewMatrix.mul(vec4(world, 0)).xyz.normalize() },
  })
  const plainColour = saturation(hue(colourTexel.rgb, turned), saturated).mul(lightness)
  const wellColour = wellColourTexel && saturation(hue(wellColourTexel.rgb, wellTurned), wellSaturated).mul(wellLightness)
  const groundColour = wellColour ? mix(plainColour, wellColour, inWell) : plainColour
  const roadColour = roadColourTexel && saturation(hue(roadColourTexel.rgb, roadTurned), roadSaturated).mul(roadLightness)
  const pavedColour = roadColour ? mix(groundColour, roadColour, inRoad) : groundColour
  // Under the water the ground takes less of the light, by the Beer-Lambert law: what is left of each colour after
  // the way down to it and back up, twice its depth under the surface, the red going first. Its colour is what the
  // light makes of, so the light on it, the torch's and the moon's, is held back as the water would hold it.
  const underWater = max(waterLevel.sub(positionWorld.y), 0)
  const held = pow(underwater, vec3(underWater.mul(2).mul(murk)))
  const bedColour = bedColourTexel && mix(saturation(hue(bedColourTexel.rgb, bedTurned), bedSaturated).mul(bedLightness), bedPlainColour, bedPlain)
  material.colorNode = bedColour ? mix(pavedColour, bedColour, inBed).mul(held) : pavedColour
  /** The bed laid, and the one last asked for; the same for the ground under the wells. */
  let bedAsked = bed?.texture
  let wellAsked = wellGround?.texture

  const mesh = new Mesh(new PlaneGeometry(EXTENT * 2, EXTENT * 2), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  const laid: Floor = {
    mesh,
    material,
    set(look) {
      lightness.value = look.lightness
      saturated.value = look.saturation
      turned.value = (look.hue * Math.PI) / 180
      scale.value = Math.max(0.05, look.scale)
      relief.value = look.relief
      const angle = (look.rotation * Math.PI) / 180
      turn.value.set(Math.cos(angle), Math.sin(angle))
      // Another floor: its textures swapped into the same nodes once loaded, so nothing recompiles.
      if (look.texture !== asked) {
        const name = (asked = look.texture)
        void load(name).then(([newMap, newNormals]) => {
          if (asked !== name) return
          colourTexel.value = newMap
          normalTexel.value = newNormals
        })
      }
    },
    setWaterLevel() {},
    setShore() {},
    setRoadLook(look) {
      if (!roadSet) return
      roadHalf.value = Math.max(0, look.width / 2)
      roadEdge.value = Math.max(0.01, look.edge)
      roadWobble.value = look.wobble
      roadPatchSize.value = Math.max(0.05, look.patchSize)
      roadBreakup.value = look.breakup
      roadPatches.value = look.patches
      roadLightness.value = look.lightness
      roadSaturated.value = look.saturation
      roadTurned.value = (look.hue * Math.PI) / 180
      roadScale.value = Math.max(0.05, look.scale)
      roadRelief.value = look.relief
      const roadAngle = (look.rotation * Math.PI) / 180
      roadTurn.value.set(Math.cos(roadAngle), Math.sin(roadAngle))
    },
    setRoad(field) {
      if (!roadSet) return
      // A texture of the field's own size, swapped into the same node, so nothing recompiles.
      const was = roadMap.value
      roadMap.value = roadTexture(field.data, field.columns, field.rows)
      was.dispose()
      roadBox.value.set(field.minX, field.minZ, 1 / field.cell, 0)
      roadLast.value.set(field.columns - 1, field.rows - 1)
    },
    setWells(wells) {
      if (!wellSet) return
      wellSpots.forEach((spot, k) => spot.value.set(wells[k]?.x ?? 1e6, wells[k]?.z ?? 1e6))
    },
    setWellGround(look) {
      if (!wellColourTexel || !wellNormalTexel) return
      wellOffset.value.set(look.x, look.z)
      wellStretch.value.set(Math.max(0.05, look.scaleX), Math.max(0.05, look.scaleZ))
      wellRadius.value = Math.max(0, look.radius)
      wellFade.value = Math.max(0.01, look.fade)
      wellWobble.value = look.wobble
      wellWobbleSize.value = Math.max(0.01, look.wobbleSize)
      wellBreakup.value = look.breakup
      wellLightness.value = look.lightness
      wellSaturated.value = look.saturation
      wellTurned.value = (look.hue * Math.PI) / 180
      wellScale.value = Math.max(0.05, look.scale)
      wellRelief.value = look.relief
      const wellAngle = (look.rotation * Math.PI) / 180
      wellTurn.value.set(Math.cos(wellAngle), Math.sin(wellAngle))
      if (look.texture !== wellAsked) {
        const name = (wellAsked = look.texture)
        void load(name).then(([newMap, newNormals]) => {
          if (wellAsked !== name) return
          wellColourTexel.value = newMap
          wellNormalTexel.value = newNormals
        })
      }
    },
    setBed(look) {
      if (!bedColourTexel || !bedNormalTexel) return
      bedFrom.value = look.from
      bedTo.value = Math.max(look.from + 0.001, look.to)
      bedWobble.value = look.wobble
      bedWobbleSize.value = Math.max(0.01, look.wobbleSize)
      bedBreakup.value = look.breakup
      beach.value = Math.max(0, look.beach)
      beachWobble.value = look.beachWobble
      islandBeach.value = Math.max(0, look.islandBeach)
      bedLightness.value = look.lightness
      bedSaturated.value = look.saturation
      bedTurned.value = (look.hue * Math.PI) / 180
      bedScale.value = Math.max(0.05, look.scale)
      bedRelief.value = look.relief
      bedPlainColour.value.set(look.colour)
      bedPlain.value = look.plain
      const bedAngle = (look.rotation * Math.PI) / 180
      bedTurn.value.set(Math.cos(bedAngle), Math.sin(bedAngle))
      const left = new Color(look.underwater)
      underwater.value.set(left.r, left.g, left.b)
      murk.value = look.murk
      if (look.texture !== bedAsked) {
        const name = (bedAsked = look.texture)
        void load(name).then(([newMap, newNormals]) => {
          if (bedAsked !== name) return
          bedColourTexel.value = newMap
          bedNormalTexel.value = newNormals
        })
      }
    },
  }
  laid.setWaterLevel = (level) => {
    waterLevel.value = level
  }
  laid.setShore = (field) => {
    if (!bed) return
    const texels = shoreMap.image.data as Uint16Array
    for (let k = 0; k < field.data.length; k++) {
      texels[2 * k] = DataUtils.toHalfFloat(field.data[k]!)
      texels[2 * k + 1] = DataUtils.toHalfFloat(field.island[k]!)
    }
    shoreMap.needsUpdate = true
    shoreBox.value.set(field.minX, field.minZ, 1 / field.size, 1 / field.size)
  }
  if (bed) laid.setBed(bed)
  if (wellGround) laid.setWellGround(wellGround)
  if (road) laid.setRoadLook(road)
  return laid
}

/** The road's field as the floor reads it: how far across its middle, how much of it is left and how far along it, floats, read cell by cell. */
function roadTexture(texels: Float32Array, columns: number, rows: number): DataTexture {
  const field = new DataTexture(texels, columns, rows, RGBAFormat, FloatType)
  field.magFilter = field.minFilter = NearestFilter
  field.needsUpdate = true
  return field
}

/** The road's stones: their colour, normal and height maps, loaded once asked for, for the road or anything laid in its stone (arches.ts). */
let roadMaps: Promise<[Texture, Texture, Texture]> | undefined
export function loadRoad(): Promise<[Texture, Texture, Texture]> {
  const loader = new TextureLoader()
  roadMaps ??= Promise.all(ROAD_FILES.map((file) => loader.loadAsync(`${ROAD_SET}/${file}`))).then(([colour, normal, height]) => {
    tile(colour!).colorSpace = SRGBColorSpace
    tile(normal!).colorSpace = NoColorSpace
    tile(height!).colorSpace = NoColorSpace
    return [colour!, normal!, height!]
  })
  return roadMaps
}

/** `texture` set to repeat across the ground, mipmapped and sharp at a slant. */
function tile(texture: Texture): Texture {
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 8
  return texture
}
