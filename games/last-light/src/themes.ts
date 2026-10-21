// The sewers' themes (2026-10-12): four moods for the same tunnel, each a
// whole palette laid over the page's under `#sewers`, picked in the corridor
// folder; each from a group of reference paintings. The rule they
// share, from those: the frame in one hue family, the stone, the fog, the
// fill and the creases its values from dark to mid; the light pale, near
// white, leaning to the family and never yellow; one accent against it all,
// the pumpkin's orange where the paintings have rust; the rats dark
// silhouettes in the family's darkest value, their eyes the one bright point
// on them. Also shared: no moon and no shadows from it, the dome shutting out
// the sky; no bloom; the stone in the toon shell with a small hard glint and
// a lifted shade; a slow mist in the fog's ring; and a torch whose lamp
// fades with distance, brightest at the flame and gone into the fill a few
// metres out, never a flat, burnt-out pool (after a play-test, 2026-10-12: the torch
// glowed far too much at full strength to its edge). A theme is a mood, never a
// material: the stone's texture (stone_wall_01, a pale blue stone the hue
// turns into the family) and its tiling stay whatever the surface folder holds.
import type { Look } from './panel'

export interface SewerTheme {
  /** The torch's lamp colour and strength at a metre, falling off with distance. The kid's rim takes the lamp's colour: it is the torch's light on him. */
  lamp: number
  lampIntensity: number
  /** The flame's three colours, outside in: edge, body, core. Its embers are born the core's colour and go out the edge's. */
  flameEdge: number
  flameBody: number
  flameCore: number
  /** The smoke off the flame's tip. */
  smoke: number
  /** The fill: from the dome, from the floor, how strong. */
  sky: number
  ground: number
  fill: number
  /** The dark's colour. */
  fog: number
  /** The ink in the creases: the ambient occlusion's and the hatching's. */
  ao: number
  hatch: number
  /** How dark the corners close toward the fog, 0 to 1. */
  vignette: number
  /** The stone's tint: how light and how saturated, which way its hue turns from the texture's blue; its glint's colour, which the kid's highlight shares. */
  lightness: number
  saturation: number
  hue: number
  glint: number
  /** The rats: the four variants' tints over their fur, in the variants' order; their eyes, which their trails take; their highlight and rim. */
  fur: [number, number, number, number]
  eyes: number
  ratGlint: number
  ratRim: number
  /** The pumpkin kid: pyjamas, their stripes, the pumpkin, its stem. */
  pyjamas: number
  stripes: number
  pumpkin: number
  stem: number
}

/** The five, the first the page starts on. */
export const SEWER_THEMES: Record<string, SewerTheme> = {
  // Moss glow (2026-10-12, the one picked: halfway between moss and rust, too grey, and toxic glow, too green):
  // each colour at the two's midpoint but the flame and the eyes. A soft green flame under a pale green light, so
  // the fire and what it lights agree; amber eyes, the rust accent, since mint ones would sink into the green.
  'moss glow': {
    lamp: 0xbefaab,
    lampIntensity: 6,
    flameEdge: 0x3f9a4a,
    flameBody: 0x8ef07a,
    flameCore: 0xf0ffe4,
    smoke: 0x5c6f5f,
    sky: 0x6b9f85,
    ground: 0x537f3f,
    fill: 2.8,
    fog: 0x1e2f29,
    ao: 0x152720,
    hatch: 0x06100c,
    vignette: 0.22,
    lightness: 1.05,
    saturation: 0.45,
    hue: -60,
    glint: 0xddfcd3,
    fur: [0x121716, 0x181d1b, 0x1c1918, 0x49524f],
    eyes: 0xff9a2a,
    ratGlint: 0x223e2c,
    ratRim: 0xacf8ab,
    pyjamas: 0x3c5265,
    stripes: 0xebeede,
    pumpkin: 0xf07a24,
    stem: 0x344a20,
  },
  // Moss and rust (the black cats under the grate, the penguins' sunlit gate): mid sage stone in a sage dark, a
  // pale mint-white light, a natural flame gone pale at its heart; black rats with mint eyes; teal pyjamas.
  'moss and rust': {
    lamp: 0xf0f6dc,
    lampIntensity: 6,
    flameEdge: 0xd8602c,
    flameBody: 0xffa864,
    flameCore: 0xfff8ec,
    smoke: 0x7c8a78,
    sky: 0x9cc4a4,
    ground: 0x5c7444,
    fill: 3,
    fog: 0x2c4236,
    ao: 0x1e3428,
    hatch: 0x0a1610,
    vignette: 0.2,
    lightness: 1.2,
    saturation: 0.45,
    hue: -80,
    glint: 0xf2fae6,
    fur: [0x141a16, 0x1a201c, 0x201c1a, 0x56605a],
    eyes: 0xc8ffd8,
    ratGlint: 0x2a4232,
    ratRim: 0xdcf2cc,
    pyjamas: 0x2f4a5c,
    stripes: 0xf0e6c8,
    pumpkin: 0xf07a24,
    stem: 0x3a4a22,
  },
  // Toxic glow (the rubber duck, the rat and the turtles): charcoal slate in a near-black teal, the torch burning
  // acid green and lighting the tunnel green; black rats with rust-amber eyes; blue-grey pyjamas.
  'toxic glow': {
    lamp: 0x8cff7a,
    lampIntensity: 6,
    flameEdge: 0x1f9a3a,
    flameBody: 0x6dff5a,
    flameCore: 0xeaffd8,
    smoke: 0x3c5446,
    sky: 0x3a7a66,
    ground: 0x4a8a3a,
    fill: 2.6,
    fog: 0x101c1c,
    ao: 0x0c1a18,
    hatch: 0x030a08,
    vignette: 0.24,
    lightness: 0.9,
    saturation: 0.25,
    hue: -40,
    glint: 0xc8ffc0,
    fur: [0x101414, 0x151a1a, 0x181616, 0x3c4444],
    eyes: 0xff8c1a,
    ratGlint: 0x1a3a26,
    ratRim: 0x7dff8a,
    pyjamas: 0x4a5a6e,
    stripes: 0xe6efe0,
    pumpkin: 0xf07a24,
    stem: 0x2e4a1e,
  },
  // Turquoise water (the cartoon outfall, the flooded ruin): bright turquoise stone, an aqua-white light, the flame
  // a cold cyan wisp; dark teal rats with gold eyes; dusty rose pyjamas.
  'turquoise water': {
    lamp: 0xd8fff8,
    lampIntensity: 6,
    flameEdge: 0x1a8fb0,
    flameBody: 0x4fe0ff,
    flameCore: 0xeaffff,
    smoke: 0x5a8a8c,
    sky: 0x6cd0c8,
    ground: 0x4a8a6a,
    fill: 3,
    fog: 0x14383a,
    ao: 0x0e2e30,
    hatch: 0x041214,
    vignette: 0.2,
    lightness: 1.15,
    saturation: 0.7,
    hue: -40,
    glint: 0xe0fffa,
    fur: [0x121a1c, 0x182224, 0x1e1e22, 0x4e6266],
    eyes: 0xffd23a,
    ratGlint: 0x18383a,
    ratRim: 0xa8fff0,
    pyjamas: 0x7a4050,
    stripes: 0xf2e6d0,
    pumpkin: 0xf07a24,
    stem: 0x2e4a2a,
  },
  // Lamplit moss (the octopuses under the pipes): moss-green stone, a peach-white torch with rust bounced off the
  // floor; dark brown rats with pale gold eyes; teal pyjamas.
  'lamplit moss': {
    lamp: 0xffd6bc,
    lampIntensity: 6,
    flameEdge: 0xd8502a,
    flameBody: 0xff9a50,
    flameCore: 0xfff0dc,
    smoke: 0x6a6a5a,
    sky: 0x7aa070,
    ground: 0x6a4a34,
    fill: 2.6,
    fog: 0x1e2c22,
    ao: 0x1a2a1c,
    hatch: 0x080e08,
    vignette: 0.24,
    lightness: 1.1,
    saturation: 0.35,
    hue: -100,
    glint: 0xfff0e0,
    fur: [0x1a1614, 0x221c18, 0x262020, 0x645a54],
    eyes: 0xfff2c0,
    ratGlint: 0x3a2e22,
    ratRim: 0xffd8b8,
    pyjamas: 0x2c5058,
    stripes: 0xf2e2c4,
    pumpkin: 0xf07a24,
    stem: 0x3a4a22,
  },
}

/** The torch's lamp at full strength reaches this far, m: at the torch's starting strength about three and a half metres. */
const LAMP_REACH = 13
/** How fast the lamp fades: 1 its light a third as strong three metres out as at one. */
const LAMP_FALLOFF = 1

/** `look` laid in theme `name`: everything the themes share, then the theme's own; the kid's and the rats' parts as far as they are loaded. */
export function applyTheme(look: Look, name: string): void {
  const theme = SEWER_THEMES[name] ?? Object.values(SEWER_THEMES)[0]!
  look.sun.intensity = 0
  look.sun.shadows = false
  look.bloom.enabled = false
  look.lamp.color = theme.lamp
  look.lamp.intensity = theme.lampIntensity
  look.lamp.reach = LAMP_REACH
  look.lamp.falloff = LAMP_FALLOFF
  Object.assign(look.flame, { color: theme.flameEdge, body: theme.flameBody, core: theme.flameCore })
  look.flame.embers.hot = theme.flameCore
  look.flame.embers.cold = theme.flameEdge
  look.flame.smoke.color = theme.smoke
  look.fill = { sky: theme.sky, ground: theme.ground, intensity: theme.fill }
  // The dark closing in past the pool, frayed by a slow, low mist.
  Object.assign(look.fog, { color: theme.fog, near: 2, far: 10, density: 1.2, wisp: 0.6, scale: 1.8, drift: 0.12 })
  look.ao.color = theme.ao
  look.hatch.color = theme.hatch
  look.vignette.strength = theme.vignette
  theme.fur.forEach((tint, i) => {
    const variant = look.rats.variants[i]
    if (variant) variant.tint = tint
  })
  for (const part of look.rats.parts) if (part.name === 'eyes') part.color = theme.eyes
  look.trails.color = theme.eyes
  look.trails.eyeColour = false
  look.rats.specularColor = theme.ratGlint
  look.rats.rimColor = theme.ratRim
  if (look.sewer) {
    Object.assign(look.sewer.surface, {
      shading: 'toon',
      lightness: theme.lightness,
      saturation: theme.saturation,
      hue: theme.hue,
      // A hard, small glint: wet stone.
      shell: { sheen: 0, specular: 0.45, shininess: 60, softness: 0.05, specularColor: theme.glint, rim: false, rimStrength: 0, rimWidth: 0, rimSoftness: 0, rimColor: 0xffffff },
      paint: { strength: 3, density: 0.6, size: 2, rounding: 0.05 },
      // A lifted shade: the dark side of the stone still reads, as the paintings' do.
      toon: { steps: 3, three: [0.3, 0.62, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
    })
  }
  look.meat.rimColor = theme.lamp
  look.meat.specularColor = theme.glint
  look.meat.stripes.color = theme.stripes
  const parts: Record<string, number> = { pyjamas: theme.pyjamas, pumpkin: theme.pumpkin, stem: theme.stem }
  for (const part of look.meat.parts) part.color = parts[part.name] ?? part.color
}
