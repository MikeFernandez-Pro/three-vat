// PROTOTYPE — throwaway probe for #97's format question: does an FBXLoader
// scene bake correctly today? Delete after the run.
import { readFileSync } from 'node:fs'
import { AnimationMixer, Matrix4, Texture, TextureLoader, Vector3 } from 'three'
import type { AnimationClip, Material, Mesh, Object3D, SkinnedMesh } from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { it, vi } from 'vitest'
import { bakeVAT } from './bake.js'
import { deltaTexel, deltaTexels, skinFromRig } from './test-utils.js'
import type { VAT } from './types.js'

const DIR = process.env.FBX_DIR!
const FILES = (process.env.FBX_FILES ?? 'Samba_Dancing.fbx,mixamo.fbx,morph_test.fbx,RotationTest.fbx,Warrior.fbx').split(',')

// Textures never load under Node; the bake does not read them.
TextureLoader.prototype.load = () => new Texture()

/** Merged vertex → [mesh, source vertex], replaying collectParts' order (flat merge off). */
function vertexMap(root: Object3D): [Mesh, number][] {
  const meshes: Mesh[] = []
  root.traverse((o) => {
    if ((o as Mesh).isMesh && (o as Mesh).geometry) meshes.push(o as Mesh)
  })
  const materials: Material[] = []
  const parts: { mesh: Mesh; mi: number; verts: number[] }[] = []
  for (const mesh of meshes) {
    const g = mesh.geometry
    const pieces: { mat: Material; verts: number[] }[] = []
    if (!Array.isArray(mesh.material)) {
      pieces.push({ mat: mesh.material, verts: [...Array(g.attributes.position!.count).keys()] })
    } else {
      for (const group of g.groups) {
        const end = Math.min(group.start + group.count, g.index ? g.index.count : g.attributes.position!.count)
        const seen = new Set<number>()
        const verts: number[] = []
        for (let i = group.start; i < end; i++) {
          const v = g.index ? g.index.getX(i) : i
          if (!seen.has(v)) {
            seen.add(v)
            verts.push(v)
          }
        }
        if (verts.length) pieces.push({ mat: mesh.material[group.materialIndex ?? 0]!, verts })
      }
    }
    for (const { mat, verts } of pieces) {
      let mi = materials.indexOf(mat)
      if (mi === -1) mi = materials.push(mat) - 1
      parts.push({ mesh, mi, verts })
    }
  }
  parts.sort((a, b) => a.mi - b.mi)
  return parts.flatMap((p) => p.verts.map((v) => [p.mesh, v] as [Mesh, number]))
}

function describeScene(root: Object3D, clips: AnimationClip[]): string {
  let meshes = 0,
    skinned = 0,
    arrays = 0,
    morphs = 0,
    verts = 0,
    indexed = 0
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    meshes++
    if ((m as SkinnedMesh).isSkinnedMesh) skinned++
    if (Array.isArray(m.material)) arrays++
    if (m.geometry.index) indexed++
    if (Object.keys(m.geometry.morphAttributes).length) morphs++
    verts += m.geometry.attributes.position!.count
  })
  const s = root.scale
  return (
    `meshes ${meshes} (skinned ${skinned}, indexed ${indexed}, material arrays ${arrays}, morphed ${morphs}), ${verts} vertices, ` +
    `root scale ${s.x.toFixed(3)}, clips ${clips.map((c) => `${c.name || '(unnamed)'} ${c.duration.toFixed(2)}s/${c.tracks.length}tr`).join(', ')}`
  )
}

/** Worst distance between the VAT's decode and three's own vertex, over up to 40 rows a clip, as a fraction of the bounds' radius. */
function worstError(root: Object3D, vat: VAT, clips: AnimationClip[], map: [Mesh, number][]): { abs: number; rel: number; at: string } {
  const mixer = new AnimationMixer(root)
  root.updateMatrixWorld(true)
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert()
  const radius = vat.bounds.getSize(new Vector3()).length() / 2 || 1
  let worst = { abs: 0, rel: 0, at: '' }
  const three = new Vector3()
  const texels = vat.encoding === 'delta' ? deltaTexels(vat) : null
  const rest = vat.geometry.attributes.position!
  vat.clips.forEach((vc, ci) => {
    const action = mixer.clipAction(clips[ci]!)
    mixer.stopAllAction()
    action.play()
    const step = Math.max(1, Math.floor(vc.frames / 40))
    for (let f = 0; f < vc.frames; f += step) {
      mixer.setTime((f / vc.frames) * vc.duration)
      root.updateMatrixWorld(true)
      const row = vc.startFrame + f
      const vstep = Math.max(1, Math.floor(map.length / 3000))
      for (let v = 0; v < map.length; v += vstep) {
        const [mesh, s] = map[v]!
        mesh.getVertexPosition(s, three).applyMatrix4(mesh.matrixWorld).applyMatrix4(rootInverse)
        const o = vat.encoding === 'delta' ? deltaTexel(vat, row, v) * 4 : 0
        const baked =
          vat.encoding === 'delta'
            ? new Vector3(rest.getX(v) + texels![o]!, rest.getY(v) + texels![o + 1]!, rest.getZ(v) + texels![o + 2]!)
            : skinFromRig(vat, v, row).position
        const d = baked.distanceTo(three)
        if (d > worst.abs) worst = { abs: d, rel: d / radius, at: `clip ${vc.name} frame ${f} vertex ${v} (${mesh.name})` }
      }
    }
  })
  mixer.stopAllAction()
  mixer.setTime(0)
  root.updateMatrixWorld(true)
  return worst
}

for (const file of FILES) {
  it(file, () => {
    const lines: string[] = [`=== ${file}`]
    const warn = vi.spyOn(console, 'warn').mockImplementation((...a) => lines.push(`  warn: ${String(a[0]).slice(0, 200)}`))
    let root: Object3D
    try {
      const bytes = readFileSync(`${DIR}/${file}`)
      root = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), DIR + '/')
    } catch (e) {
      lines.push(`  LOAD FAILED: ${(e as Error).message}`)
      console.log(lines.join('\n'))
      return
    }
    const clips = (root as Object3D & { animations: AnimationClip[] }).animations
    lines.push(`  ${describeScene(root, clips)}`)
    if (!clips.length) {
      lines.push('  no clips: nothing to bake')
      console.log(lines.join('\n'))
      return
    }
    if (process.env.FBX_MERGE) {
      root.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh) return
        const before = m.geometry.attributes.position!.count
        m.geometry = mergeVertices(m.geometry)
        lines.push(`  mergeVertices ${m.name}: ${before} -> ${m.geometry.attributes.position!.count}`)
      })
    }
    const map = vertexMap(root)
    for (const encoding of (process.env.FBX_MERGE ? ['rig'] : ['auto', 'delta', 'rig']) as ('auto' | 'delta' | 'rig')[]) {
      try {
        const t0 = performance.now()
        const vat = bakeVAT(root, clips, { fps: 30, encoding })
        const ms = performance.now() - t0
        const err = worstError(root, vat, clips, map)
        const extra =
          vat.encoding === 'rig' ? `slots ${vat.slotCount}` : `rowsPerFrame ${vat.rowsPerFrame}, fallback ${vat.fallback ? `"${vat.fallback.slice(0, 160)}…"` : 'none'}`
        lines.push(
          `  ${encoding.padEnd(5)} → ${vat.encoding}: ${ms.toFixed(0)} ms, ${vat.vertexCount} verts (map ${map.length}), ${vat.materials.length} materials, ${extra}; ` +
            `worst ${err.abs.toExponential(2)} = ${(err.rel * 100).toFixed(4)}% of radius at ${err.at}`,
        )
      } catch (e) {
        lines.push(`  ${encoding.padEnd(5)} → REFUSED: ${(e as Error).message.slice(0, 300)}`)
      }
    }
    warn.mockRestore()
    console.log(lines.join('\n'))
  }, 300_000)
}
