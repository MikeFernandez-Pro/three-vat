import { describe, expect, it } from 'vitest'
import { resolveVATFrame, type VATClip } from 'three-vat'
import { elfClips, idle, run, simulate } from './test-crowds'

const seconds = (clip: Pick<VATClip, 'frames' | 'fps'>) => clip.frames / clip.fps

describe('the elves', () => {
  it('are ten cheering and five sitting, at the original placements', async () => {
    const { simulation } = await simulate()
    const { elves } = simulation
    const { cheering, sitting } = await elfClips()

    expect(elves).toHaveLength(15)
    expect(elves.slice(0, 10).every((elf) => elf.playback.clip === cheering)).toBe(true)
    expect(elves.slice(10).every((elf) => elf.playback.clip === sitting)).toBe(true)
    expect(elves[0].position.toArray()).toEqual([-2, 1.7, -20])
    expect(elves[10].position.toArray()).toEqual([0.8, 2.3, -16.9])
  })

  it('play their clips at 0.8x, as the original ran its 30 fps bakes at 24', async () => {
    const { simulation } = await simulate()
    const [cheering] = simulation.elves
    const sitting = simulation.elves[10]
    const t = 12.34

    for (const elf of [cheering, sitting]) {
      const frame = resolveVATFrame(elf.playback, t)
      const { clip } = elf.playback
      expect(frame.row).toBeGreaterThanOrEqual(clip.startFrame)
      expect(frame.row).toBeLessThan(clip.startFrame + clip.frames)
      expect(frame.phase).toBeCloseTo(((t * 0.8) / seconds(clip)) % 1, 6)
      expect(frame.finished).toBe(false)
    }
  })

  it('face Santa, and turn with him as he moves', async () => {
    const { simulation } = await simulate()
    const facingSanta = () =>
      simulation.elves.map((elf) =>
        Math.atan2(simulation.santa.position.x - elf.position.x, simulation.santa.position.z - elf.position.z),
      )
    expect(simulation.elves.map((elf) => elf.facing)).toEqual(facingSanta())

    simulation.start(0)
    run(simulation, 0, 1, () => ({ ...idle, move: { x: 1, z: 0 } }))

    expect(simulation.santa.position.x).toBeGreaterThan(5)
    const facing = simulation.elves.map((elf) => elf.facing)
    facingSanta().forEach((expected, i) => expect(facing[i]).toBeCloseTo(expected, 6))
  })
})
