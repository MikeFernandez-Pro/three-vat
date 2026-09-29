# A rig crossfade blends each slot as three's mixer does, about its pivot

Under the rig encoding, an instance mid-crossfade tore into spikes and looping limbs on both decode paths (#128). The decode blended each slot's root-space transform on its own: a normalised lerp of the rotation and a lerp of the translation. A rig-texture translation is where the slot puts the model's origin, not where its pivot is. So a limb that turns far between the two clips swung about the model's origin, and the four slots one vertex reads swung apart. Against three's `AnimationMixer` running `crossFadeTo` between the same two clips, Soldier went 1.45 units wrong at half weight, most of its own height. The at-row oracle could not see it, and nor could the parity gate: the two paths agreed with each other, and each band alone was right.

The mixer blends each bone's *local* transform and composes the chain back down. A crossfade now does the same. Between neighbouring frames of one band nothing changes: a row still blends slot by slot, where a limb turns a degree and the two agree.

## What a slot is, seen from its parent

A slot is `A × G × C`. `G` is its node's pose in root space. `C` is the constant taking part-local geometry into the node's space: `boneInverse × bindMatrix`, or the identity for a rigid part. `A` is where the part puts bind space: `placement × rootMatrix`, which is the identity for a rigid part and, under the attached bind mode, for a skinned one too. Take two slots whose nodes are parent and child and whose `A` agree. Then `parent⁻¹ × child` is `C_parent⁻¹ × local × C_child`, three's own local transform seen through two constants. Both are rows the texture already holds.

Three blends a local as a slerp of the rotation, a lerp of the scale and a lerp of the translation. Seen through the constants, those become:

- **The rotation is a slerp still.** A slerp commutes with a fixed rotation on either side.
- **The scale is a lerp still.** One scale is all a slot has.
- **The translation is a lerp of where the transform puts the pivot**, not of the translation itself. The pivot is `C⁻¹ × origin`, the node's origin in the slot's geometry.

So each slot needs two constants no frame row holds: its pivot, and the slot it hangs from.

## The hierarchy row

The rig texture gains one row below its bands, at `y = totalFrames`. Each slot's first texel there holds `(pivot.xyz, parent)`, with `-1` at the top of a chain. The second texel is spare. The parent is the slot of the nearest ancestor node, inside the subtree, that some slot reads through the same `A`. A slot with none is the top of its chain, and is blended as it stands, about its pivot.

A crossfading slot is walked up its chain. At each step, the slot's pose at both bands is seen from its parent's pose at the same band, blended about its pivot by the crossfade's weight, and composed onto what is below it. The parent's two poses are carried up to the next step, so a chain `d` deep reads `d` slots a band.

The CPU definition is `skinFromRigFrame` in src/test-utils.ts. The GLSL `vatCrossfadeSlot` and the TSL `crossfadeCorrection` transcribe it, and share one slerp threshold, `RIG_SLERP_LINEAR_ABOVE`. On Soldier and on the skull, against the mixer crossfading the same clips, it lands within 2e-5 at every weight tested, four decimals, the tolerance each band is held to alone.

## Considered options

- **Blend about the pivot, in root space.** Keep one slot at a time, but lerp where the slot puts its pivot rather than the origin, and rotate about it. This needs one constant a slot and no walk. Rejected: it removes the tear but not the error. Soldier stays 0.16 off the mixer at half weight and the skull's walk into death 0.58 off, because a limb blended in root space shortens across a chord where the mixer swings it round an arc. That is where the vertex encoding already lands, and #128 asks for the mixer.
- **Store each slot's local transform in the frame rows.** Rejected: it doubles the texture for what two constants recover, and the crossfade still needs the parent and the pivot.
- **Blend on the CPU, or in a pass of its own**, once per instance rather than once per vertex. Rejected: the library puts nothing on the CPU per frame. A pass of its own would be a second render target on the WebGL path and a compute pass on the other, for a cost only instances mid-transition pay.
- **A cap on chain depth**, known when the shader compiles. Not needed. The GLSL loop reads the rig's width off `textureSize`, and TSL takes it as a constant. No chain is longer than the rig is wide, and each walk breaks at the top of its chain.

## Consequences

- **The baked file's format version is 2.** A version 1 rig file has no hierarchy row, and a crossfade would read its last frame for one. `loadVAT` refuses it and asks for a re-bake (ADR-0034). The committed `examples/public/Soldier.vat.glb` is baked again.
- **The rig texture is one row taller:** `slotCount × 2` texels, 1.6 kB on Soldier. The frame rows are the same texels they were. The Soldier digest pin covers them unchanged, and pins the hierarchy row on its own. A rig bake whose frames fill `maxTextureSize` exactly now has one row too many: the rig encoding refuses it, and the default falls back to the vertex encoding, which still fits.
- **Only an instance mid-crossfade pays**, nine fetches a step up a chain about a dozen slots deep on Soldier. The GLSL guard that already skipped the outgoing band now skips the walk. The TSL path had no branch and still has none above the sampling. The walk is inline behind the one `If` on that path, handed back as a correction to the live slot matrix, which is zero at a weight of zero. So the live pose stays in the graph where CI can inspect it, and an idle crowd no longer fetches the outgoing band at all. A layout function would have been cleaner, but three r186 does not reach the rig texture's binding from one. Measured on the idle Soldier crowd page, best GPU frame, before and after interleaved, on an RTX 5080: WebGL 1.182–1.213 ms before and 1.183–1.211 ms after at 340 instances, which is no change. WebGPU 1.285–1.308 ms before and 1.247–1.265 ms after at 500, about 3% faster. What a crowd *mid-crossfade* costs was not measured.
- **Exact where the mixer's chain is the slot chain.** A node no vertex reads that sits between two slots, or above the top of a chain, is blended as part of the slot below it rather than on its own. Where that node animates differently between the two clips, the blend is close rather than exact. RobotExpressive's arm, under an animated pivot no vertex reads, is the case. So is a part under the detached bind mode whose placement is not its parent's, which is the top of its own chain. Neither Soldier's rig nor the skull's has one that moves between the clips tested.
- **The crossfade and events pages bake the default encoding again**, both renderers, and their workaround comments are gone.
