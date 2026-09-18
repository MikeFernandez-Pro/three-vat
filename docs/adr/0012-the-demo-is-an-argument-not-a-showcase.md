# The demo is an argument, not a showcase

The demo page is built around **one control**: a count slider from 1 to 340.
At 1 there is a single robot, centred, idling. Past a first threshold walkers
appear, circling; past a second, runners on the outside. The baked VAT is drawn
on screen throughout, with a cursor per instance marking the frame row it is
sampling, and the draw-call counter is the one number given visual emphasis —
because it does not move. This replaces the fixed three-zone crowd of 340
robots that the page previously opened on.

The old page showed the *result* and asked the reader to take the mechanism on
trust. It opened on 340 robots, which is impressive for about two seconds and
then indistinguishable from any other crowd demo: a stranger has no way to know
the CPU is not skinning all of them. The count slider makes the reader produce
the evidence themselves — they drag, the crowd grows by two orders of magnitude,
and the two numbers that would climb in a `SkinnedMesh` scene (draw calls, VAT
size) visibly refuse to. That is the library's entire claim, delivered without a
sentence of prose, which is the only form of it that survives contact with
someone who has never heard of a VAT.

## Considered and rejected

- **Keep the crowd page and add the narrative one.** Two page types under
  ADR-0011 means four files, doubling the duplication that ADR accepts — and
  doubling it for the page a newcomer is *less* likely to need. The crowd page's
  scale is not lost: 340 is the top of the slider.
- **A clip picker at count 1**, letting the reader switch the soloist's
  animation and watch the cursor jump bands. Genuinely the most fun version, and
  deferred rather than rejected: it adds a second control before the first one
  has landed, and the growing crowd already lights up every band. Revisit once
  the single-control page is real.
- **Zones as a fixed layout.** Retained in substance, dropped as a concept. The
  bands still exist; they are now what raising the count reveals, so the reader
  discovers them by dragging instead of reading a caption.

## Consequences

- The three-zone layout in `examples/src/crowd.ts` becomes a function of count,
  with thresholds, rather than a partition of a fixed crowd.
- The VAT debug view (`vat-debug.ts`) is visible by default, not behind a
  toggle. It stops being a diagnostic and becomes the evidence. What hides
  behind a toggle instead is the engineering overlay — stats-gl, frame timings.
- The VAT's dimensions and memory footprint are shown on screen. The demo
  teaches the cost as well as the benefit; a reader who later asks "will this
  blow up my page?" has already been shown the answer.
- The demo is the source of the README's hero image, and that image should be
  produced by a capture script driving the built page headlessly — so it
  regenerates on release instead of going stale the first time the demo changes.
