import { FloatType, Material, MeshDepthMaterial, MeshDistanceMaterial, MeshStandardMaterial, Object3D, RGBAFormat, ShaderLib } from 'three'
import type { Mesh, RawShaderMaterial, WebGLProgramParametersWithUniforms, WebGLRenderer, WebGLRenderTarget } from 'three'
import { describe, expect, it } from 'vitest'
import {
  createVATPlaybackTexture,
  endsAt,
  EndMode,
  INFINITE_REPETITIONS,
  LoopMode,
  PACK_TEXELS,
  pauseVATInstance,
  setVATInstance,
} from './instance-playback.js'
import { RIG_HIERARCHY_TEXELS, RIG_SLERP_LINEAR_ABOVE, RIG_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import {
  compileVATMaterial as compile,
  makeBatchedCarrier,
  makeFixtureCrowd,
  makeRigVATFixture,
  makeVATFixture,
  uploadedByRenderer,
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
    expect(vertexShader).toContain(`slot * ${RIG_TEXELS_PER_SLOT} + ${RIG_TEXELS.rotation},`)
    expect(vertexShader).toContain(`slot * ${RIG_TEXELS_PER_SLOT} + ${RIG_TEXELS.placement},`)
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
    expect(vertexShader).toContain('return vatCompose( pose.q, pose.ts );')
  })

  it('transforms position, normal and tangent by the skin matrix', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    expect(vertexShader).toContain('vec3 transformed = ( vatSkin * vec4( position, 1.0 ) ).xyz;')
    expect(vertexShader).toContain('vec3 objectNormal = normalize( mat3( vatSkin ) * normal );')
    expect(vertexShader).toContain('vec3 objectTangent = normalize( mat3( vatSkin ) * tangent.xyz );')
    // Under three's own guard, so a geometry without a tangent compiles.
    expect(vertexShader.indexOf('#ifdef USE_TANGENT')).toBeLessThan(vertexShader.indexOf('objectTangent'))
  })

  it('resolves the skin matrix once a vertex, first thing in main', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile(materialsOf(mesh)[0]!)
    expect(vertexShader.match(/vatSkinMatrix\( gl_InstanceID \)/g)).toHaveLength(1)
    expect(vertexShader).toMatch(/void main\(\) \{\s+mat4 vatSkin = vatSkinMatrix\( gl_InstanceID \);/)
  })

  it('resolves it ahead of the dead block three keeps a chunk in, on the real depth shader (ADR-0006)', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const shader = { uniforms: {}, vertexShader: ShaderLib.depth.vertexShader, fragmentShader: '' }
    ;(mesh.customDepthMaterial as MeshDepthMaterial).onBeforeCompile(
      shader as unknown as WebGLProgramParametersWithUniforms,
      null as unknown as WebGLRenderer,
    )
    const resolved = shader.vertexShader.indexOf('mat4 vatSkin = vatSkinMatrix( gl_InstanceID );')
    expect(resolved).toBeGreaterThan(-1)
    expect(resolved).toBeLessThan(shader.vertexShader.indexOf('#ifdef USE_DISPLACEMENTMAP'))
    expect(shader.vertexShader.match(/vatSkinMatrix\( gl_InstanceID \)/g)).toHaveLength(1)
  })

  it('finds main however a shader of the caller spells its opening', () => {
    const material = patchVATMaterial(
      new MeshStandardMaterial(),
      makeRigVATFixture(),
      createVATUniforms(),
      createVATPlaybackTexture(makeFixtureCrowd()),
    )

    const shader = { uniforms: {}, vertexShader: 'void main()\n{\n#include <begin_vertex>\n}', fragmentShader: '' }
    material.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, null as unknown as WebGLRenderer)
    expect(shader.vertexShader).toMatch(/void main\(\)\s+\{\s+mat4 vatSkin = vatSkinMatrix\( gl_InstanceID \);/)
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
    expect(vertexShader).toContain('( vatNow - vatPlayback.x ) * abs( vatClip.w )')
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
      'rows.weight = 1.0 - clamp( ( vatNow - vatCrossfade.y ) / vatCrossfade.x, 0.0, 1.0 );',
    )
    expect(vertexShader).toContain('return vatBand( vatOutClip, vatOutPlayback, vatNow );')
    // The guard stays on this encoding, where what it skips is the walk up
    // each slot's chain. #72 measured the cheaper guard of old worth keeping:
    // the rig decode did not get slower when the crossfade landed, and the
    // vertex decode did (ADR-0025).
    expect(vertexShader).toContain('VatBand outgoing = vatOutgoingBand( vatInstance, rows.weight > 0.0, rows.now );')
    expect(vertexShader).toContain(
      'if ( rows.weight > 0.0 ) pose = vatCrossfadeSlot( slot, rows.live, outgoing, rows.weight );',
    )
    expect(vertexShader).toContain('else pose = vatSlotAt( slot, rows.live );')
  })

  it('crossfades a slot by walking its chain through the hierarchy row, as the mixer blends (ADR-0039)', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const crossfade = functionOf(compile(materialsOf(mesh)[0]!).vertexShader, 'VatPose vatCrossfadeSlot(')
    // The hierarchy row is the texture's last, read off the texture itself,
    // and no chain is longer than the rig is wide.
    expect(crossfade).toContain('int hierarchyRow = size.y - 1;')
    expect(crossfade).toContain(`int slots = size.x / ${RIG_TEXELS_PER_SLOT};`)
    expect(crossfade).toContain('for ( int i = 0; i < slots; i ++ ) {')
    expect(crossfade).toContain(
      `texelFetch( uVatRigTex, ivec2( n * ${RIG_TEXELS_PER_SLOT} + ${RIG_HIERARCHY_TEXELS.pivot}, hierarchyRow ), 0 );`,
    )
    // The top of a chain blended as it is; every slot below it seen from its
    // parent at both bands, and the parent's poses carried up a step.
    expect(crossfade).toContain('if ( parent < 0 ) return vatThen( vatBlendAbout( a, b, hierarchy.xyz, w ), result );')
    expect(crossfade).toContain(
      'result = vatThen( vatBlendAbout( vatRelative( pa, a ), vatRelative( pb, b ), hierarchy.xyz, w ), result );',
    )
    expect(crossfade).toContain('a = pa;')
    expect(crossfade).toContain('b = pb;')
    // A true slerp between the clips, past the one threshold all three share.
    expect(compile(materialsOf(mesh)[0]!).vertexShader).toContain(
      `if ( cosAngle < ${RIG_SLERP_LINEAR_ABOVE} ) {`,
    )
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
    uploadedByRenderer(playback.texture)

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
    expect(vertexShader.match(/vatSkinMatrix\( int\( getIndirectIndex\( gl_DrawID \) \) \)/g)).toHaveLength(1)
    expect(vertexShader).toMatch(/void main\(\) \{\s+mat4 vatSkin = vatSkinMatrix\( int\( getIndirectIndex\( gl_DrawID \) \) \);/)
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

describe('a rig crossfade blended once an instance, on WebGL (ADR-0060)', () => {
  /** A renderer as the pass meets it, keeping what it was asked to draw, where, and how it was set. */
  const drawing = ({ floats = true } = {}) => {
    const draws: { object: Object3D; target: unknown; flags: boolean[] }[] = []
    const targets: unknown[][] = []
    let target: unknown = 'the frame'
    const renderer = {
      extensions: { has: (name: string) => floats && name === 'EXT_color_buffer_float' },
      xr: { enabled: true },
      shadowMap: { autoUpdate: true },
      info: { autoReset: true },
      getRenderTarget: () => target,
      getActiveCubeFace: () => 3,
      getActiveMipmapLevel: () => 1,
      setRenderTarget(to: unknown, face = 0, level = 0) {
        target = to
        targets.push([to, face, level])
      },
      render(object: Object3D) {
        draws.push({ object, target, flags: [renderer.xr.enabled, renderer.shadowMap.autoUpdate, renderer.info.autoReset] })
      },
    }
    return { draws, targets, renderer }
  }
  /** One draw of the crowd, as three makes it: `onBeforeRender` with the renderer first. */
  const draw = (mesh: Object3D, renderer: object) =>
    mesh.onBeforeRender(renderer as never, null as never, null as never, null as never, null as never, null as never)
  /** One shadow draw of the crowd: `onBeforeShadow`, the renderer first. */
  const shadow = (mesh: Object3D, renderer: object) =>
    mesh.onBeforeShadow(renderer as never, null as never, null as never, null as never, null as never, null as never, null as never)

  const canDraw = drawing().renderer as unknown as WebGLRenderer

  it('reads what the pass wrote where the renderer can draw it, in every material the crowd draws with', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const { draws, renderer } = drawing()
    draw(mesh, renderer)
    const target = draws[0]!.target as WebGLRenderTarget

    for (const material of [...materialsOf(mesh), mesh.customDepthMaterial!, mesh.customDistanceMaterial!]) {
      const { uniforms, vertexShader } = compile(material, canDraw)
      expect(uniforms['uVatFadedRotation']?.value).toBe(target.textures[0])
      expect(uniforms['uVatFadedPlacement']?.value).toBe(target.textures[1])
      const slot = functionOf(vertexShader, 'mat4 vatSlot(')
      expect(slot).toContain('texelFetch( uVatFadedRotation, ivec2( slot, vatInstance ), 0 );')
      expect(slot).toContain('texelFetch( uVatFadedPlacement, ivec2( slot, vatInstance ), 0 );')
      expect(slot).not.toContain('vatCrossfadeSlot(')
      // Nothing is walked here, so nothing resolves the band being left.
      expect(functionOf(vertexShader, 'mat4 vatSkinMatrix(')).not.toContain('vatOutgoingBand(')
    }
  })

  it('walks the chain in the vertex shader, as before, where the renderer cannot draw float targets', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    for (const renderer of [null, drawing({ floats: false }).renderer as unknown as WebGLRenderer]) {
      const { uniforms, vertexShader } = compile(materialsOf(mesh)[0]!, renderer)
      expect(vertexShader).toContain('if ( rows.weight > 0.0 ) pose = vatCrossfadeSlot( slot, rows.live, outgoing, rows.weight );')
      expect(uniforms['uVatFadedRotation']).toBeUndefined()
    }
  })

  it('keeps the reading program off a hand-patched crowd’s, which draws no pass', () => {
    const vat = makeRigVATFixture()
    const playback = createVATPlaybackTexture(makeFixtureCrowd())
    const patched = patchVATMaterial(new MeshStandardMaterial(), vat, createVATUniforms(), playback)
    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(compile(patched, canDraw).vertexShader).toContain('vatCrossfadeSlot( slot, rows.live, outgoing, rows.weight )')
    expect(materialsOf(mesh)[0]!.customProgramCacheKey()).not.toBe(patched.customProgramCacheKey())
  })

  it('walks in the pass as the vertex shader walks: the same rows and the same function', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const { draws, renderer } = drawing()
    draw(mesh, renderer)
    const pass = (draws[0]!.object as Mesh).material as RawShaderMaterial
    const { vertexShader } = compile(materialsOf(mesh)[0]!)

    for (const declaration of ['VatBand vatBand(', 'VatRows vatRows(', 'VatBand vatOutgoingBand(', 'VatPose vatCrossfadeSlot(']) {
      expect(functionOf(pass.fragmentShader, declaration)).toBe(functionOf(vertexShader, declaration))
    }
    // A fragment a slot and an instance, and nothing written for one not fading.
    expect(pass.fragmentShader).toContain('int slot = int( gl_FragCoord.x );')
    expect(pass.fragmentShader).toContain('int vatInstance = int( gl_FragCoord.y );')
    expect(pass.fragmentShader).toContain('if ( rows.weight <= 0.0 ) discard;')
    expect(pass.fragmentShader).toContain('VatPose pose = vatCrossfadeSlot( slot, rows.live, outgoing, rows.weight );')
    expect(pass.fragmentShader).not.toMatch(/^\s*attribute\s/m)
  })

  it('draws into two float targets, a column a slot and a row an instance', () => {
    const vat = makeRigVATFixture()
    const { mesh, playback } = createVATMesh(vat, makeFixtureCrowd())
    const { draws, renderer } = drawing()
    draw(mesh, renderer)
    const target = draws[0]!.target as WebGLRenderTarget

    expect(target.textures).toHaveLength(2)
    expect([target.width, target.height]).toEqual([vat.rigTexture.image.width / RIG_TEXELS_PER_SLOT, playback.count])
    for (const texture of target.textures) expect([texture.type, texture.format]).toEqual([FloatType, RGBAFormat])
  })

  it('draws the pass at the first draw, then only while a fade can be running, once a moment', () => {
    const vat = makeRigVATFixture()
    const { mesh, time, playback } = createVATMesh(vat, makeFixtureCrowd())
    const { draws, renderer } = drawing()

    draw(mesh, renderer)
    expect(draws).toHaveLength(1) // compiled ahead of any fade
    draw(mesh, renderer)
    expect(draws).toHaveLength(1) // nothing fading

    time.value = 1
    setVATInstance(playback, 0, { clip: vat.clips[1]!, startTime: 1, fadeDuration: 0.5 })
    shadow(mesh, renderer) // the shadow maps are drawn first
    draw(mesh, renderer) // and the crowd at the same moment
    expect(draws).toHaveLength(2)
    time.value = 1.2
    draw(mesh, renderer)
    expect(draws).toHaveLength(3)
    time.value = 1.5 // the blend's end: weight zero from here
    shadow(mesh, renderer)
    draw(mesh, renderer)
    expect(draws).toHaveLength(3)
  })

  it('keeps drawing while an instance is paused short of its blend’s end', () => {
    const vat = makeRigVATFixture()
    const { mesh, time, playback } = createVATMesh(vat, makeFixtureCrowd())
    const { draws, renderer } = drawing()
    setVATInstance(playback, 0, { clip: vat.clips[1]!, startTime: 1, fadeDuration: 0.5 })
    pauseVATInstance(playback, 0, 1.2)

    for (const at of [2, 3, 10]) {
      time.value = at
      draw(mesh, renderer)
    }

    expect(draws).toHaveLength(3)
  })

  it('draws with the shadow maps, XR and the count held, and puts back the target it interrupted', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const { draws, targets, renderer } = drawing()

    draw(mesh, renderer)

    expect(draws[0]!.flags).toEqual([false, false, false])
    expect(targets[targets.length - 1]).toEqual(['the frame', 3, 1])
    expect([renderer.xr.enabled, renderer.shadowMap.autoUpdate, renderer.info.autoReset]).toEqual([true, true, true])
  })

  it('draws no pass where the renderer cannot draw float targets', () => {
    const vat = makeRigVATFixture()
    const { mesh, time, playback } = createVATMesh(vat, makeFixtureCrowd())
    const { draws, renderer } = drawing({ floats: false })
    setVATInstance(playback, 0, { clip: vat.clips[1]!, startTime: 0, fadeDuration: 0.5 })

    time.value = 0.2
    draw(mesh, renderer)
    shadow(mesh, renderer)

    expect(draws).toHaveLength(0)
  })

  it('keeps the crowd’s own hooks, set after the pass, and runs them first', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const order: string[] = []
    mesh.onBeforeRender = () => { order.push('own render') }
    mesh.onBeforeShadow = () => { order.push('own shadow') }
    const { renderer } = drawing()
    renderer.render = () => { order.push('pass') }

    shadow(mesh, renderer)
    draw(mesh, renderer)

    expect(order).toEqual(['own shadow', 'pass', 'own render'])
  })

  it('frees its targets and its program with the crowd', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const { draws, renderer } = drawing()
    draw(mesh, renderer)
    const target = draws[0]!.target as WebGLRenderTarget
    const pass = (draws[0]!.object as Mesh).material as RawShaderMaterial
    let freed = 0
    target.addEventListener('dispose', () => { freed++ })
    pass.addEventListener('dispose', () => { freed++ })

    mesh.dispose()

    expect(freed).toBe(2)
  })

  it('draws no pass for the vertex encoding', () => {
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())
    const { draws, renderer } = drawing()

    draw(mesh, renderer)

    expect(draws).toHaveLength(0)
    expect(mesh.onBeforeRender).toBe(Object3D.prototype.onBeforeRender)
  })
})
