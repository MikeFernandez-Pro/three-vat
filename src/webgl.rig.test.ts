import { Material, MeshDepthMaterial, MeshDistanceMaterial, MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import {
  createVATPlaybackTexture,
  endsAt,
  EndMode,
  INFINITE_REPETITIONS,
  LoopMode,
  PACK_TEXELS,
  setVATInstance,
} from './instance-playback.js'
import { RIG_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import {
  compileVATMaterial as compile,
  makeBatchedCarrier,
  makeFixtureCrowd,
  makeRigVATFixture,
  makeVATFixture,
} from './test-utils.js'
import { createVATDepthMaterial, createVATMesh, createVATUniforms, patchVATMaterial } from './webgl.js'

// The rig decode on the WebGL path (ADR-0018). Everything above the sampling —
// the pack, the row arithmetic, the fade — is the vertex decode's, shared
// verbatim; what these pin is that a rig crowd reads the rig texture and
// nothing else, skins from it, and rides both carriers under the unchanged
// instance playback contract. CI has no GPU, so the shader is read as source.

const materialsOf = (mesh: { material: Material | Material[] }) => mesh.material as Material[]

/**
 * One function of the row prelude, cut out of a compiled vertex shader: from
 * its declaration to the end of its body.
 */
function functionOf(vertexShader: string, declaration: string): string {
  const start = vertexShader.indexOf(declaration)
  expect(start, `the shader declares ${declaration}`).toBeGreaterThan(-1)
  const end = vertexShader.indexOf('\n  }\n', start)
  return vertexShader.slice(start, end)
}

/**
 * The row arithmetic as source: the band resolver, and the function that calls
 * it for the live band and blends the pose-freeze fade over it. What the two
 * encodings must share character for character.
 */
function rowsFunctionOf(vertexShader: string): string {
  return [functionOf(vertexShader, 'VatBand vatBand('), functionOf(vertexShader, 'VatRows vatRows(')].join('\n')
}

describe('createVATMesh on a rig-encoded VAT', () => {
  it('samples the rig texture, and no position or normal texture', () => {
    const vat = makeRigVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    for (const material of materialsOf(mesh)) {
      const shader = compile(material)
      expect(shader.uniforms['uVatRigTex']?.value).toBe(vat.rigTexture)
      expect(shader.uniforms['uVatPosTex']).toBeUndefined()
      expect(shader.uniforms['uVatNrmTex']).toBeUndefined()
      expect(shader.vertexShader).toContain('uniform highp sampler2D uVatRigTex;')
      expect(shader.vertexShader).not.toContain('uVatPosTex')
      expect(shader.vertexShader).not.toContain('uVatNrmTex')
    }
  })

  it('reads skinIndex and skinWeight off the geometry the bake kept them on', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    expect(vertexShader).toContain('attribute vec4 skinIndex;')
    expect(vertexShader).toContain('attribute vec4 skinWeight;')
    expect(mesh.geometry.getAttribute('skinIndex')).toBeDefined()
    expect(mesh.geometry.getAttribute('skinWeight')).toBeDefined()
  })

  it('fetches four slots at both resolved rows, by the layout the bake wrote', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    // Two texels per slot, addressed as the baker laid them out — from the one
    // layout module, so a repack there cannot leave this shader on the old one.
    expect(vertexShader).toContain(`int rotation = slot * ${RIG_TEXELS_PER_SLOT} + ${RIG_TEXELS.rotation};`)
    expect(vertexShader).toContain(`int placement = slot * ${RIG_TEXELS_PER_SLOT} + ${RIG_TEXELS.placement};`)
    for (const row of ['band.row0', 'band.row1']) {
      expect(vertexShader).toContain(`texelFetch( uVatRigTex, ivec2( rotation, ${row} ), 0 )`)
      expect(vertexShader).toContain(`texelFetch( uVatRigTex, ivec2( placement, ${row} ), 0 )`)
    }
    // One slot per influence, weighted by the vertex's own skin weights.
    expect(vertexShader).toContain('float w = skinWeight[ i ];')
    expect(vertexShader).toContain('skin += w * vatSlot( int( skinIndex[ i ] ), rows, outgoing );')
  })

  it('blends rotation as a normalised quaternion lerp, translation and scale linearly, then composes', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    // The bake keeps neighbouring rows on one hemisphere; a looping clip's wrap
    // blends the band's last row into its first, which are not neighbours, so
    // the second row is flipped onto the first's side before the lerp.
    expect(vertexShader).toContain('if ( dot( q0, q1 ) < 0.0 ) q1 = -q1;')
    expect(vertexShader).toContain('pose.q = normalize( mix( q0, q1, band.blend ) );')
    expect(vertexShader).toContain('pose.ts = mix( ts0, ts1, band.blend );')
    expect(vertexShader).toContain('return vatCompose( q, ts );')
  })

  it('transforms position, normal and tangent by the skin matrix', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    expect(vertexShader).toContain('vec3 transformed = ( vatSkin * vec4( position, 1.0 ) ).xyz;')
    expect(vertexShader).toContain('vec3 objectNormal = normalize( mat3( vatSkinN ) * normal );')
    expect(vertexShader).toContain('vec3 objectTangent = normalize( mat3( vatSkinN ) * tangent.xyz );')
    // Under three's own guard, so a geometry without a tangent compiles.
    expect(vertexShader.indexOf('#ifdef USE_TANGENT')).toBeLessThan(vertexShader.indexOf('objectTangent'))
    // Each injection point resolves its own skin matrix (ADR-0006).
    expect(vertexShader).toContain('mat4 vatSkin = vatSkinMatrix( gl_InstanceID );')
    expect(vertexShader).toContain('mat4 vatSkinN = vatSkinMatrix( gl_InstanceID );')
  })

  it('patches the depth and distance materials with the same decode', () => {
    const vat = makeRigVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const depth = mesh.customDepthMaterial as MeshDepthMaterial
    const distance = mesh.customDistanceMaterial as MeshDistanceMaterial
    expect(depth).toBeInstanceOf(MeshDepthMaterial)
    expect(distance).toBeInstanceOf(MeshDistanceMaterial)
    for (const material of [depth, distance]) {
      const shader = compile(material)
      expect(shader.uniforms['uVatRigTex']?.value).toBe(vat.rigTexture)
      expect(shader.vertexShader).toContain('vatSkinMatrix( gl_InstanceID )')
    }
  })

  it('keys its programs apart from the unpatched material and from the vertex patch', () => {
    // The shadow materials are the identical MeshDepthMaterial for either
    // encoding, so without distinct keys a rig crowd's shadow pass would be
    // handed the vertex crowd's compiled program (ADR-0006).
    const rig = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const vertex = createVATMesh(makeVATFixture(), makeFixtureCrowd())
    const noNormal = createVATMesh(makeVATFixture({ bakeNormals: false }), makeFixtureCrowd())
    const key = (material: Material) => material.customProgramCacheKey()

    expect(key(materialsOf(rig.mesh)[0]!)).not.toBe(new MeshStandardMaterial().customProgramCacheKey())
    expect(key(materialsOf(rig.mesh)[0]!)).not.toBe(key(materialsOf(vertex.mesh)[0]!))
    expect(key(materialsOf(rig.mesh)[0]!)).not.toBe(key(materialsOf(noNormal.mesh)[0]!))
    expect(key(rig.mesh.customDepthMaterial!)).not.toBe(key(vertex.mesh.customDepthMaterial!))
    expect(key(rig.mesh.customDepthMaterial!)).not.toBe(key(noNormal.mesh.customDepthMaterial!))
    expect(key(rig.mesh.customDistanceMaterial!)).not.toBe(key(vertex.mesh.customDistanceMaterial!))
  })

  it('accepts a smooth-shaded lit material — the normal comes out of the skin matrix', () => {
    // The pairing the vertex encoding refuses without a normal texture is the
    // rig encoding's ordinary case: there is no normal texture, and none is
    // missing.
    const vat = makeRigVATFixture()
    expect((vat.materials[0] as MeshStandardMaterial).flatShading).toBe(false)

    expect(() => createVATMesh(vat, makeFixtureCrowd())).not.toThrow()
  })
})

describe('the rig decode reads the instance-playback pack as the vertex decode does', () => {
  it('shares the row arithmetic with the vertex decode, character for character', () => {
    // One transcription of `resolveVATFrame`, read by both encodings — only
    // what a row *holds* differs (ADR-0018). Compared as source, because that
    // is the only form of it CI can read.
    const rig = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const vertex = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    const rigRows = rowsFunctionOf(compile(materialsOf(rig.mesh)[0]!).vertexShader)
    expect(rigRows).toBe(rowsFunctionOf(compile(materialsOf(vertex.mesh)[0]!).vertexShader))
    expect(rigRows.length).toBeGreaterThan(500)
  })

  it('fetches the pack by the logical index and addresses the band from the clip texel', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    expect(vertexShader).toContain('uniform highp sampler2D uVatPlaybackTex;')
    expect(vertexShader).toContain(
      `vec4 vatClip      = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.clip}, vatInstance ), 0 );`,
    )
    expect(vertexShader).toContain(
      `vec4 vatPlayback  = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.playback}, vatInstance ), 0 );`,
    )
    expect(vertexShader).toContain('( uVatTime - vatPlayback.x ) * vatClip.w')
    expect(vertexShader).toContain('band.row0 = int( vatClip.x + f0 );')
    expect(vertexShader).toContain('band.row1 = int( vatClip.x + f1 );')
    expect(vertexShader).not.toContain('attribute vec4 aVat')
  })

  it('branches on the loop mode, the repeat count and the end mode, from the contract', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    expect(vertexShader).toContain('float repetitions = vatPlayback.z;')
    expect(vertexShader).toContain(`vatPlayback.y == ${LoopMode.PingPong.toFixed(1)}`)
    expect(vertexShader).toContain(`vatPlayback.w == ${EndMode.Clamp.toFixed(1)} ? 1.0 : 0.0`)
    expect(vertexShader).toContain(`repetitions != ${INFINITE_REPETITIONS.toFixed(1)} && loops >= repetitions`)
  })

  it('never samples outside the clip’s own band', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    expect(vertexShader).toContain('float f0 = min( floor( f ), last );')
    expect(vertexShader).toContain('float f1 = wraps ? ( next >= frames ? 0.0 : next ) : min( next, last );')
  })

  it('blends a second rig pose in, weighted by wall clock, behind a per-instance branch', () => {
    // The crossfade, under this encoding: the outgoing band is resolved by the
    // same function, fetched the same way as the live rows, and blended per
    // slot - rotation and placement both - before the slot is composed.
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    expect(vertexShader).toContain(
      `vec4 vatCrossfade = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.crossfade}, vatInstance ), 0 );`,
    )
    expect(vertexShader).toContain('if ( vatCrossfade.x > 0.0 ) {')
    expect(vertexShader).toContain(
      'rows.weight = 1.0 - clamp( ( uVatTime - vatPlayback.x ) / vatCrossfade.x, 0.0, 1.0 );',
    )
    expect(vertexShader).toContain('return vatBand( vatOutClip, vatOutPlayback );')
    // The guard stays on this encoding, where what it skips is four dependent
    // fetches of the rig texture per slot rather than two of one layer per
    // vertex. #72 measured both: the rig decode did not get slower when the
    // crossfade landed, and the vertex decode did (ADR-0025).
    expect(vertexShader).toContain('if ( rows.weight > 0.0 ) {')
    expect(vertexShader).toContain('VatBand outgoing = vatOutgoingBand( vatInstance, rows.weight > 0.0 );')
    // One slot pose per band, from one function of a band - and the blend
    // between them is a normalised lerp with the same hemisphere check the
    // wrap needs, because the outgoing row is no neighbour of this one.
    expect(vertexShader).toContain('VatPose pose = vatSlotPose( rotation, placement, rows.live );')
    expect(vertexShader).toContain('VatPose leaving = vatSlotPose( rotation, placement, outgoing );')
    expect(vertexShader).toContain('if ( dot( q, qo ) < 0.0 ) qo = -qo;')
    expect(vertexShader).toContain('q = normalize( mix( q, qo, rows.weight ) );')
    expect(vertexShader).toContain('ts = mix( ts, leaving.ts, rows.weight );')
  })
})

describe('a rig crowd under the unchanged instance playback contract', () => {
  it('writes the same playback texture a vertex crowd writes from the same instances', () => {
    const rig = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const vertex = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    expect(rig.playback.texture.image.data).toEqual(vertex.playback.texture.image.data)
    for (const material of [...materialsOf(rig.mesh), rig.mesh.customDepthMaterial!]) {
      expect(compile(material).uniforms['uVatPlaybackTex']?.value).toBe(rig.playback.texture)
    }
  })

  it('takes setVATInstance and endsAt unchanged', () => {
    const vat = makeRigVATFixture()
    const { playback } = createVATMesh(vat, makeFixtureCrowd())

    const instance = { clip: vat.clips[1]!, startTime: 4, loopMode: LoopMode.Once }
    setVATInstance(playback, 1, instance)

    const row = Array.from((playback.texture.image.data as Float32Array).slice(20, 40))
    expect(row.slice(0, 6)).toEqual([10, 8, 24, 1, 4, LoopMode.Once])
    expect(playback.texture.updateRanges).toEqual([{ start: 20, count: 20 }])
    // One play of an 8-frame, 24 fps clip from t = 4.
    expect(endsAt(instance)).toBeCloseTo(4 + 8 / 24, 6)
  })

  it('rides a BatchedMesh, resolving the logical index through getIndirectIndex( gl_DrawID )', () => {
    const vat = makeRigVATFixture()
    const batch = makeBatchedCarrier(vat)
    const playback = createVATPlaybackTexture(makeFixtureCrowd())

    const material = patchVATMaterial(new MeshStandardMaterial(), vat, createVATUniforms(), playback, batch)
    const depth = createVATDepthMaterial(vat, createVATUniforms(), playback, batch)

    const { vertexShader } = compile(material)
    expect(vertexShader).toContain('mat4 vatSkin = vatSkinMatrix( int( getIndirectIndex( gl_DrawID ) ) );')
    expect(vertexShader).toContain('mat4 vatSkinN = vatSkinMatrix( int( getIndirectIndex( gl_DrawID ) ) );')
    expect(vertexShader).not.toContain('vatSkinMatrix( gl_InstanceID )')
    expect(compile(depth).vertexShader).toContain('getIndirectIndex( gl_DrawID )')
    // The batch copies the skinning attributes with the geometry it was handed.
    expect(batch.geometry.getAttribute('skinIndex')).toBeDefined()
    expect(batch.geometry.getAttribute('skinWeight')).toBeDefined()
    // And the two carriers stay off one compiled program.
    expect(material.customProgramCacheKey()).not.toBe(
      materialsOf(createVATMesh(vat, makeFixtureCrowd()).mesh)[0]!.customProgramCacheKey(),
    )
  })
})
