// The elves round the arena: ten cheering, five sitting, every one of them
// turned to face Santa wherever he goes. Ported from DecemberChallenge's Elf at
// 5c6c56b, its placements kept. The original packed each sitting elf's yaw into
// an instance colour for its shader to twist the upper body by, and stretched
// the sitting ones to a (2, 1, 1) scale; both are gone. An elf turns by its
// instance matrix, and its clip is instance playback like the horde's.
import { Vector3 } from 'three'
import type { VAT, VATClip, VATInstance } from 'three-vat'
import { clipNamed } from './clips'

/** The elf VAT's two clips. */
export interface ElfClips {
  cheering: VATClip
  sitting: VATClip
}

/** The elves' clips out of the elf's baked file. */
export function elfClipsOf(vat: VAT): ElfClips {
  return { cheering: clipNamed(vat, 'Cheering'), sitting: clipNamed(vat, 'Sit_Idle') }
}

export interface Elf {
  /** Where it is drawn, at its feet. */
  readonly position: Vector3
  /** Its heading about +y: at Santa. */
  readonly facing: number
  /** Its playback: its clip from the clock's start, at the speed the bake config gives it. */
  readonly playback: VATInstance
}

const CHEERING = [
  new Vector3(-2, 1.7, -20),
  new Vector3(-10.6, 1.6, -16.7),
  new Vector3(-17.5, 1.6, -8.39),
  new Vector3(-14.1, 1.7, 13.8),
  new Vector3(4.6, 1.7, 19.6),
  new Vector3(16.4, 1.6, 11.1),
  new Vector3(19.4, 1.7, -1.4),
  new Vector3(16.4, 1.5, -10.0),
  new Vector3(8.6, 1.5, -17.1),
  new Vector3(-6.4, 1.7, 19),
]

const SITTING = [
  new Vector3(0.8, 2.3, -16.9),
  new Vector3(16.4, 2.3, -6.1),
  new Vector3(-13.0, 2.3, -11.9),
  new Vector3(-16.1, 2.3, 5.0),
  new Vector3(15.7, 2.4, 7.0),
]

type MutableElf = { -readonly [K in keyof Elf]: Elf[K] }

/** The fifteen elves, the cheering ones first, each facing `santa`. */
export function placeElves(clips: ElfClips, santa: Vector3): MutableElf[] {
  // Every elf from the clock's start, in step with the others of its clip, as
  // the original's one uniform clock had them.
  const elves = [
    ...CHEERING.map((at) => ({ position: at.clone(), facing: 0, playback: { clip: clips.cheering, startTime: 0 } })),
    ...SITTING.map((at) => ({ position: at.clone(), facing: 0, playback: { clip: clips.sitting, startTime: 0 } })),
  ]
  faceElves(elves, santa)
  return elves
}

/** Turn every elf to `santa`, on the ground plane. */
export function faceElves(elves: MutableElf[], santa: Vector3): void {
  for (const elf of elves) {
    const x = santa.x - elf.position.x
    const z = santa.z - elf.position.z
    if (x * x + z * z > 1e-8) elf.facing = Math.atan2(x, z)
  }
}
