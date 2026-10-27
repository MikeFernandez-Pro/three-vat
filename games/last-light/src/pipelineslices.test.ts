import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicNodeMaterial, Scene } from 'three/webgpu'
import { PipelineSlices, pipelineKey } from './pipelineslices'

const box = new BoxGeometry()

describe('pipeline slices', () => {
  it('keys meshes that wear the same material alike, and an instanced mesh by itself', () => {
    const material = new MeshBasicNodeMaterial()
    const a = new Mesh(box, material)
    const b = new Mesh(box, material)
    const c = new InstancedMesh(box, material, 4)
    const d = new InstancedMesh(box, material, 4)
    expect(pipelineKey(a)).toBe(pipelineKey(b))
    expect(pipelineKey(c)).not.toBe(pipelineKey(a))
    expect(pipelineKey(c)).not.toBe(pipelineKey(d))
  })

  it('slices the drawn objects, hidden ones too, a few keys to a slice', () => {
    const scene = new Scene()
    const [red, green, blue] = [0, 1, 2].map(() => new MeshBasicNodeMaterial())
    const hidden = new Group()
    hidden.visible = false
    hidden.add(new Mesh(box, blue))
    scene.add(new Mesh(box, red), new Mesh(box, green), new Mesh(box, red), hidden)
    const { slices } = new PipelineSlices(scene, 2)
    expect(slices.map((slice) => slice.length)).toEqual([3, 1])
    expect(slices[1]![0]!.parent).toBe(hidden)
  })

  it('draws one slice alone, and puts every object back as it was', () => {
    const scene = new Scene()
    const meshes = [0, 1, 2].map(() => new Mesh(box, new MeshBasicNodeMaterial()))
    meshes[2]!.visible = false
    scene.add(...meshes)
    const pipelines = new PipelineSlices(scene, 1)
    const back = pipelines.only(1)
    expect(meshes.map((m) => m.visible)).toEqual([false, true, false])
    back()
    expect(meshes.map((m) => m.visible)).toEqual([true, true, false])
    pipelines.only(3)
    expect(meshes.map((m) => m.visible)).toEqual([false, false, false])
  })
})
