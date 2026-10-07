# The look steps down where a device cannot keep up

*Last Light* is meant to run smoothly on any fairly recent phone, not only on
the desktop it is built on. Measured on an iPhone 15 Pro Max on 2026-10-07,
over https so the phone gets WebGPU, with 2,000 rats:

| What is drawn | WebGPU | WebGL 2 |
| --- | --- | --- |
| The whole look, pixel ratio 2 | 28.6 ms, 35 fps | 49.7 ms, 20 fps |
| The whole look, pixel ratio 1.5 | 25.4 ms, 39 fps | |
| The whole look, pixel ratio 1 | 16.7 ms, 60 fps | |
| No depth of field or AO, pixel ratio 2 | 16.7 ms, 60 fps | |

The swarm's step was 1.9 ms there and the page's own work 2 to 4 ms: the
frame is the GPU drawing the look. Depth of field and AO together cost about
12 ms at a pixel ratio of 2, and a pixel ratio of 1.5 buys little. Phones
short of this one have GPUs several times slower, and some have no WebGPU.

## The decision

The look is a ladder of steps (`src/quality.ts`): the whole look; without
depth of field; without AO; the pixel ratio down to 1.5, then 1; then half
the rats, then a quarter. A pixel ratio the screen does not go above is no
step. A phone, read as a coarse pointer, starts without depth of field and
AO; anything else starts with the whole look.

A governor moves along the ladder by how the frames come. Over a second and
a half, if more than a quarter of the frames take longer than 20 ms, it
steps down one. A frame rate between 30 and 60 on a 60 Hz screen alternates
one vsync and two, so it counts as slow; one hitch among smooth frames does
not. After each change it judges nothing for a second, while the new
pipeline compiles.

A 60 Hz screen shows a frame every 16.7 ms however little the GPU needed, so
room to spare cannot be read off the frames. After five seconds of smooth
frames the governor tries a step up. If that step is too slow it comes back
down and waits twice as long before trying again; after two failures it never
tries that step again. A phone heating up only gets slower, so a step given
up stays given up.

The step takes the depth of field, the AO and the rats away without touching
the panel's own settings. The readout line names the step. `?step=N` starts on
step N. `?adapt=0`, or any measuring switch (`?ao=0`, `?dof=0`, `?dpr=N`,
`?post=0`), holds the step where it starts, so what is measured is what was
asked for.

## Considered

- **A fixed phone setting.** No depth of field and no AO held 60 fps on this
  phone. A weaker phone would still fall short, and a stronger one, or this
  one with room to spare, would draw less than it can.
- **Picking the step by device name.** The GPU's name is mostly hidden from
  the page, and a list of devices is out of date as soon as it is written.
- **Reading room to spare from GPU timestamps.** Not every browser offers them
  (WebKit gates them), and the WebGL 2 backend reads them late.
- **The swarm's step on the GPU.** Measured on 2026-10-06 (branch
  `prototype/gpu-step`) at 150 to 600 times the CPU's step. Not taken: on the
  phone the step is 1.9 ms at 2,000 rats and the frame is the drawing.

## Consequences

- On this phone the game starts without depth of field and AO at full
  sharpness, and keeps it. It tries AO twice, a stutter each time, and gives
  it up.
- A failed try is a second or two of slow frames: at most two for each step.
- Fewer rats is the last resort, since it changes the game and not only the
  look; the swarm grows back at the arena's edge when the step comes back up.
- A screen held at 30 Hz, as iOS does in Low Power Mode, reads as slow frames
  whatever is drawn, and the governor steps down to the bottom.
- WebGPU is measured faster than WebGL 2 on the phone: 35 against 20 fps on
  the whole look. It needs a secure context, so the game is served to a phone
  over https (`pnpm --dir games/last-light phone`).
- Over plain http the same phone read the swarm's step at 18 to 24 ms, ten
  times what it read over https minutes later, cause unknown. Phone numbers
  are taken over https.
