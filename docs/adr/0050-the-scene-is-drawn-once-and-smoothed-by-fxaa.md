# The scene is drawn once, and smoothed by FXAA

*Last Light*'s frame drew the scene twice. A pre-pass, without
multisampling, wrote the normals, the fog amount and the depth that the
ambient occlusion, the outlines and the depth of field read; then the scene
pass drew the picture, multisampled. The AO gathers depth texels, and WGSL
has no gather over a multisampled depth, so the antialiased pass could not
serve it. Every rat in view was decoded and drawn in both, and the pre-pass
filled a whole screen of its own.

On an RTX 5080 at 1920 x 1000 the pre-pass, the AO and the depth of field
together were about half the GPU frame: 0.8 ms of 1.6 at 2,000 rats, 1.7 of
3.2 at 8,192. The audience is PC players first, most on GPUs several times
slower, and the quality ladder (ADR-0048) sheds the depth of field and then
the AO when frames run slow.

## The decision

The scene is drawn once, unsampled. Beside its colour and the unshaded mark
it writes the normal and the fog amount a pixel, and its own depth is the one
the AO, the outlines and the depth of field read. FXAA smooths the edges after
the shading and the ink and before the depth of field, the hatching and the
grain, so the grain and the hatching stay crisp. What is light rather than
surface adds nothing to the normals: the torch's flame, embers and smoke,
which stay unshaded as before, and the eyes' trails, drawn additively over
the ground. The layer that kept them out of the pre-pass goes with it.

## Considered

- **Keeping the multisampled scene pass and writing the depth as a colour
  beside it.** One pass and the same antialiasing, but a resolved depth is an
  average at every silhouette, a depth no surface has: the AO and the outlines
  would draw halos round every rat.
- **SMAA in place of FXAA.** Sharper on thin lines, at the cost of more
  passes. FXAA showed no shimmer on the rats' tails in motion, so the cheaper
  one stands; SMAA is the step to take if it ever does.

## Consequences

- The GPU frame falls by a third at 2,000 rats and by 40 to 50 % at 8,192
  and 16,384 (2026-10-08, RTX 5080, smooth, `?loop`): 1.42 to 0.95 ms, 3.20
  to 1.93 ms, 4.88 to 2.71 ms, best frames. At 8,192 rats the frame rate rises
  from 186 to the 240 Hz cap, at 16,384 from 141 to 200.
- The post's CPU falls a little, 0.1 to 0.3 ms, with one scene render fewer.
- The edges are FXAA's rather than multisampling's: in stills at three times
  their size the two are hard to tell apart.
- A material drawn additively over surfaces must say it adds nothing to the
  normals (`leaveOutOfShading`), or the AO and the outlines read it.
- The normals are written even while nothing reads them, with the AO, the
  outlines and the depth of field all off: one target more in the one pass,
  where the pre-pass was a whole draw.
