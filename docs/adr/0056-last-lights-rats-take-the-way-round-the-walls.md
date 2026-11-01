# Last Light's rats take the way round the walls

> Amends [ADR-0054](./0054-last-lights-lit-areas-are-worked-out-on-the-ground.md),
> whose rats were not routed round walls.

Since the level got **walls** (ADR-0054), every rat ran straight at the
holder and pressed on any wall in the way, sliding along it. In the sewers
the rats come out of holes in the walls, from behind pillars and from the
ground beyond the walls, and a wall stands between most of them and the
holder. They piled on the back of the nearest wall, aimed at a light they
could not reach, and stayed there until the holder walked round. A
prototype ran the swarm twice side by side on a hall with pillars, two
walls across it and holes through its outer walls. Rats appeared outside it
and had to find a hole in. After 35 s, with 1,500 rats, 648 were in the hall
straight at the holder and 1,166 taking the way round; 244 were held
against a wall, against 24. *A Plague Tale* steers its rats with a flow
field too (AI and Games #73).

## The decision

A rat that sees the holder clearly runs straight at it, as ADR-0046 has it.
A rat that a wall stands between it and the holder takes the shortest way
round the walls instead, and counts how far the holder is along that way
for its **noticing distance** (`games/last-light/src/flowfield.ts`).

- **The field knows the walls and the holder, never the rats.** It is a
  square of 96 cells a side, 25 cm each, round the holder: 24 m, the game's
  9 m noticing distance each way and a margin. Its corner is snapped to the
  cells, so it slides with the holder in whole cells.
- **Clear sight** is a star of 512 rays from the holder against the walls,
  as a lit area is, but out to the square's corners. A cell the holder sees
  clearly, 25 cm off every wall's face either side of the line, holds its
  straight distance, and no rat in it reads the field.
- **The rest** are filled outward from those cells round the walls by fast
  marching, a wave in which each cell is worked out from its nearer known
  neighbour each way. Each cell points down the slope of its neighbours'.
  A rat reads the four cells round it, blended.
- **When.** The field is worked out again when the holder has moved half a
  cell: by the CPU step in the worker, and for the GPU step by a worker of
  its own, which the page sends the holder and which answers with the field
  for a texture of four numbers a cell. On the page it cost 2 ms a rebuild,
  fourteen times a second as the goose walked, and 10 ms on a slow CPU; the
  field now lags her by a frame or two. On open ground,
  with no walls, nothing is worked out and every rat runs straight.
- **A rat past its noticing distance along the way** seethes where it is.
  A rat a wall's width from the holder, and thirteen metres round it, no
  longer smells it through the wall.

## Considered

- **ADR-0045's route map**, superseded by ADR-0046. That map was drawn over
  the crowd: packed cells cost more, and routes led round the mass to
  wherever the ring round the light had room. Spreading rats evenly round
  the light was its whole job, and it made the swarm tidy. This field reads
  no crowd and has no ring. It changes only where a rat out of the holder's
  sight heads; the crowd, the edge and the nerve are ADR-0046's.
- **Eight ways out from each cell (Dijkstra).** Simpler, but its ways come
  out in eighths of a turn: a rat behind a wall went for its end 20° off.
  Fast marching gives smooth ways, though a distance reads up to a fifth
  long where the wave bends round a corner. A rat then notices a holder
  round a corner a little later.
- **The field over the whole arena.** At 16,384 rats the arena is 60 m
  across, 57,600 cells. Only the rats within noticing distance read it, so
  the square round the holder is enough. A rat off it runs straight, and is
  past noticing anyway at the game's 9 m.

## Consequences

- Working the field out costs about 1.5 ms in Node with two dozen walls,
  about eight times a second for a holder at walking pace. The step's budget
  test (8,192 rats, 24 walls, 8 lights, a sixtieth of a second) still holds.
  Reading it costs a rat four cells, on the CPU and the GPU alike.
- Fewer rats reach the holder at once where walls stand between them: those
  whose way round is past their noticing distance stay where they are.
  Rats come through a hole a few at a time, so how wide a hole is sets how
  fast it lets them in.
- The field takes the walls the step reads, 64 at most on the GPU, picked
  nearest the holder as before.
