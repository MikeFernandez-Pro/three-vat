# The swarm steps in a worker, at a fixed rate

*Last Light*'s frame was bound by the main thread, never by the GPU: at 2,000
rats the **swarm**'s step was two thirds of a 1.8 ms frame, and at 8,192 it
was 3.5 of 4.9 ms, under the 4.17 ms a 240 Hz display allows. The step ran once
a frame, so at 240 fps it ran four times more often than the tests pin its
behaviours at, and everything else in the frame waited for it.

## The decision

The swarm steps in a worker, at a fixed sixtieth of a second on the worker's
own clock, whatever the frame rate. After each step the worker posts where
every rat is and which way it faces, in buffers the page hands back once it
has read them. The page stands the rats a step behind the latest post, between
it and the one before, so their motion stays smooth at any frame rate and a key
pressed reaches the rats a step late.

The page sends what the step reads, every frame: the count, the light and the
tuning. The light's walk stays on the page, worked out from the arena's radius,
which is a function of the count. The `Swarm` class is unchanged and still
tested in Node; the worker is a thin shell round it, and `RemoteSwarm` is the
page's end.

The crowd's batch is sized to the count, not to the capacity. Its matrices
texture is uploaded whole every frame, a fixed cost of the batch's size, half
a millisecond at 16,384 rows; so the batch is built at the power of two above
the count and rebuilt a size up as the count outgrows it, on the same material
and the same playback rows, since instance *i* is rat *i* in either.

## Considered

- **A fixed step on the main thread, interpolated.** Cuts the average cost by
  three quarters at 240 fps but leaves one frame in four carrying a whole
  step. The worker gives the same smoothness and takes the step off the frame
  altogether.
- **A shared buffer instead of transferred ones.** Simpler reads, but it needs
  the cross-origin isolation headers on every server the game runs from, and
  double-buffering against tearing anyway.
- **Computing each neighbour pair once.** About a quarter off the step, and a
  rewrite of its hottest loop whose sums come out in another order. Not taken:
  with the step off the frame, it would buy the frame nothing up to the
  capacity, where the step still fits its sixtieth of a second.

## Consequences

- Main thread at 2,560 x 1,300, still light: 0.8 ms at 2,000 rats, 1.1 ms at
  4,000, 1.6 ms at 8,192, all at the 240 Hz cap (2026-10-05). The worker's step
  is 1.1, 2.3 and 4.5 ms there, and about 9 ms at 16,384.
- The GPU leads only with the whole swarm in view at high counts, or with the
  lamp's cube shadows: 5.9 ms at 8,192 rats all on screen.
- The rats react a sixtieth of a second after the light moves.
- The readouts' steering time is the worker's own step, no longer part of the
  frame.
- The step's cost is bounded by the worker's sixtieth of a second: past about
  16,000 rats on this machine the simulation would fall behind real time and
  the worker would skip ahead rather than catch up.

## Amendment (#172, 2026-10-09): on WebGPU the swarm steps on the GPU

On WebGPU the worker is no longer started: the swarm steps on the GPU, in
compute passes the page runs on the same fixed sixtieth of a second, at most
four steps a frame (ADR-0053). The worker remains the step on WebGL 2, under
`?batch`, and under `?cpustep` for measuring. The CPU step and the GPU step
follow one model: every rat reads its neighbours as the last step left them,
and draws its chances from a hash of the step and its index.
