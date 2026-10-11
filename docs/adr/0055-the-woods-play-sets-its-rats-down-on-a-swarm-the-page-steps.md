# The woods' play sets its rats down on a swarm the page steps

*Last Light*'s woods (#180) are played by one **play step** (`games/last-light/src/play.ts`,
#181), headless, which both the 2D page and the 3D page drive. The play sets
its rats down itself: waiting groups far ahead, spawn spots in the bushes
that wake ahead of the child, and rats left out of his sight set down again
there. To choose which rats to move, it must know where they are. On the
2D page and in the tests the swarm is the CPU's, stepped by the play as it
goes. On the 3D page the swarm steps on the GPU (ADR-0053), whose state never
left the GPU, or in a worker (ADR-0047).

This amends ADR-0053: played, the GPU swarm's places come back.

## The decision

The play takes its swarm through a seam, `PlaySwarm` (#182): how many rats
there are, where each is as last known, setting the count, setting a rat down,
the walls near the child, and moving the swarm on. Three swarms take it:

- **The CPU swarm**, `SteppedSwarm`, stepped by the play at the worker's
  pace: what the tests and the 2D page play.
- **The GPU swarm.** The page steps it as it draws, as before. Once the
  play moves it on, it reads back where every rat stands in the latest state
  after each frame that stepped, one read at a time and never awaited: 32
  bytes a rat, 32 KB a frame at the woods' budget of 1,000. A rat set down,
  or spawned, stands where it was put until a read made after the next one
  says otherwise, since the read made just after may predate its upload.
- **The worker's swarm.** The page's end sends the count at once, and the
  rats set down with the frame's input; each stands where it was set down
  for three states, those the worker may have made before it had it.

The play's choices read places a frame or two late. They only decide which
rat to set down and when a waiting rat is let go, and a rat moves under a
metre in that time.

## Considered options

- **The CPU swarm on the page as the play's, the GPU drawing it.** Two swarms
  would disagree, and the GPU's would be the one the player sees.
- **The spawn model on the GPU.** Waiting groups, spawn spots, sight walls
  and the respawn's cursor would all be written again in TSL, beside the
  CPU's, for one level's rules.

## Consequences

- The open arena reads nothing back: only a swarm the play moves on does.
- The page's own bring-round is off in the woods; the play sets every rat
  down.
- The lit areas the page works out for the drawing and the GPU step see every
  wall that stops the rats, where the swarm is handed the 64 nearest the
  child. Near him the two agree.
