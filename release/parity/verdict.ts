// What a set of gate frames means.
//
// Split from the rendering on purpose: getting the frames needs a browser, a
// WebGPU adapter and a GPU, and deciding what they say needs none of those. So
// the decision is pure, and pinned by verdict.test.ts in CI — which is the only
// way a gate that cannot itself run in CI can be trusted to still work.
//
// Ten checks, in the order a reader should think about them: is there a picture
// at all, is it the right way up, do the backends agree before the VAT is
// involved, do they agree on which texel each vertex reads — column, then row —
// do the two decodes agree — and then four that ask whether this
// gate would have noticed if one of them were wrong. Two kinds of wrong, on
// either path: geometry in the wrong place, and geometry in the right place lit
// by the wrong normals. The second is the one that matters, because it is the
// one a loose tolerance cannot see.
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

  // And four times over, the reason to believe the line above. A gate whose
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
  // Both kinds of fault, because they are not equally easy to catch. A clock
  // slip moves the silhouette, and almost any tolerance sees that. Wrong normals
  // move no geometry at all: the silhouette is pixel-exact and only the shading
  // inside it is wrong, which is the shape of the bug a VAT is most likely to
  // have on one path only, and the one a tolerance loses first.
  const slip = `${FAULT_FRAMES} baked frame${FAULT_FRAMES === 1 ? "" : "s"}`;
  const faults = [
    [`${slip} slip`, "GLSL path", diffFrames(webgl.slipped, webgl.clean, size)],
    [`${slip} slip`, "TSL path", diffFrames(tsl.slipped, tsl.clean, size)],
    ["wrong-normal decode", "GLSL path", diffFrames(webgl.wrongNormals, webgl.clean, size)],
    ["wrong-normal decode", "TSL path", diffFrames(tsl.wrongNormals, tsl.clean, size)],
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
