// The snowfall and the bursts, a snowball's and a gift's: their shape and
// timing. How they are drawn is the
// seam's (`seam.ts`).
import gsap from 'gsap'
import { Color, Spherical, Vector3, type Scene } from 'three'
import type { Burst, BurstSpec, RendererSeam, SnowSpec } from './seam'
import type { Point } from './simulation/simulation'

/** The original's 10 000 flakes, over a 90-unit square, 20 units deep. */
export function snowSpec(count = 10_000): SnowSpec {
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count)
  const movements = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 90
    positions[i * 3 + 1] = Math.random() * 20
    positions[i * 3 + 2] = (Math.random() - 0.5) * 90
    scales[i] = Math.random() * 0.5 + 0.5
    movements[i] = Math.random()
  }
  return {
    positions,
    scales,
    movements,
    size: 0.2,
    speed: 0.9,
    color: new Color('#ffffff'),
    fadeNear: -21,
    fadeFar: 126,
  }
}

/** How one kind of burst looks: the original's ProjectileParticles, or its GiftParticles. */
export interface BurstStyle {
  count: number
  size: number
  /** The shell the discs start out toward, before `spread`. */
  radius: number
  spread: number
  rise: number
  /** Disc `i`'s colour, written into `tints` at `i * 3`; `dark` for a gift that was missed. */
  tint(tints: Float32Array, i: number, dark: boolean): void
}

/** A snowball's impact: fifteen white discs, falling. */
export const SNOWBALL_BURST: BurstStyle = {
  count: 15,
  size: 1,
  radius: 2,
  spread: 1,
  rise: -3,
  tint: (tints, i) => void tints.fill(1, i * 3, i * 3 + 3),
}

/** A gift's: a hundred discs, flung twice as far and rising, each its own pale colour, or all black for a gift missed. */
export const GIFT_BURST: BurstStyle = {
  count: 100,
  size: 0.8,
  radius: 2,
  spread: 2,
  rise: 3,
  tint: (tints, i, dark) => {
    for (let channel = 0; channel < 3; channel++) tints[i * 3 + channel] = dark ? 0 : Math.random() * 0.5 + 0.3
  },
}

/** Bursts are drawn this far above where they happened. */
const BURST_LIFT = 1.2
const BURST_SECONDS = 1

/**
 * Bursts of one style, drawn from a pool: each is a fresh scatter of discs,
 * but the object drawing it is reused once the last one it drew is spent.
 */
export class Bursts {
  private readonly free: { burst: Burst; spec: BurstSpec }[] = []
  private readonly spherical = new Spherical()
  private readonly point = new Vector3()

  constructor(
    private readonly seam: RendererSeam,
    private readonly scene: Scene,
    private readonly style: BurstStyle,
  ) {}

  /** Burst at `position`; `dark`, for a gift that went uncollected. */
  play(position: Point, dark = false): void {
    const slot = this.free.pop() ?? this.create()
    this.scatter(slot.spec, dark)
    slot.burst.refresh()
    slot.burst.setProgress(0)
    slot.burst.object.position.set(position.x, position.y + BURST_LIFT, position.z)
    this.scene.add(slot.burst.object)

    const progress = { value: 0 }
    gsap.to(progress, {
      value: 1,
      duration: BURST_SECONDS,
      ease: 'power2.out',
      onUpdate: () => slot.burst.setProgress(progress.value),
      onComplete: () => {
        this.scene.remove(slot.burst.object)
        this.free.push(slot)
      },
    })
  }

  private create() {
    const { count, size, spread, rise } = this.style
    const spec: BurstSpec = {
      positions: new Float32Array(count * 3),
      scales: new Float32Array(count),
      tints: new Float32Array(count * 3),
      size,
      spread,
      rise,
    }
    return { burst: this.seam.burst(spec), spec }
  }

  /** A shell of discs about the centre, each at 75–100% of the radius. */
  private scatter({ positions, scales, tints }: BurstSpec, dark: boolean): void {
    const { count, radius, tint } = this.style
    for (let i = 0; i < count; i++) {
      this.spherical.set(radius * (0.75 + Math.random() * 0.25), Math.random() * Math.PI, Math.random() * Math.PI * 2)
      this.point.setFromSpherical(this.spherical).toArray(positions, i * 3)
      scales[i] = Math.random() * 0.5 + 0.5
      tint(tints, i, dark)
    }
  }
}
