import {
  BatchedMesh,
  BufferAttribute,
  Material,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
} from 'three'
import { describe, expect, it } from 'vitest'
import { EndMode, INFINITE_REPETITIONS, LoopMode, PACK_TEXELS } from './instance-playback.js'
import {
  compileVATMaterial as compile,
  makeBatchedCarrier,
  makeVATFixture,
  makeFixtureCrowd,
} from './test-utils.js'
import { createVATMesh, createVATUniforms, createVATDepthMaterial, patchVATMaterial } from './webgl.js'
import type { VATPostDecodeHook } from './webgl.js'
import type { VAT } from './types.js'
import { createVATPlaybackTexture, setVATInstance } from './instance-playback.js'
import { makeRigVATFixture } from './test-utils.js'

// `createVATPlaybackTexture` itself is covered in instance-playback.test.ts —
// it is core, not WebGL. What belongs here is the other half of the contract:
// that the GLSL decode reads the pack those tests describe.

// ---------------------------------------------------------------- createVATMesh

describe('createVATMesh', () => {
  it('returns a renderable InstancedMesh carrying the crowd', () => {
    const vat = makeVATFixture()

    const { mesh, playback } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.count).toBe(2)
    expect(playback.count).toBe(2)
    // One row per instance, three texels wide: clip (start row, frames, fps,
    // speed), playback (start time, loop mode, repetitions, end mode) and a
    // fade of zeroes — an endless looper and a rewinding one-shot, whose
    // defaults were filled in once, in core.
    expect(playback.texture.image.data).toEqual(
      new Float32Array([
        0, 10, 30, 2, -1.5, 0, -1, 0, 0, 0, 0, 0,
        10, 8, 24, 0.5, -0.25, 1, 1, 1, 0, 0, 0, 0,
      ]),
    )
  })

  it('renders the bake’s own geometry, bounds and all — the clone went with the attributes', () => {
    // The clone existed for the instance-playback attributes and for nothing
    // else (ADR-0016). With the pack in a texture there is nothing per-crowd
    // left on the geometry, so two crowds over one bake share it — and its
    // all-frames bounds, which is what stops a deformed crowd culling
    // mid-animation.
    const vat = makeVATFixture()

    const a = createVATMesh(vat, makeFixtureCrowd())
    const b = createVATMesh(vat, makeFixtureCrowd())

    expect(a.mesh.geometry).toBe(vat.geometry)
    expect(b.mesh.geometry).toBe(vat.geometry)
    expect(a.playback.texture).not.toBe(b.playback.texture)
    expect(a.mesh.geometry.boundingBox).toBe(vat.geometry.boundingBox)
  })

  it('carries a baked tangent through to the rendered geometry', () => {
    // The merge preserving `tangent` only buys a normalMap anything if the
    // attribute reaches the drawn mesh, and the decode already declares
    // `objectTangent` for it.
    const vat = makeVATFixture()
    vat.geometry.setAttribute('tangent', new BufferAttribute(new Float32Array(24), 4))

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const tangent = mesh.geometry.getAttribute('tangent')
    expect(tangent).toBeDefined()
    expect(tangent.itemSize).toBe(4)
    expect(compile((mesh.material as Material[])[0]!).vertexShader).toContain('objectTangent')
  })

  it('prepares one patched material per geometry group, cloned from the source', () => {
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const materials = mesh.material as Material[]
    expect(materials.map((m) => m.name)).toEqual(['body', 'visor'])
    // Every group must resolve to a material: `materialIndex` indexes this
    // array, and a group pointing past its end draws nothing at all.
    for (const group of mesh.geometry.groups) expect(materials[group.materialIndex!]).toBeDefined()
    for (const [i, material] of materials.entries()) {
      expect(material, 'the source material must not be mutated').not.toBe(vat.materials[i])
      expect(compile(material).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
    }
  })

  it('binds this crowd’s playback texture into every material it patches', () => {
    // The pack is no longer on the geometry, so a material that did not bind
    // the texture would decode another crowd’s playback — or none at all.
    const vat = makeVATFixture()

    const { mesh, playback } = createVATMesh(vat, makeFixtureCrowd())

    const patched = [...(mesh.material as Material[]), mesh.customDepthMaterial!, mesh.customDistanceMaterial!]
    for (const material of patched) {
      expect(compile(material).uniforms['uVatPlaybackTex']?.value).toBe(playback.texture)
    }
  })

  it('attaches the depth material instanced shadows need', () => {
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const depth = mesh.customDepthMaterial as MeshDepthMaterial
    expect(depth).toBeInstanceOf(MeshDepthMaterial)
    expect(depth.depthPacking).toBe(RGBADepthPacking)
    expect(compile(depth).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
  })

  it('attaches the distance material point-light shadows need', () => {
    // Which shadow material a scene uses is a property of its lights, so a
    // crowd that deforms under a directional light and snaps to the bind pose
    // under a point light is exactly the surprise this call removes.
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const distance = mesh.customDistanceMaterial as MeshDistanceMaterial
    expect(distance).toBeInstanceOf(MeshDistanceMaterial)
    expect(compile(distance).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
  })

  it('drives every material and the depth pass from one exposed clock', () => {
    const vat = makeVATFixture()

    const { mesh, time } = createVATMesh(vat, makeFixtureCrowd())
    time.value = 3

    const patched = [...(mesh.material as Material[]), mesh.customDepthMaterial!, mesh.customDistanceMaterial!]
    for (const material of patched) {
      expect(compile(material).uniforms['uVatTime']).toBe(time)
    }
  })

  it('shares a caller-owned clock, so two crowds animate off one time value', () => {
    const time = createVATUniforms().uVatTime

    const a = createVATMesh(makeVATFixture(), makeFixtureCrowd(), { time })
    const b = createVATMesh(makeVATFixture(), makeFixtureCrowd(), { time })

    expect(a.time).toBe(time)
    expect(compile((a.mesh.material as Material[])[0]!).uniforms['uVatTime']).toBe(time)
    expect(compile((b.mesh.material as Material[])[0]!).uniforms['uVatTime']).toBe(time)
  })
})

describe('the GLSL decode reads the instance-playback pack', () => {
  it('fetches the pack by the instance’s logical index, and samples through it', () => {
    // The decode's own arithmetic, asserted as source: this is the only place
    // in CI where the GLSL the shader actually compiles can be inspected, and
    // the pack's component order is the thing a repack gets wrong silently.
    //
    // A logical index and not an attribute: an attribute with divisor 1 is
    // indexed by the *drawn* slot, and the drawn slot stops being the instance
    // the moment a renderer culls or sorts per instance (ADR-0016). On this
    // carrier the two coincide and the index is `gl_InstanceID`; the
    // `BatchedMesh` case is below.
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile((mesh.material as Material[])[0]!)
    expect(vertexShader).toContain('uniform highp sampler2D uVatPlaybackTex;')
    expect(vertexShader).not.toContain('attribute vec4 aVat')
    expect(vertexShader).toContain(
      `vec4 vatClip     = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.clip}, vatInstance ), 0 );`,
    )
    expect(vertexShader).toContain(
      `vec4 vatPlayback = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.playback}, vatInstance ), 0 );`,
    )
    // frames / fps, the clip's duration.
    expect(vertexShader).toContain('float frames = vatClip.y;')
    expect(vertexShader).toContain('float duration = frames / vatClip.z;')
    // ( now - startTime ) * speed, the local time this instance is at.
    expect(vertexShader).toContain('( uVatTime - vatPlayback.x ) * vatClip.w')
    // The band is addressed from the clip's own start row.
    expect(vertexShader).toContain('int( vatClip.x + f0 )')
    expect(vertexShader).toContain('int( vatClip.x + f1 )')
    // …and the row the pack is fetched at is this carrier's own spelling of the
    // logical index, handed to the decode at the injection point.
    expect(vertexShader).toContain('vatSample( uVatPosTex, gl_InstanceID )')
  })

  it('branches on the loop mode, the repeat count and the end mode', () => {
    // The loop modes as GLSL, and the reason this assertion is worth making at
    // all: `resolveVATFrame` is the one definition of these semantics, but CI
    // cannot run the transcription of it — so it reads it instead.
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile((mesh.material as Material[])[0]!)
    // Loop mode is the playback texel's y, repetitions z, end mode w — the
    // component order is the thing a repack gets wrong silently.
    expect(vertexShader).toContain('float repetitions = vatPlayback.z;')
    expect(vertexShader).toContain('vatPlayback.y == 2.0')
    expect(vertexShader).toContain('vatPlayback.w == 0.0 ? 1.0 : 0.0')
    // -1 repetitions is the infinite sentinel, and a finished clip is one whose
    // repetitions have run out.
    expect(vertexShader).toContain('repetitions != -1.0 && loops >= repetitions')
  })

  it('spells the mode constants from the contract, never as retyped literals', () => {
    // Renumber `LoopMode` and this shader must follow. Interpolated from the
    // one definition, so it does — this asserts that it is interpolated rather
    // than coincidentally equal.
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile((mesh.material as Material[])[0]!)
    expect(vertexShader).toContain(`vatPlayback.y == ${LoopMode.PingPong.toFixed(1)}`)
    expect(vertexShader).toContain(`vatPlayback.w == ${EndMode.Clamp.toFixed(1)}`)
    expect(vertexShader).toContain(`repetitions != ${INFINITE_REPETITIONS.toFixed(1)}`)
  })

  it('never samples outside the clip’s own band', () => {
    // Both rows are clamped to the band's last frame, and only a wrapping clip
    // may cross back into the first. That is what keeps a ping-pong and a
    // finished one-shot from reading a neighbouring clip's rows.
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile((mesh.material as Material[])[0]!)
    expect(vertexShader).toContain('float f0 = min( floor( f ), last );')
    expect(vertexShader).toContain('float f1 = wraps ? mod( f0 + 1.0, frames ) : min( f0 + 1.0, last );')
  })

  it('blends a frozen outgoing row in, weighted by wall clock', () => {
    // The pose-freeze fade: one row of the clip the instance was playing,
    // mixed away over the fade texel's w. The elapsed time is not scaled by
    // the clip texel's w — a fade is seconds of clock, so a half-speed clip
    // does not get a fade twice as long — and a duration of zero is not fading
    // at all.
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile((mesh.material as Material[])[0]!)
    expect(vertexShader).toContain(
      `vec4 vatFade     = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.fade}, vatInstance ), 0 );`,
    )
    expect(vertexShader).toContain('if ( vatFade.w > 0.0 ) {')
    expect(vertexShader).toContain(
      'float weight = 1.0 - clamp( ( uVatTime - vatPlayback.x ) / vatFade.w, 0.0, 1.0 );',
    )
    expect(vertexShader).toContain(
      'float fromRow = max( min( floor( vatFade.z * vatFade.y ), vatFade.y - 1.0 ), 0.0 );',
    )
    expect(vertexShader).toContain('sampled = mix( sampled, frozen, weight );')
  })
})

describe('createVATMesh on a VAT baked without normals', () => {
  it('samples the position texture and nothing else', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    for (const material of mesh.material as Material[]) {
      const shader = compile(material)
      expect(shader.uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
      // No dead uniform left bound, and no sampler declared for it.
      expect(shader.uniforms['uVatNrmTex']).toBeUndefined()
      expect(shader.vertexShader).not.toContain('uVatNrmTex')
    }
  })

  it('leaves three’s own normal stage alone, so flatShading can do its work', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const shader = compile((mesh.material as Material[])[0]!)
    expect(shader.vertexShader).toContain('#include <beginnormal_vertex>')
    expect(shader.vertexShader).not.toContain('objectNormal')
    // The position decode is untouched by any of this.
    expect(shader.vertexShader).toContain('vec3 transformed = position + vatSample( uVatPosTex, gl_InstanceID );')
  })

  it('still patches the shadow materials, which shade from nothing', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(compile(mesh.customDepthMaterial!).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
    expect(compile(mesh.customDistanceMaterial!).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
  })

  it('refuses a smooth-shaded lit material rather than lighting the rest pose', () => {
    // The one pairing `bakeNormals: false` must not render: the crowd would be
    // lit by bind-pose normals, which is the failure bakeVAT exists to prevent
    // (ADR-0002). It is silent if allowed through — the geometry still carries
    // a rest normal for three to shade with.
    const vat = makeVATFixture({ bakeNormals: false })
    ;(vat.materials[0] as MeshStandardMaterial).flatShading = false

    expect(() => createVATMesh(vat, makeFixtureCrowd())).toThrow(/bakeNormals: false/)
  })
})

describe('program cache keys', () => {
  it('separates the two patches, so the shadow materials cannot share a program', () => {
    // A normal-less VAT injects a different vertex shader off the same material
    // parameters. On the render material `flatShading` happens to differ too,
    // but `createVATDepthMaterial` builds the identical MeshDepthMaterial for
    // either kind of VAT — so without distinct keys the second crowd's shadow
    // pass would be handed the first's compiled program (ADR-0006).
    const withNormals = createVATMesh(makeVATFixture(), makeFixtureCrowd())
    const without = createVATMesh(makeVATFixture({ bakeNormals: false }), makeFixtureCrowd())

    const key = (material: Material) => material.customProgramCacheKey()
    expect(key(without.mesh.customDepthMaterial!)).not.toBe(key(withNormals.mesh.customDepthMaterial!))
    expect(key(without.mesh.customDistanceMaterial!)).not.toBe(key(withNormals.mesh.customDistanceMaterial!))
    expect(key((without.mesh.material as Material[])[0]!)).not.toBe(
      key((withNormals.mesh.material as Material[])[0]!),
    )
  })

  it('still separates a patched material from an unpatched one', () => {
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    expect((mesh.material as Material[])[0]!.customProgramCacheKey()).toBe('three-vat:instance')
    expect(new MeshStandardMaterial().customProgramCacheKey()).not.toBe('three-vat:instance')
  })
})

// ------------------------------------------------------- the BatchedMesh carrier

describe('a crowd on a BatchedMesh', () => {
  // The second carrier, and the case the playback texture was built for: three
  // culls and sorts per instance by default, so the drawn slot is a permutation
  // that changes every frame and the pack has to be read by the logical index
  // three dereferences it to (ADR-0016).
  const patched = () => {
    const vat = makeVATFixture()
    const batch = makeBatchedCarrier(vat)
    const playback = createVATPlaybackTexture(makeFixtureCrowd())
    const material = patchVATMaterial(new MeshStandardMaterial(), vat, createVATUniforms(), playback, batch)
    return { vat, batch, playback, material, shader: compile(material) }
  }

  it('resolves the logical index through getIndirectIndex( gl_DrawID )', () => {
    // three's own dereference, from `batching_pars_vertex` — the same one it
    // uses to find an instance's matrix. Reachable at both injection points
    // because `batching_vertex` is expanded before them in every material this
    // patches, which is also why the index is a parameter rather than read
    // inside the prelude.
    const { shader } = patched()

    expect(shader.vertexShader).toContain(
      'vec3 transformed = position + vatSample( uVatPosTex, int( getIndirectIndex( gl_DrawID ) ) );',
    )
    expect(shader.vertexShader).toContain(
      'normalize( vatSample( uVatNrmTex, int( getIndirectIndex( gl_DrawID ) ) ) )',
    )
    // And never the drawn slot, which is what this carrier permutes.
    expect(shader.vertexShader).not.toContain('vatSample( uVatPosTex, gl_InstanceID )')
  })

  it('reads the pack out of the crowd’s own playback texture, as the other carrier does', () => {
    const { playback, shader } = patched()

    expect(shader.uniforms['uVatPlaybackTex']?.value).toBe(playback.texture)
  })

  it('keeps the two carriers off one compiled program', () => {
    // The material parameters are identical and the injected GLSL is not, so
    // without the carrier in the key three would hand a batched crowd the
    // instanced crowd's program — and every instance would read row
    // `gl_InstanceID` of a texture keyed by something else (ADR-0006).
    const instanced = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    expect(patched().material.customProgramCacheKey()).not.toBe(
      (instanced.mesh.material as Material[])[0]!.customProgramCacheKey(),
    )
  })

  it('patches a depth material for the same carrier', () => {
    const vat = makeVATFixture()
    const batch = makeBatchedCarrier(vat)
    const playback = createVATPlaybackTexture(makeFixtureCrowd())

    const depth = createVATDepthMaterial(vat, createVATUniforms(), playback, batch)

    expect(compile(depth).vertexShader).toContain('getIndirectIndex( gl_DrawID )')
  })

  it('refuses a batch the VAT cannot be decoded on, before it renders wrong', () => {
    // One rule, in core, read by both paths (src/carrier.ts).
    const vat = makeVATFixture()
    const empty = new BatchedMesh(2, vat.vertexCount, vat.vertexCount * 2, new MeshStandardMaterial())

    expect(() =>
      patchVATMaterial(new MeshStandardMaterial(), vat, createVATUniforms(), createVATPlaybackTexture(makeFixtureCrowd()), empty),
    ).toThrow(/holds no geometry/)
  })

  it('refuses to be drawn on the carrier it was not patched for', () => {
    // The one mistake the optional carrier argument makes possible, and it is
    // total and silent without this: a batch is multi-drawn rather than
    // instanced, so `gl_InstanceID` is 0 for every vertex and the whole crowd
    // plays instance 0's clip in lockstep.
    const vat = makeVATFixture()
    const playback = createVATPlaybackTexture(makeFixtureCrowd())
    const forInstanced = patchVATMaterial(new MeshStandardMaterial(), vat, createVATUniforms(), playback)
    const batch = makeBatchedCarrier(vat)

    const draw = (material: Material, object: object) =>
      material.onBeforeRender(
        null as never, null as never, null as never, null as never, object as never, null as never,
      )

    expect(() => draw(forInstanced, batch)).toThrow(/patched for an InstancedMesh and is being drawn on a BatchedMesh/)
    // …and the correct pairing draws without complaint, twice, because the
    // guard must not cost a throw or a check every frame.
    const { material, batch: ownBatch } = patched()
    expect(() => draw(material, ownBatch)).not.toThrow()
    expect(() => draw(material, ownBatch)).not.toThrow()
  })

  it('takes setVATInstance unchanged — the write is to the playback texture, not the carrier', () => {
    // ADR-0014, as the playback texture makes it true: changing one instance
    // is a function over the thing that carries the pack, so it knows nothing
    // about what draws the crowd.
    const vat = makeVATFixture()
    const playback = createVATPlaybackTexture(makeFixtureCrowd())
    patchVATMaterial(new MeshStandardMaterial(), vat, createVATUniforms(), playback, makeBatchedCarrier(vat))

    setVATInstance(playback, 1, { clip: vat.clips[0]!, startTime: 4 })

    const row = Array.from((playback.texture.image.data as Float32Array).slice(12, 24))
    expect(row.slice(0, 5)).toEqual([0, 10, 30, 1, 4])
    // And only that row is flagged for upload, as on the other carrier.
    expect(playback.texture.updateRanges).toEqual([{ start: 12, count: 12 }])
  })
})

// -------------------------------------------------------- the post-decode hook

describe('the post-decode hook', () => {
  // The caller's own GLSL, run after the decode has posed the vertex
  // (ADR-0021). Two injection points rather than one, because three expands
  // `beginnormal_vertex` before `begin_vertex` and derives `transformedNormal`
  // between them — so a hook with one point deforms a crowd that still shades
  // as though it never moved.
  //
  // The worked example the ADR is written against, in miniature: a twist about
  // a pivot, by a per-instance angle, applied to the position and repaired on
  // the normal, with the rotation helper shared through the prelude.
  const uTwist = { value: 0 }

  const twist = (): VATPostDecodeHook => ({
    key: 'twist',
    uniforms: { uTwist },
    prelude: 'uniform float uTwist;\nvec3 vatTwist( vec3 p, float a ) { return p * a; }',
    position: 'transformed = vatTwist( transformed, uTwist * float( vatInstanceIndex ) );',
    normal: 'objectNormal = vatTwist( objectNormal, uTwist * float( vatInstanceIndex ) );',
  })

  /** Where a needle sits in the shader, failing by name when it is absent. */
  const at = (shader: string, needle: string) => {
    const index = shader.indexOf(needle)
    expect(index, `the shader carries ${JSON.stringify(needle)}`).toBeGreaterThan(-1)
    return index
  }

  const patch = (hook: VATPostDecodeHook, vat: VAT = makeVATFixture()) =>
    compile(
      patchVATMaterial(
        new MeshStandardMaterial(),
        vat,
        createVATUniforms(),
        createVATPlaybackTexture(makeFixtureCrowd()),
        { hook },
      ),
    )

  it('runs the caller’s chunk after the decode, at both injection points', () => {
    // After, not instead of: the chunk deforms the posed vertex, so `transformed`
    // and `objectNormal` are the decode's when it reads them.
    const { vertexShader } = patch(twist())

    expect(at(vertexShader, 'transformed = vatTwist(')).toBeGreaterThan(
      at(vertexShader, 'vec3 transformed = position + vatSample( uVatPosTex, gl_InstanceID );'),
    )
    expect(at(vertexShader, 'objectNormal = vatTwist(')).toBeGreaterThan(
      at(vertexShader, 'vec3 objectNormal = normalize( vatSample( uVatNrmTex, gl_InstanceID ) );'),
    )
    // And the normal point comes first, which is the whole reason there are two
    // of them: a chunk at the position point alone is too late to repair it.
    expect(at(vertexShader, 'objectNormal = vatTwist(')).toBeLessThan(at(vertexShader, 'transformed = vatTwist('))
  })

  it('declares vatInstanceIndex at both points, spelled for the carrier', () => {
    // The one thing a chunk cannot write for itself, because how a crowd's
    // logical index is spelled is the carrier's business (ADR-0016). Declared
    // twice, once per point, because each point must stand alone (ADR-0006) —
    // and each inside its own block, so two declarations of one name compile.
    const instanced = patch(twist()).vertexShader
    expect(instanced.match(/int vatInstanceIndex = gl_InstanceID;/g)).toHaveLength(2)

    const vat = makeVATFixture()
    const batched = compile(
      patchVATMaterial(
        new MeshStandardMaterial(),
        vat,
        createVATUniforms(),
        createVATPlaybackTexture(makeFixtureCrowd()),
        { carrier: makeBatchedCarrier(vat), hook: twist() },
      ),
    ).vertexShader
    expect(batched.match(/int vatInstanceIndex = int\( getIndirectIndex\( gl_DrawID \) \);/g)).toHaveLength(2)
    expect(batched).not.toContain('vatInstanceIndex = gl_InstanceID')
  })

  it('puts the prelude ahead of three’s shader, where it is not an injection point', () => {
    // ADR-0006 governs the two chunks and not this: a helper the two share has
    // to be declared once, and a declaration is the one thing that cannot go
    // inside a block that might be dead.
    const { vertexShader } = patch(twist())

    expect(at(vertexShader, 'vec3 vatTwist( vec3 p, float a )')).toBeLessThan(at(vertexShader, 'void main()'))
  })

  it('binds the caller’s uniforms beside the library’s', () => {
    const { uniforms } = patch(twist())

    expect(uniforms['uTwist']).toBe(uTwist)
    // Beside, not instead of — the decode still has everything it binds.
    expect(uniforms['uVatTime']).toBeDefined()
    expect(uniforms['uVatPosTex']).toBeDefined()
    expect(uniforms['uVatPlaybackTex']).toBeDefined()
  })

  it('folds the caller’s key into the library’s rather than replacing it', () => {
    // Folded, so a caller cannot collapse the library's own program variants —
    // the encoding, the carrier and whether normals were baked are still in it.
    const material = patchVATMaterial(
      new MeshStandardMaterial(),
      makeVATFixture(),
      createVATUniforms(),
      createVATPlaybackTexture(makeFixtureCrowd()),
      { hook: twist() },
    )

    expect(material.customProgramCacheKey()).toBe('three-vat:instance+twist')
  })

  it('keeps two different hooks off one compiled program', () => {
    // The bug the required key exists for: two crowds whose materials are
    // identical in every parameter three looks at, and whose injected GLSL is
    // not (ADR-0006).
    const key = (hook: VATPostDecodeHook) =>
      patchVATMaterial(
        new MeshStandardMaterial(),
        makeVATFixture(),
        createVATUniforms(),
        createVATPlaybackTexture(makeFixtureCrowd()),
        { hook },
      ).customProgramCacheKey()

    expect(key(twist())).not.toBe(key({ ...twist(), key: 'sway' }))
    // …and a hooked material never shares one with an unhooked crowd either.
    expect(key(twist())).not.toBe('three-vat:instance')
  })

  it('refuses a hook that injects nothing rather than ignoring it', () => {
    expect(() =>
      patchVATMaterial(
        new MeshStandardMaterial(),
        makeVATFixture(),
        createVATUniforms(),
        createVATPlaybackTexture(makeFixtureCrowd()),
        { hook: { key: 'empty' } },
      ),
    ).toThrow(/`position`|`normal`/)
  })

  it('refuses a hook with no key, which would collapse two hooks onto one program', () => {
    expect(() =>
      patchVATMaterial(
        new MeshStandardMaterial(),
        makeVATFixture(),
        createVATUniforms(),
        createVATPlaybackTexture(makeFixtureCrowd()),
        { hook: { key: '  ', position: 'transformed.y += 1.0;' } },
      ),
    ).toThrow(/key/)
  })

  it('runs after the rig decode too, so an encoding does not cost the caller their hook', () => {
    // One chunk contract, not two: the hook runs after whatever posed the
    // vertex, and under the rig encoding that is the skinning (ADR-0018).
    const { vertexShader } = patch(twist(), makeRigVATFixture())

    expect(at(vertexShader, 'transformed = vatTwist(')).toBeGreaterThan(
      at(vertexShader, 'vec3 transformed = ( vatSkin * vec4( position, 1.0 ) ).xyz;'),
    )
    expect(at(vertexShader, 'objectNormal = vatTwist(')).toBeGreaterThan(
      at(vertexShader, 'vec3 objectNormal = normalize( mat3( vatSkinN ) * normal );'),
    )
  })

  it('deforms a normal-less VAT’s normal stage, which three declares itself', () => {
    // `bakeNormals: false` leaves three's own `beginnormal_vertex` in place —
    // the material either reads no normal or derives one from the deformed
    // position — and a hook that wants that point still gets it.
    const vat = makeVATFixture({ bakeNormals: false })
    // Flat-shaded, which is the pairing a normal-less VAT is entitled to.
    const material = new MeshStandardMaterial({ flatShading: true })

    const { vertexShader } = compile(
      patchVATMaterial(material, vat, createVATUniforms(), createVATPlaybackTexture(makeFixtureCrowd()), {
        hook: twist(),
      }),
    )

    expect(at(vertexShader, 'objectNormal = vatTwist(')).toBeGreaterThan(
      at(vertexShader, '#include <beginnormal_vertex>'),
    )
  })

  it('chains a caller’s own onBeforeCompile rather than overwriting it', () => {
    // The hook is the supported seam; this is a net. A patch that used to be
    // discarded silently now runs.
    const material = new MeshStandardMaterial()
    let ran = 0
    material.onBeforeCompile = () => {
      ran += 1
    }

    const { vertexShader } = compile(
      patchVATMaterial(
        material,
        makeVATFixture(),
        createVATUniforms(),
        createVATPlaybackTexture(makeFixtureCrowd()),
        { hook: twist() },
      ),
    )

    expect(ran).toBe(1)
    // …and it ran first, against three's own shader, so the decode still finds
    // the two injection points to replace.
    expect(vertexShader).toContain('vec3 transformed = position + vatSample( uVatPosTex, gl_InstanceID );')
  })

  it('takes the carrier through the same options object', () => {
    // The fifth parameter widens to `VATCarrier | VATPatchOptions`; a batched
    // crowd with a hook passes one object rather than a carrier and something
    // else. A carrier is an `Object3D` and an options object is not.
    const vat = makeVATFixture()
    const batch = makeBatchedCarrier(vat)

    const material = patchVATMaterial(
      new MeshStandardMaterial(),
      vat,
      createVATUniforms(),
      createVATPlaybackTexture(makeFixtureCrowd()),
      { carrier: batch },
    )

    expect(compile(material).vertexShader).toContain('getIndirectIndex( gl_DrawID )')
    expect(material.customProgramCacheKey()).toBe('three-vat:batch')
  })

  it('reaches the shadow materials, so a deformed crowd casts a deformed shadow', () => {
    // The mistake this threading exists to prevent, and the one `createVATMesh`
    // must not leave to the caller: the render material twisted and the depth
    // pass posed as though it were not.
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd(), { hook: twist() })

    const patched = [...(mesh.material as Material[]), mesh.customDepthMaterial!, mesh.customDistanceMaterial!]
    for (const material of patched) {
      const shader = compile(material)
      expect(shader.vertexShader).toContain('transformed = vatTwist(')
      expect(shader.uniforms['uTwist']).toBe(uTwist)
      expect(material.customProgramCacheKey()).toBe('three-vat:instance+twist')
    }
  })

  it('reaches a hand-wired crowd’s depth material through the same options', () => {
    const vat = makeVATFixture()
    const batch = makeBatchedCarrier(vat)

    const depth = createVATDepthMaterial(vat, createVATUniforms(), createVATPlaybackTexture(makeFixtureCrowd()), {
      carrier: batch,
      hook: twist(),
    })

    const { vertexShader } = compile(depth)
    expect(vertexShader).toContain('transformed = vatTwist(')
    expect(vertexShader).toContain('int vatInstanceIndex = int( getIndirectIndex( gl_DrawID ) );')
  })
})
