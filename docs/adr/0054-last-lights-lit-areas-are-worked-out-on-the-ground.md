# Last Light's lit areas are worked out on the ground, and shared by the swarm and the drawing

*Last Light*'s level got walls (#175), and light had to stop at them. A rat
must sit in a wall's shadow right beside a light, and what looks lit must be
what the rats avoid. Two things read light: the **swarm** keeps rats out of
it, and the drawing lights the ground with it. If each worked out its own,
the two would disagree at every wall.

## The decision

Each light's **lit area** is the ground it can see within its reach, against
the walls, worked out on the ground and nowhere else
(`games/last-light/src/litareas.ts`).

- **A star round the light.** What a light sees is star-shaped round it: one
  distance a direction, out to the first wall. Each light keeps a table of 512
  directions, filled by casting a ray each way against the walls' boxes, out
  to 8 m. A direction between two of them reads the nearer of the two, so a
  ray slipping past a wall's corner never lights its shadow. The lit area is
  the ground within both the table's distance and the light's reach that way,
  its flame leaning as the swarm's does.
- **When.** The torch's row is worked out again wherever the torch moves: by
  the CPU step each step, and by the page each frame for the drawing and the
  GPU step, whose few steps a frame all read the frame's row. A placed light's
  is worked out when it moves, which a fixed light does once, when the level
  loads.
- **The swarm** (CPU and GPU alike) reads the tables:
  - A rat in a wall's shadow from a light is not held off by it at all: no
    edge, no burn, no flinch. So rats sit in the shadow beside a light.
  - A rat outside every lit area does not step into one. Its move is undone,
    which also stops it slipping sideways round a shadow's edge.
  - A rat caught between a light and a wall runs along the wall, the way the
    light sees further, rather than into the wall.
- **The drawing** reads the same tables from one texture, read the same way
  (`seen.ts`, `lights.ts`). Each placed light's lamp is cut to its lit area
  through the lamp's own shadow node, its flame leaning at the swarm's time.
  The torch is drawn as a live light, and its lamp is cut by what it sees,
  the walls alone: its own falloff ends it. On WebGPU the swarm's step reads
  the page's texture. On WebGL 2 the worker works out its own tables, by the
  same code from the same walls.
- **Walls** (`walls.ts`) are straight pieces 0.3 m thick. A body, a rat or
  the holder, keeps its radius off a wall's box, rounded at the ends. A move
  slides along the first face or end it meets; a move that would still end
  inside a wall or across one is not made. Rats are not routed round walls.
  They press on them toward the holder.
- **A far light** is seen where nothing stands between it and the eye. Its
  flame and its halo are drawn over the fog, unlit, and the depth of whatever
  stands before them hides them, so a wall hides a light behind it.

## Considered

- **A shadow-casting lamp for every light.** Each would draw a cube of six
  shadow passes over the swarm every time it changed. The swarm could not
  read them, so the drawing and the rats would still disagree.
- **A polygon per light**, clipped against the walls. It is exact at any
  distance, but a rat would test it edge by edge, and the GPU step would need
  a list of edges per light. A table of 512 directions is read in one
  lookup. Its error is under a twentieth of a metre at 3 m, and the swarm and
  the drawing share it.
- **The farther of the two directions** either side of a rat. A ray slipping
  past a wall's corner would light a sliver of its shadow, and push rats out
  of shade they stand in by right.

## Consequences

- The tables take 35 KB, 17 rows of 512 directions: the torch's, then up to
  16 placed lights', in the order the step takes the lit ones. A placed light
  switched on or off moves the rows after it, and they are worked out again.
- A step reads at most 64 walls on the GPU, a uniform array beside the
  lights'; a level with more is refused when the step is made. Rats brought
  round ahead of the light are set down only inside the level's box. The worker finds walls through a grid of 2 m cells. With 8,192
  rats, two dozen walls and eight lights, a step stays inside its sixtieth of
  a second (the swarm's budget test).
- The torch's lamp always has a shadow node now. Its cube of shadows comes
  only with `?shadows` at the start; the panel's toggle does not add it later.
- A rat beyond the **noticing distance** (9 m in the game) does not run at
  the holder: it seethes where it is. The rats no longer cross the level to
  the light, so the level's dark stays full of them.
- The test hall's see-through (ADR-0049) is brought over to the blockout's
  walls, not merged: the circle round the holder, cut by a Bayer threshold.
