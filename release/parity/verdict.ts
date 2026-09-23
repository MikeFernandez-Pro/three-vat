// What a set of gate frames means.
//
// Split from the rendering on purpose: getting the frames needs a browser, a
// WebGPU adapter and a GPU, and deciding what they say needs none of those. So
// the decision is pure, and pinned by verdict.test.ts in CI — which is the only
// way a gate that cannot itself run in CI can be trusted to still work.
//
// Eighteen checks, in the order a reader should think about them: is there a
// picture at all, is it the right way up, do the backends agree before the VAT
// is involved, do they agree on which texel each vertex reads — column, then
// row — do the two decodes agree; then the same question for the second
// carrier, plus the one only that carrier can ask (does the crowd survive its
// drawn slots being permuted); then the same question for the second encoding,
// which is a second decode on each path; and then eight that ask whether this
// gate would have noticed if any of it were wrong. Three kinds of wrong, on
// either path: geometry in the wrong place, geometry in the right place lit by
// the wrong normals, and two right bands mixed at the wrong weight. The last two
// are the ones that matter, because they are the ones a loose tolerance cannot
// see.
import { diffFrames, isBlank, orientationOf, withinTolerance, type FrameDiff, type FrameSize, type PathFrames } from "./compare.js";
import { FAULT_FRAMES, FRAME } from "./scene.js";

/** The frames the gate compares: one set per decode path, from one bake. */
export interface ParityFrames {
  webgl: PathFrames;
  tsl: PathFrames;
}

/** One question the gate asks, and what the frames answered. */
export interface ParityCheck {
  name: string;
  pass: boolean;
  /** Why it passed or failed, in a line a developer can act on. */
  detail: string;
  diff?: FrameDiff;
}

export interface ParityVerdict {
  pass: boolean;
  checks: ParityCheck[];
}

const percent = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;

const describeDiff = (diff: FrameDiff) =>
  `${diff.differing} of ${diff.drawn} drawn pixels differ (${percent(diff.differingFraction)}), worst channel ${diff.maxChannelDelta}/255, mean ${diff.meanChannelDelta.toFixed(2)}`;

/** Read a set of frames and return the gate's verdict. */
export function judge(frames: ParityFrames, size: FrameSize = FRAME): ParityVerdict {
  const { webgl, tsl } = frames;
  const checks: ParityCheck[] = [];

  // Guards the guard. Two empty frames are a perfect match, so without this a
  // harness that never built a crowd would report the cleanest pass of its life.
  const blank = [
    ["GLSL", isBlank(webgl.clean)],
    ["TSL", isBlank(tsl.clean)],
    ["GLSL batched", isBlank(webgl.batched)],
    ["TSL batched", isBlank(tsl.batched)],
    ["GLSL rig", isBlank(webgl.rig.clean)],
    ["TSL rig", isBlank(tsl.rig.clean)],
  ].filter(([, isIt]) => isIt);
  checks.push({
    name: "both paths drew something",
    pass: blank.length === 0,
    detail: blank.length === 0 ? "both frames have a crowd in them" : `nothing drawn on the ${blank.map(([p]) => p).join(" and ")} path — the gate compared empty frames`,
  });

  // A readback convention is a thing a renderer is free to change, and if one
  // ever does, every comparison below diverges at once. That deserves its own
  // sentence rather than sending someone into the shaders.
  const orientation = orientationOf(webgl.clean, tsl.clean, size);
  checks.push({
    name: "the two readbacks come back the same way up",
    pass: orientation === "upright",
    detail:
      orientation === "upright"
        ? "both frames are top-down"
        : "the frames match only when one is flipped — a readback row order changed; fix the flip in webgl-frame.ts before reading anything below",
  });

  // Before the decode is blamed for anything: do the backends even agree about
  // shading the same geometry, with no VAT involved?
  const room = diffFrames(webgl.calibration, tsl.calibration, size);
  checks.push({
    name: "the backends light the same room the same way",
    pass: withinTolerance(room),
    detail: `rest pose, no decode — ${describeDiff(room)}`,
    diff: room,
  });

  // Between the backends agreeing about shading and the decodes agreeing about
  // pixels sits the question that tells those two apart when the gate fails:
  // do the paths even read the same texels? The probe paints the decode's
  // inputs — the vertex's texture column and its instance's clip band — with no
  // VAT sampled at all. If this fails, the addressing diverged and the sampling
  // is not worth looking at yet; if it passes while the check below fails, both
  // paths read the same texels and do different things with them.
  const addressing = diffFrames(webgl.probe, tsl.probe, size);
  checks.push({
    name: "the two paths read the same texel for the same vertex",
    pass: withinTolerance(addressing),
    detail: withinTolerance(addressing)
      ? `vertex index and clip band agree — ${describeDiff(addressing)}`
      : `the decode's inputs differ before a texel is sampled — ${describeDiff(addressing)}. Red is the vertex index's low byte, green its high byte, blue the instance's clip start: whichever channel moved names the wrong one.`,
    diff: addressing,
  });

  // And the other half of the addressing: the row, which is where the clock,
  // the clip's own frame count and its fps all land. Between this and the check
  // above, every number `texelFetch`/`textureLoad` is handed has been compared.
  // If both pass and the gate below fails, the two paths are being given the
  // same coordinates and handed back different texels.
  const sampling = diffFrames(webgl.sampleProbe, tsl.sampleProbe, size);
  checks.push({
    name: "the two paths compute the same texture row for the same vertex",
    pass: withinTolerance(sampling),
    detail: withinTolerance(sampling)
      ? `frame row and blend factor agree — ${describeDiff(sampling)}`
      : `the clock lands on different rows — ${describeDiff(sampling)}. Red is the row's low byte, green its high byte, blue the blend between rows.`,
    diff: sampling,
  });

  // The gate.
  const decode = diffFrames(webgl.clean, tsl.clean, size);
  checks.push({
    name: "the two decode paths render the same pixels",
    pass: withinTolerance(decode),
    detail: describeDiff(decode),
    diff: decode,
  });

  // The same question again for the second carrier. A `BatchedMesh` reaches its
  // instance's pack by a different route on each path — `getIndirectIndex(
  // gl_DrawID )` in GLSL, the `batchIndirectIndex` varying in TSL — so the two
  // agreeing on an `InstancedMesh` says nothing about them agreeing here.
  const batchedDecode = diffFrames(webgl.batched, tsl.batched, size);
  checks.push({
    name: "the two decode paths agree on a BatchedMesh crowd",
    pass: withinTolerance(batchedDecode),
    detail: describeDiff(batchedDecode),
    diff: batchedDecode,
  });

  // And the question only this carrier can be asked: is the pack read by the
  // *instance* or by the slot the frame happened to draw it in? Three
  // instances, three clips, three phases; reversing the draw order and nothing
  // else must not move a pixel. A decode reading the drawn slot renders a
  // different crowd here, which is the stripe test in one number.
  //
  // Within one path, never across, for the same reason the fault checks below
  // are: the only variable that may differ between these two frames is the
  // permutation.
  for (const [path, rendered] of [["GLSL", webgl], ["TSL", tsl]] as const) {
    const permuted = diffFrames(rendered.batchedReordered, rendered.batched, size);
    checks.push({
      name: `the ${path} path's batched crowd survives its draw order being permuted`,
      pass: withinTolerance(permuted),
      detail: withinTolerance(permuted)
        ? `the drawn slot is not the instance — ${describeDiff(permuted)}`
        : `reversing the batch's draw order changed the picture — ${describeDiff(permuted)}. The pack is being read by the drawn slot rather than by the logical index, so instances are playing each other's clips.`,
      diff: permuted,
    });
  }

  // The second encoding. A rig-encoded VAT is a different decode on each path —
  // four slots skinned from a rig texture rather than a texel per vertex
  // (ADR-0018) — so everything above, which the robot's vertex bake proved,
  // proves nothing about it. Its own asset and its own bake, in the same room at
  // the same clock; named apart from the robot so a failure here is read as the
  // rig decode drifting and not as the gate failing wholesale.
  const rigDecode = diffFrames(webgl.rig.clean, tsl.rig.clean, size);
  checks.push({
    name: "the two decode paths agree on a rig-encoded crowd",
    pass: withinTolerance(rigDecode),
    detail: describeDiff(rigDecode),
    diff: rigDecode,
  });

  // And eight times over, the reason to believe the comparisons above. A gate whose
  // tolerance has drifted wide enough to pass a broken decode passes a correct
  // one too, and looks identical doing it — so each run re-earns its own
  // credibility by failing on faults it introduced itself.
  //
  // Each fault is compared against the *same path's* clean frame, never against
  // the other path's. Comparing across paths would fold the parity result into
  // the self-test: once the two paths disagree, every cross-path comparison
  // differs by roughly that much whatever fault is in it, and four checks that
  // cannot fail would sit here reporting the baseline divergence back as proof
  // of their own sharpness. Within one path there is exactly one variable, which
  // is the fault.
  //
  // It also makes each of these a liveness probe: a path that decoded nothing at
  // all would render the same frame at `TIME` and one frame later, and say so
  // here rather than somewhere downstream.
  //
  // All three kinds of fault, because they are not equally easy to catch. A
  // clock slip moves the silhouette, and almost any tolerance sees that. Wrong
  // normals move no geometry at all: the silhouette is pixel-exact and only the
  // shading inside it is wrong, which is the shape of the bug a VAT is most
  // likely to have on one path only, and the one a tolerance loses first. A
  // wrong crossfade weight moves neither: both bands are the right bands on the
  // right rows, and only the proportion between them is wrong — which is the
  // half of a transition each path computes for itself, beside the band
  // resolver the two hold in common (ADR-0025).
  //
  // The wrong weight goes to the vertex case alone, where the clean frames of
  // every carrier and both encodings already carry the transition: the fault is
  // in the weight, which is one number per instance and the same arithmetic
  // whichever encoding the bands come out of, so a second copy of it on the rig
  // case would re-ask a question this one has already answered.
  //
  // The rig case gets the slip alone: a rig has no normal texture to bend, its
  // normals come out of the skin matrix with its positions, so a slip is the
  // one fault it can be handed — and the one it needs, since the same frame at
  // `TIME` and one frame later is what a rig decode that drew nothing renders.
  const slip = `${FAULT_FRAMES} baked frame${FAULT_FRAMES === 1 ? "" : "s"}`;
  const faults = [
    [`${slip} slip`, "GLSL path", diffFrames(webgl.slipped, webgl.clean, size)],
    [`${slip} slip`, "TSL path", diffFrames(tsl.slipped, tsl.clean, size)],
    ["wrong-normal decode", "GLSL path", diffFrames(webgl.wrongNormals, webgl.clean, size)],
    ["wrong-normal decode", "TSL path", diffFrames(tsl.wrongNormals, tsl.clean, size)],
    ["wrong crossfade weight", "GLSL path", diffFrames(webgl.wrongWeight, webgl.clean, size)],
    ["wrong crossfade weight", "TSL path", diffFrames(tsl.wrongWeight, tsl.clean, size)],
    [`${slip} slip`, "rig-encoded GLSL crowd", diffFrames(webgl.rig.slipped, webgl.rig.clean, size)],
    [`${slip} slip`, "rig-encoded TSL crowd", diffFrames(tsl.rig.slipped, tsl.rig.clean, size)],
  ] as const;

  for (const [fault, path, diff] of faults) {
    checks.push({
      name: `a deliberate ${fault} on the ${path} fails this gate`,
      pass: !withinTolerance(diff),
      detail: withinTolerance(diff)
        ? `a ${fault} on this path alone went unnoticed — ${describeDiff(diff)}. Either the tolerance is too loose to catch a real divergence, or this path is not decoding at all.`
        : `caught — ${describeDiff(diff)}`,
      diff,
    });
  }

  return { pass: checks.every((check) => check.pass), checks };
}
