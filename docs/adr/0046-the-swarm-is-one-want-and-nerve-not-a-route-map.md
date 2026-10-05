# The swarm is one want and nerve, not a route map

ADR-0045 gave *Last Light*'s **swarm** two layers: a route map drawn ten times
a second that led each rat round the mass to wherever the **ring** had room,
and bodies that pushed. It moved like a crowd, and it read as one: the ring
ran tidily, all one way, and the mass behind it stood and waited. Starving
rats do not queue tidily. The swarm is now written from scratch with one
layer and no map. It was built as a prototype beside the route-map swarm,
compared side by side and in the game under `?frenzy`, and kept in its place
on 2026-10-05.

## One want

Every rat wants one thing: the holder. Nothing tells it to circle, and
nothing routes it. It runs straight in at its own speed. What stops it is the
light's edge, which it will not step over, and the bodies ahead of it. A rat
stopped that way slides sideways, toward whichever side is less crowded, and
keeps its side until the other is clearly emptier. That is the only reason a
rat goes round the light, so the milling at the edge comes out of crowding, in
every direction at once. There is no ring: no band, and no line between
circling and waiting.

**Bodies** stay from ADR-0045, softer. Overlapping rats push apart, but a
rat pressing on another sinks about a third of a body into it before the push
holds it, so the mass overlaps and climbs over itself as it presses in. And
every rat writhes at walking pace in a way its whim picks, on top of where it
wants to go, so a rat packed in where it can go nowhere seethes in place
instead of standing still.

## Nerve

The light burns. A rat at its edge holds there only as long as it can stand
it, a second or two, each rat its own; then it flinches back through the mass
for a moment, and comes again. Fear spreads: a rat that has stood the edge a
while flinches with a rat beside it that just did, so the **front** recoils in
clumps. Each rat has its own nerve, how close it dares come, from the edge
itself to twice the gap off it. So the front is never a line: it breaks open
in bays where clumps flinch, and the rats behind pour in. The flame flickers
too, so the edge the rats press on is never a circle.

A rat at the light's edge faces it. One flinching, caught in the light, or in
the way of a light coming at it turns and runs. Every other rat faces where it
really goes, so the mass behind points every way, and no rat ever backs away
facing the light.

**The light moves no rat**, as before. A rat at its edge only refuses to step
in. A walking light reaches ahead along its path so rats get out of its way
before it arrives; rats it overtakes, or a relit light opens over, run out on
their own. **The gait** is read as before, from how fast a rat really moves.

## Considered options

Keeping the route map and retuning it. Every look it could be tuned to kept
the ring's order, because the map's whole job is to spread rats evenly round
the ring; the tidiness was the design, not a value. The three swarms (the
rules model, the route map, this one) ran side by side in a throwaway page,
and this one in the game itself.

## Consequences

- The panel's crowd folder shrinks to what this swarm reads: how fast rats
  writhe, how far ahead they read a walking light, and how far they keep off
  it. How hard bodies push is a constant with its reasoning beside it, not a
  slider.
- The rat scale no longer widens a ring, because there is none: it scales
  the collision disc alone.
- Rats that go round to the empty side of the light join the front there, so
  the mass behind the front is on the side it came from, and the far side of
  the front fills slowly: from empty to about a sixth of it in twenty seconds,
  at 2,000 rats. The tests pin the growth, not a share.
- The mass packs denser than the ring did, bodies overlapping: at 4,000
  rats, half of them are within about two metres of the light's edge.
- The cost is one pass over the rats and a neighbour grid, and no map:
  0.8 ms a step at 2,000 rats and 3.5 ms at 8,192 in Node, packed round a
  still light, once the per-rat `Math.hypot` calls became square roots and the
  flame's flicker was read from a table filled once a step rather than three
  sines a rat (2026-10-05). The frame was bound by the main thread, never the
  GPU: 1.8 ms at 2,000 and 4.9 ms at 8,192, the step two thirds of it, until
  the step moved to a worker (ADR-0047).
