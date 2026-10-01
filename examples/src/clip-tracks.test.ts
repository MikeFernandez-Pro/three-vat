// Guards the vertex encoding page's track lines: which kinds of track a clip
// holds, and which of them is moving at a given moment of it. The node track
// is the page's quiet half, and a line that lit when nothing moved, or stayed
// dark while the herd reared, would teach the opposite of what it shows.
import { describe, expect, it } from 'vitest'
import { trackKinds } from './clip-tracks.js'

// Three influences a key, as a morph track on a three-target head carries them.
const morph = { name: 'Head_4.morphTargetInfluences', times: [0, 1, 2], values: [0, 0, 0, 0, 1, 0, 0, 0, 0] }
// Still for the first second, then a turn: the shape of the page's rear.
const turn = { name: 'mesh_0.quaternion', times: [0, 1, 2], values: [0, 0, 0, 1, 0, 0, 0, 1, 0.3, 0, 0, 0.95] }
const lift = { name: 'mesh_0.position', times: [0, 1, 2], values: [0, 0, 0, 0, 0, 0, 0, 0.4, 0] }

describe('trackKinds', () => {
  it('names each kind once, in the order the clip first holds it, with its track count', () => {
    const arm = { ...turn, name: 'Arm.quaternion' }
    expect(trackKinds([morph, turn, arm, lift], 0).map(({ kind, tracks }) => [kind, tracks])).toEqual([
      ['morph targets', 1],
      ['node rotation', 2],
      ['node position', 1],
    ])
  })

  it('reads the kind off the property, whatever the track binds it on', () => {
    const indexed = { ...morph, name: 'Head_4.morphTargetInfluences[Surprised]' }
    const scale = { name: 'Root.scale', times: [0, 1], values: [1, 1, 1, 2, 2, 2] }
    expect(trackKinds([indexed, scale], 0).map(({ kind }) => kind)).toEqual(['morph targets', 'node scale'])
  })

  it('lights a kind while one of its tracks is between two keys that differ', () => {
    expect(trackKinds([morph], 0.5)[0]!.active).toBe(true)
    expect(trackKinds([morph], 1.5)[0]!.active).toBe(true)
  })

  it('leaves a kind dark while its tracks hold still', () => {
    expect(trackKinds([turn, lift], 0.5).map(({ active }) => active)).toEqual([false, false])
    expect(trackKinds([turn, lift], 1.5).map(({ active }) => active)).toEqual([true, true])
  })

  it('leaves a kind dark outside its keys', () => {
    expect(trackKinds([morph], 2)[0]!.active).toBe(false)
    expect(trackKinds([morph], -0.1)[0]!.active).toBe(false)
  })

  it('holds no kinds for a clip of no tracks', () => {
    expect(trackKinds([], 0)).toEqual([])
  })
})
