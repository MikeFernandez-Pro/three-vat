# The swarm is a flow field and bodies, not rules

*Last Light*'s first **swarm** was steered by rules: a rat had a mood
(hunting, sitting, strolling, approaching) and timers. It sat when it touched
the back of the mass and looked again a moment later. The light set any rat
inside it back on its edge every step. Tuning it never made it read as a
crowd. Rats froze far out, a sitting rat carried along by the light slid in
its Idle pose, and a walking light bulldozed the mass ahead of it. The swarm
is now steered the way crowds are simulated, with no moods and no timers.

## Two layers

**Where to go: a flow field.** The ground is a grid. Each cell knows how
packed it is. Ten times a second, a map of how long it takes to reach the
**ring** from every cell is drawn outward from the ring (Treuille, Cooper and
Popovic, *Continuum Crowds*, 2006). Packed cells cost more, and fuller
stretches of the ring cost more to arrive at, so each rat's route leads round
the mass to wherever the ring has room. A Plague Tale steers its rats with a
flow field too (AI and Games #73). A rat's pace across a packed cell is the
pace of the rats there going its way, so a rat behind others running the same
way keeps running. The map itself reads only how packed a cell is, not which
way its rats move: when it also read the flow, the waiting rats were led round
and round a ring they could not enter.

**How to move: bodies.** A rat accelerates toward its route's pace, keeps a
little space from the rats near it (more from those in front), and pushes
where that space is gone. This is the social-force model of a panicking crowd
(Helbing, Farkas and Vicsek, 2000). Overlapping bodies part and lose the
speed that drove them together, so a packed mass stands instead of bouncing.
Waiting is not a rule. A rat stands because the bodies in front of it stand,
and goes when they go.

**The light moves no rat.** Its disc is a hole in the map, and so is the strip
a walking light is about to cross, so routes lead out of its way. A light
faster than the rats overtakes them, and they run out of it themselves.

**The ring** is where routes end. Its rats run round the light flat out
(starving rats do not queue), each joining the way its neighbours run, so the
ring turns as one.

**The gait** is read from the speed a rat really moves at over about a third
of a second, never from what it is after.

## Considered options

Tuning the rules model, measured side by side with this one in the prototype
on branch `prototype/last-light-crowd`. However it was tuned, it still had
moods and timers, so it still looked scripted. Every fix to it added another
rule.

## Consequences

- Crowding is read over about 75 cm, not per cell. A 25 cm cell holds a rat
  or two, and a map drawn from that count flipped a rat's route from one
  redraw to the next.
- A rat caught in a walking light stays caught while the crowd blocks its way
  out: about 240 of 4,000 for 2-3 s when the holder walks into the mass at
  1.6 m/s. That is accepted. Burning those rats will make walking into the
  swarm the player's weapon.
- The map costs about 7-8 ms at 4,000 rats in the prototype's plain
  JavaScript, ten times a second. Cost is not the question yet.
