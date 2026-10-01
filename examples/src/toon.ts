// The twisted crowd's toon material: which of three.js's own gradient maps it
// shades in bands of, and how that map has to be sampled.
//
// A gradient map is a strip of a few texels, one per tone. Filtered, or
// mipmapped, the GPU blends neighbouring tones and the bands blur back into a
// smooth ramp; read nearest-texel both ways, each tone is a band with a hard
// edge. Both pages take the same files and the same settings from here.
//
// No three.js: a WebGPU page's bundle is three/webgpu's alone, so the filter
// constant is handed in by the page, from whichever build it imported.

/** Three tones or five, as the panel offers them. */
export type Tones = "three" | "five";

/** The panel's choice, as `[value, text]` pairs. */
export const GRADIENTS: readonly (readonly [Tones, string])[] = [
  ["three", "three tones"],
  ["five", "five tones"],
];

/** three.js's own gradient map for `tones`, from examples/textures/gradientMaps, served from the public assets. */
export function gradientFile(tones: Tones): string {
  return `${tones}Tone.jpg`;
}

/** What crispGradient sets: three's `Texture` is this. */
export interface GradientTexture {
  minFilter: number;
  magFilter: number;
  generateMipmaps: boolean;
}

/** Sample `texture` texel by texel, with no mipmaps — `nearest` is three's `NearestFilter`. */
export function crispGradient<T extends GradientTexture>(texture: T, nearest: number): T {
  texture.minFilter = nearest;
  texture.magFilter = nearest;
  texture.generateMipmaps = false;
  return texture;
}
