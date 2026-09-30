import type { VAT, VATClip } from 'three-vat'

/** The clip `name` of a baked file, which the bake config names, or a refusal saying which. */
export function clipNamed(vat: VAT, name: string): VATClip {
  const clip = vat.clips.find((clip) => clip.name === name)
  if (!clip) throw new Error(`the baked file has no ${name} clip: bake it again (pnpm --filter ho-ho-no bake)`)
  return clip
}
