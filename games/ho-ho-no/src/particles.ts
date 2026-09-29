// The snowfall and the snowball impacts: their shape and timing, which are the
// same on both renderers. How they are drawn is the seam's (`seam.ts`).
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

const BURST_COUNT = 15
const BURST_RADIUS = 2
/** Bursts are drawn this far above where the snowball stopped. */
const BURST_RISE = 1.2
const BURST_SECONDS = 1

/**
 * Snowball impacts, drawn from a pool: each burst is a fresh scatter of discs,
 * but the object drawing it is reused once the last one it drew is spent.
 */
export class Bursts {
  private readonly free: { burst: Burst; spec: BurstSpec }[] = []
  private readonly spherical = new Spherical()
  private readonly point = new Vector3()

  constructor(
    private readonly seam: RendererSeam,
    private readonly scene: Scene,
  ) {}

  /** Burst at `position`, where a snowball stopped. */
  play(position: Point): void {
    const slot = this.free.pop() ?? this.create()
    this.scatter(slot.spec)
    slot.burst.refresh()
    slot.burst.setProgress(0)
    slot.burst.object.position.set(position.x, position.y + BURST_RISE, position.z)
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
    const spec: BurstSpec = {
      positions: new Float32Array(BURST_COUNT * 3),
      scales: new Float32Array(BURST_COUNT),
      size: 1,
      colors: [new Color('#ffffff'), new Color('#ffffff')],
    }
    return { burst: this.seam.burst(spec), spec }
  }

  /** A shell of discs about the centre, each at 75–100% of the radius. */
  private scatter({ positions, scales }: BurstSpec): void {
    for (let i = 0; i < BURST_COUNT; i++) {
      this.spherical.set(BURST_RADIUS * (0.75 + Math.random() * 0.25), Math.random() * Math.PI, Math.random() * Math.PI * 2)
      this.point.setFromSpherical(this.spherical).toArray(positions, i * 3)
      scales[i] = Math.random() * 0.5 + 0.5
    }
  }
}
