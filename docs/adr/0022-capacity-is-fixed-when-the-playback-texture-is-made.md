# Capacity is fixed when the playback texture is made

`createVATPlaybackTexture` sized itself from the instances it was handed, which
is right for a crowd placed once and wrong for one that spawns and dies. It
takes a **capacity** now, and a crowd may have zero live instances in it. Two
things it deliberately does not do, both recorded here because both look like
omissions and neither is.

**It does not allocate indices.** The caller owns them.
`BatchedMesh.addInstance` already hands out that numbering, and a pool inside
the library would be a second allocator over one set of ids.
[ADR-0014](./0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md)
refused this shape once already: changing an instance is a function, not a
subclass that owns the crowd.

**It does not follow a carrier's `setInstanceCount`.** three's `BatchedMesh` can
grow after construction. A texture cannot grow in place, so following it would
mean rebuilding the playback texture *and* rebinding it on every patched
material — the depth and distance ones included, which a caller who reached for
the primitives may not remember they have. Out of scope, said in the docs with
the one-line recipe, rather than half-supported.

## Two details that fall out

- **A reserved row holds a first frame held** — `startFrame 0`, `frames 1`,
  `speed 0` — not zeroes. In practice such a row is never sampled: three skips
  inactive instances entirely, and nothing past `InstancedMesh.count` is drawn.
  But "never" is a property of the carrier's behaviour, and a band of no frames
  divides by zero the day a caller raises `count` past their live instances.
- **A recycled index carries the dead instance's pack.** `addInstance` reissues
  the *lowest* freed id, so a spawning crowd routinely hands back a row still
  holding a corpse's clip, clamped on its last frame, until `setVATInstance`
  overwrites it. **Row recycling** is the hazard of this whole pattern, it lives
  in the reuse rather than in the initialisation, and it is documented rather
  than managed — managing it would mean owning the index, which is the decision
  above.
