# Last Light in the sewers: the whole game

Everything decided for the sewer game so far, in one place. The level as data
lives in `src/sewers.ts`, its rules in `src/sewerplay.ts`; where the notes
and the code disagree, this file follows the code as of 2026-10-16 and says so.

**Simplified on 2026-10-16**, after the village: no more squeeze (narrow
path), no more beam to balance on in the final rush, no more cascade, no more
intro canal with the boat to follow. The mushroom cave is replaced by **a small
canal the player wades up to escape the rats**. The rest stays the same.

**Later the same day, the rats too:** no more holes, pipes, waves or waiting
groups. 8000 rats are spread evenly all round on the hub's side of the huge
door; while he wades the canal, three quarters of them are set down again in the
cistern ahead, out of his sight. He dies twice as fast when caught.

Plans: x runs east, z runs south, so "north" is toward negative z. Sizes are
metres between the stone faces.

---

## 1. What the game is

- **A brand-new game, set in sewers** (decided 2026-10-12). Nothing of the woods
  run is kept (beats, gamekeeper, manor, lightning tree). What carries over is the
  engine: the torch, its fuel and refuelling, the rat swarm, walls that block the
  light.
- **The pitch:** a small kid wakes up in a sewer with no setup and no
  explanation, like the film *It*, and has to get out. Thousands of rats live in
  the dark. Light is the only thing that holds them off.
- **Model:** *A Plague Tale*. Set pieces the player learns, all scripted by the
  level (triggers and timings). Nothing emerges from rat counts.
- **Length:** about 5 to 10 minutes; the skeleton was timed at about 7 min 15 s.
- **Structure:** a hub and branches, never felt as a straight line. Corners and
  turns, one bigger objective (the huge door). The exit is never seen from the
  start; it lies at the opposite end.
- **No way out is ever shown:** the player never sees outside the sewer until the
  very last frame.
- **Tone:** dirty and a bit disgusting (dead fish, bones, toys, scraps floating),
  never gore. Not wanted: graffiti, oil puddles.
- **Era:** none in particular. Valves, pipes, gauges, danger signs are all fine.
  The stone is the current sewer wall texture.

## 2. The character

- A kid (the pumpkin kid model for now; may change later).
- **Light:** a stick he lights at flames, turning it into a torch. It burns down.
- **Can:** walk, run, push (held), pull levers (held), pick things up (keys
  only), press buttons, wade the canal, climb the final ladder.
- **Cannot:** crawl (rejected), swim, throw, lure or bait rats.
- **Speeds:** walk 1.6 m/s, run 2.1 m/s. Running is slower than the fastest rats
  (they run in at 1.7 to 2.3 m/s, and flee light at 3 to 3.3 m/s). Wading, the
  same as on the floor.
- **Lines:** short placeholder lines show on screen (for example "Where... where
  am I?", "The gas! My light...", "Run!").

## 3. Core rules

### Light and the torch
- The torch burns for **14 s** of fuel (30 s until 2026-10-16, then 15). A torch panel on
  both pages sets its duration, its max and min radius, and an endless torch.
  On the 2D page its light ends where the rats stop, at its reach. Its circle shrinks with the fuel from the
  first step (reach 1.5 m full, down to nothing), so the player sees it closing in.
  At zero it goes out.
- **Refuel / relight:** hold **F** within reach (0.8 m) of any lit open flame:
  lanterns, oil lamps, braziers, the hub's fire, and the fallen chandeliers.
  Swinging chandeliers are light only, not flame.
- **Lights all behave the same:** each holds rats off its circle. Walls block
  light (rats can wait just round a corner of a lit room).
- **What puts the torch out (scripted):** gas jets, and its own fuel. (The bats were removed on 2026-10-16.)
- Candles exist in the world but are too weak to light or protect.
- **"Always a light by a lever":** every lever has a lamp beside it.
- Why the fires burn underground is still open: dream logic, or half dream/half
  an old maintenance network and a hermit's barrels.

### Rats
- **Rats never climb** and have no 3D motion (they stay on the floor; the pile
  effect is drawn only).
- **All round, no spawners (2026-10-16):** 8000 rats, set down evenly over the
  floor on the hub's side of the huge door (collector, hub, both branches) and on
  the canal gallery's walkways behind it, out
  of the lights and at least 4 m from him. Each stays where it runs; within its
  notice (9 m) it comes for him. No holes, no pipes, no waves, no waiting groups.
- **Gathered in the cistern:** while he wades the canal, the rats out of his
  sight and beyond notice are set down again in the cistern ahead, evenly, until
  three quarters of all the rats are there. They wait over the plates.
- **A rat with no way out of a light dies** there and is set down again in its
  part, the hub's side or the cistern, out of his sight.
- **The canal:** rats never enter its shallow water; he wades it. Nothing
  alive enters deep water (there is none on the plan now).
- **Big rats are faster** (already the case).
- **Rats press a weak flame:** yes. Rats never put a light out.

### Being caught
- A hidden life bar: every rat touching him bites (up to 10 count), so the full
  swarm on him in the dark takes about 1.5 s (twice as fast since 2026-10-16).
  Left alone for 1 s, it regenerates.
- At zero he is caught and restarts at the **last checkpoint**. **Progress is
  never lost:** levers pulled, doors opened, the key all stay done. The rats are
  set down away from him again.

### Controls
- WASD / arrows to move, Shift to run, **F** to interact (light, lever, push,
  pick up, press). A key prompt shows over the nearest usable thing.
- In 3D (chosen 2026-10-13): a close third-person camera **attached** to him,
  **tank controls** (A/D turn him and the camera, W/S along his facing). The
  camera pulls in short of walls, and a dither cuts a see-through hole between
  camera and kid. No ceiling is drawn (implied by arch springs and hanging
  things). The ladder ending switches to a top-down view. In the canal he
  stands on its bed, 0.3 m down.

---

## 4. The map

**Blender pass (2026-10-16, `exports/sewers2.0.glb`, brought back into
`sewers.ts`):** the gas branch's end rounded, 1.25 m further at its middle; the
chandeliers' gallery 1 m longer, its lever and lamp with it; the six escape holes
stretched into slots 2.1 m long along their walls; the brazier by the symbol
door moved to the cistern's middle, with the checkpoint that stood through the
door; the four plates moved round it; the landing's brazier moved to where he
steps out of the canal; the hub's checkpoint moved 4.5 m north into the hub; the
gas lever's lamp nudged. Some figures below predate it; `sewers.ts` is right.

### Cross-section profiles (approved)
| Space | Width | Notes |
|---|---|---|
| Collector | 4.5 m | plain floor (a third narrower since 2026-10-16; was 6.7) |
| Service gallery | 3.5 to 4 m | |
| Canal gallery | 4.5 m | a shallow canal 1 m wide down the middle, a walkway of 1.75 m either side |

Vaults are semicircular on piers about 1.8 m high; walls stand 3.5 m in the
Blender export. Shapes mix straight runs, elbows and curves. Never squares,
never uniform modules: widths change to pace the tension.

### Overview, in run order
```
                        [LADDER + manhole]          north (-z)
                            |
                       THE RUSH (gallery, 15 m)
                            |
                 [symbol door, 4 buttons]
                  ( CISTERN, round, r 7 m )
                  (   4 pillars, 4 plates )
                          /
                  landing + brazier
                          |  arch (canal only)
              CANAL GALLERY (walkways | canal | walkways, 19 m)
                          |
                    [ HUGE DOOR, 3 rods ]
 GAS BRANCH ======== (  HUB  , great fire ) ======== CHANDELIER GALLERY
 (due west, straight, 26 m) |                         (due east, 33 m)
                            |
                        COLLECTOR
                     (wake by the lantern)          south (+z)
```

### 4.1 The collector (start)
- A straight way north, 4.5 m wide (6.7 until 2026-10-16), from the waking spot (0.2, 19.2) to the hub's
  edge at z -6, about 25 m. **Nothing in the way:** no gutter, no boat, no
  squeeze (removed 2026-10-16).
- **Waking lantern** at (1.6, 20.4), reach 1.8 m: he wakes beside it, rats
  already all round its light (the rats are spread all round, none within 4 m). No reveal: the
  danger is there from the first frame.
- Props: a ladder leading nowhere, chains.

### 4.2 The hub
- A **confluence chamber**, a **circle 16 m across** centred at (0, -11.2) on the
  collector's line (2026-10-16; it was an ellipse about 22 x 15 m). Both branches
  leave it due west and due east on its middle line, at right angles to the
  collector,
  no water, nothing in the way.
- **Great fire** in the middle (reach 1.8 m, smaller since 2026-10-16; was 2.6): the safe centre.
- **The hub lever** stands between the fire and the huge door (north).
- **The huge door** (north face, 4.8 m wide) is locked by **three interlocking
  metal rods/bolts**: one withdrawn by the gas branch's lever, one by the water
  branch's lever, the last by the hub lever. The hub lever only moves once the
  two other rods are out; tried early, the line says "Stuck. Two rods hold it...
  from either side." Then a **long push: hold 5 s**, the hub at its most rats.
- **The chest** by the wall at (5.4, -7.6): a secret, opened with the worker's
  key. Reward: an alt skin or just an easter egg.
- **The hub no longer gets worse on each return:** that came from holes going
  live, and the holes are gone. The rats are whatever is left of the 8000 all
  round.
- **Checkpoint:** the hub's south entrance, counted again every time he comes
  back through from a branch.
- Props: crate, barrel, bones, a danger sign by the door.

### 4.3 The gas branch (west)
- **One straight gallery** west out of the hub, **3.2 m wide all along**, 27 m,
  the lever at its end (straightened on 2026-10-16; it was a gallery, a wider
  leg north and a dead end west).
- **Only two lights:** a brazier at its mouth, 2.45 m in from the hub's edge, and
  a lamp by the lever, 25.45 m in, 23 m apart. Nothing between: the run is on the torch
  alone, about 14 s of walking against its 15 s.
- **Four gas jets** (five until 2026-10-16) out of either wall in turn, each
  across the whole way, at 5.85, 11.45, 17.05 and 21.85 m from the hub's edge, each on its own rhythm
  (on 1.4 to 1.6 s of every 3.2 to 4 s, offset phases). Inside one while it
  jets, the torch goes out. Pure timing. Danger signs warn at the entry.
  Bubbles/smoke rising from water elsewhere are decoration only; the pipe jets
  are the trap, with their own look.
- **The worker's remains** 14.25 m in, against the north wall between the
  second and third jets: a sewer worker's skeleton in a waxed coat, his lamp
  beside him, easy to miss while timing the jets. He carries the **key** (for the chest).
- **The gas lever** (hold 2 s) withdraws one rod and **shuts every jet off**: the
  way back is safe.
- **Checkpoint** at the lever.
- Props: pipes, a valve, a barrel.

### 4.4 The chandelier gallery (water branch, due east)
- **One straight gallery** 5.3 m wide (4 m until 2026-10-16), 33.4 m long, leaving the hub due east on its
  middle line (it headed ESE until 2026-10-16; every distance along it is kept).
  (The design talk had a canal in the middle with two quays and footbridges; the
  current plan is one plain gallery.)
- **No bats** (removed 2026-10-16): nothing puts the torch out here; with 15 s
  of fuel it is usually low or out by the time he reaches the chandeliers.
- **Four chandeliers**, 6.2 m apart, each swinging 1.5 m either way along the
  gallery every 4.8 s, neighbours in opposite phase (closer and slower since
  2026-10-16, was 6.5 m and 4.4 s). Each throws a 1.5 m pool of light (no
  flame). At their closest, 20 cm of dark lies between two pools; at their
  furthest, 6.2 m. The last hangs 3.6 m short of the lever (was 2.7). **Stay in
  a pool, move with it, switch where two meet.**
- **Escape holes** (2026-10-16): one in either wall halfway between each two
  chandeliers, six in all. A rat by a hole the light reaches goes in; once the
  chandeliers are down, every rat in their light runs for the nearest hole. No
  rat ever comes out of them: a rat gone in is set down again out of his sight.
- **The water lever** at the end (hold 2 s), a lamp beside it. Pulled, it
  withdraws the second rod and **drops the chandeliers**: they crash to the floor
  and burn as flames (reach 3.2 m). Every rat in their light flees it, or dies there.
  The way back is safe, and he can relight the torch at any of them.
- **Checkpoint** at the lever.

### 4.5 The canal (replaces the cascade and the mushroom cave, 2026-10-16)
- Past the huge door, a **gallery 4.5 m wide** runs straight north, 19 m.
- Down its middle, from 2 m past the door, a **shallow canal 1 m wide** (narrowed from 2.2, then 1.4, on 2026-10-16, more room for the rats); a
  **walkway** of 1.75 m either side, **full of rats from the start**, waiting behind the huge door.
- **He wades up the canal to escape the rats: no rat ever enters the water.**
  In its middle he is 0.5 m from the walkways, just out of their bite (0.4 m), so
  the rats run alongside on the walkways but cannot touch him.
- The hub's rats follow him through the door and run alongside on the walkways.
  Meanwhile most of the rats left behind are gathered in the cistern ahead.
- **Where the walkways end**, 19 m on, the water spreads across the whole gallery,
  wall to wall, for the last 3 m to the **landing**. The walls stay straight (no
  narrowing, 2026-10-16; it used to be an arch over the canal alone). No rat from
  the walkways reaches the landing except through the water.
- **The canal is 0.6 m deep** in the 3D model (its bed doubled from 0.3 on
  2026-10-16), the water 0.1 m under the walk.
- **Checkpoint** in the canal, 1 to 3 m in.
- **The landing brazier** at (-1.2, -43.4), reach 2.4 m: he steps out of the
  water into its light and relights the torch. **Checkpoint** here (the
  cistern's threshold).
- **The torch stays lit in the canal** (a prototype pick, not decided).

### 4.6 The cistern
- **A round tank**, 14 m across (centre (4.5, -50.75)), four pillars in its
  middle, the door in its north face.
- **About 6000 rats wait** over the floor, gathered there while he waded the canal.
- **Four plates** on the floor, hidden under the rats, seen only in light (in the
  torch's light within 1.8 m, or near a placed light). Each shows a **numeral
  I to IV beside a symbol**:
  - I fish (west side), II wheel (east), III skull (south), IV key (centre)
- **The symbol door:** four buttons along it, in no telling order (key, fish,
  skull, wheel). Press the symbols in the plates' order (fish, wheel, skull,
  key). The player remembers them: no log, no UI. A wrong order does nothing
  (brute force allowed). A brazier lights the door.
- Bones as decoration.

### 4.7 The rush (the end)
- Pressing the right order opens the door, and the cistern's rats come after
  him. "Run!"
- **Checkpoint** just through the door (the design talk wanted none in the rush;
  the code has one here).
- A straight gallery north, 3.6 m wide, **15 m long, the ladder at its end**
  (6 m). No pit and no beam (removed 2026-10-16). About 7 s of running.
- **How the light is lost** for this run in the dark is open: it used to die on
  the beam. For now the torch just burns its fuel.
- **The ending:** he climbs by himself, out of the rats' reach, camera top-down,
  rats piling at the ladder's foot looking up. He **pushes the manhole cover for
  3 s**, white light, cut to black, the sound of a street.

---

## 5. The run, step by step

| # | Where | What the player does | What it teaches / does |
|---|---|---|---|
| 1 | Collector | Wakes, lights the stick at the lantern, walks to the hub | Light protects; the torch burns down; waiting rats |
| 2 | Hub (1st) | Tries the hub lever: stuck, two rods | The goal; the hub is the checkpoint |
| 3 | Gas branch | Times the jets, finds the corpse and key (optional), pulls the lever | Timing; the jets shut off |
| 4 | Hub (2nd) | Opens the chest with the key (secret) | More rats now |
| 5 | Chandelier gallery | Rides the swinging pools as the torch runs low, pulls the lever | Using other lights; the chandeliers fall, safe way back |
| 6 | Hub (3rd) | Holds the hub lever 5 s while rats pour in | The climax of the hub |
| 7 | Canal | Wades up the canal, the rats running alongside on the walkways, to the landing's brazier | Water is safe; a breather |
| 8 | Cistern | Finds four plates under the rats, presses the door's symbols | The puzzle |
| 9 | Rush | Runs up the gallery to the ladder | The finale |
| 10 | Ladder | Climbs, pushes the cover | The escape |

The order of the branches is free; the hub lever comes last whatever happens.
There are no shortcuts back: he returns through each branch the way he came,
made safe by its lever.

### Checkpoints (as in the code)
1. The start
2. The hub's south entrance (again on every return)
3. The gas lever
4. The water lever
5. In the canal
6. The landing brazier (the cistern's threshold)
7. Through the cistern door

---

## 6. Where the rats are

| When | Where |
|---|---|
| From the start, and after any catch before the canal | 8000 spread evenly over the hub's side of the huge door |
| While he wades the canal | three quarters set down in the cistern, out of his sight |
| After a catch past the canal | three quarters in the cistern, the rest on the hub's side |

The 2D and 3D pages play the same rats (the 3D page's nests-off mode, with
rats brought round ahead out of view, is gone). The 2D page draws them
instanced on WebGL 2.

---

## 7. Lights, objects, mechanisms

### Lights
| Name | Kind | Reach (m) | Flame (refuel) |
|---|---|---|---|
| Waking lantern | lamp | 1.8 | yes |
| Hub fire | great fire | 1.8 | yes |
| Gas mouth | brazier | 1.3 | yes |
| Gas lever | lamp | 1.2 | yes |
| Chandeliers 1 to 4 | chandelier | 1.5 swinging / 3.2 fallen | only once fallen |
| Water lever | lamp | 1.2 | yes |
| Landing | brazier | 2.4 | yes |
| Symbol door | brazier | 1.3 | yes |

Allowed light kinds: torches, braziers, oil lamps and lanterns, maybe burning
barrels.

### Interactive objects
| Object | Action | Where |
|---|---|---|
| Lever (gas) | hold F 2 s | gas branch's end |
| Lever (water) | hold F 2 s | gallery's end |
| Lever (hub) | hold F 5 s, only after the other two | hub, before the huge door |
| Huge door + 3 rods | opened by the levers | hub, north |
| Worker's corpse | pick up the key | gas branch corner |
| Chest | open with the key (secret) | hub |
| Plates I to IV | seen in light only | cistern floor |
| Symbol door, 4 buttons | press in order | cistern, north face |
| Ladder + manhole cover | climb, push 3 s | the end |

### Hazards
| Hazard | Effect |
|---|---|
| Gas jets (4) | timed; put the torch out; shut off by the gas lever |
| Canal | no hazard: rats never enter it, he wades it |
| Deep water | impassable for all (none on the plan now) |

---

## 8. Look and assets

### Colour (from the six references in the design talk)
- **One hue family** (green, teal, sage) across stone, fog and fill, at many
  values.
- **Pale, near-white light**, never yellow.
- **One rust/orange accent:** the pumpkin.
- **Rats:** dark silhouettes with bright eyes.
- Most light should come from the place itself (glowing sludge, water, shafts
  from above), not only the torch.
- Theme chosen: **"moss glow"** (`src/themes.ts`), between moss-and-rust and toxic
  glow. A theme is colour and light only, never a texture.
- Stone: `stone_wall_01`, toon-shaded. Touchstones: Elden Ring / Dark Souls
  sewers, No Rest for the Wicked, Dofus's Astrub sewers, the Capitol sewers in
  The Hunger Games.

### Models and pipeline
- **Kid:** `public/models/pumpkinKid.glb` (placeholder; a 1.2 m block in the
  export).
- **Rat:** `models/rat.glb`, baked to `rat.vat.glb`; drawn at three levels of
  detail on WebGPU, culled on the GPU.
- **The level:** `pnpm export-sewers` writes `exports/sewers.glb` from
  `sewers.ts`: floor and walls at the drawn faces, 3.5 m walls, the canal's bed
  -0.3 m and its water -0.1 m, UVs in metres, plus placeholders for every
  gameplay object (lights with reach rings, levers, door and rods, buttons,
  plates, jets, the canal's edge, ladder, corpse, chest,
  checkpoints, labels, props). **Next step for the art:** model the real
  level in Blender over this guide. Re-run the export after any change to
  `sewers.ts`.

### Props on the plan so far
Ladders leading nowhere, chains (decoration only), danger signs, pipes,
valves, barrels, crates, bones.

### Decoration wanted (asked for, not yet placed)
- Dirty water with floating things (dead fish, bones, toys; little of it) and
  bubbles.
- Side gutters (decoration, or rats running inside them, never on top).
- Plumbing: pipes, valves, gauges, grates in the distance, big doors.
- Ladders and side passages seen but blocked off by dirty water.
- Puddles and vegetation: moss, hanging plants.
- Chains that ring and sway when brushed.
- Smoke rising from the water (decoration).
- "It should feel alive." Few asset types, simple and disgusting.

---

## 9. Where it stands (2026-10-16)

| Piece | State |
|---|---|
| 2D playable plan, to scale (`sewers2d.html`) | built; simplified 2026-10-16 (canal in, squeeze/boat/cascade/cave/beam out) |
| Rules (`sewerplay.ts`) with tests | built |
| Blender guide (`pnpm export-sewers`) | built |
| 3D grey-box play (`sewers-3d.html`) | built: attached tank camera, grey boxes, no nests |
| Rats round walls (flow field, ADR-0056) | built |
| Rat levels of detail (ADR-0057) | built, not yet looked at in game |
| Look test page (`#sewers` corridor, themes, surfaces) | built |
| Final art (Blender level, props, character) | not started |

All of the sewer work is still uncommitted on `game/last-light`.

---

## 10. Planned and open

### Next
1. The level is modelled in Blender over `exports/sewers.glb`.
2. Props and decoration list, placed on the plan.
3. The character (the kid may change), animations for push, lever, wade,
   climb.
4. Bring the look (moss glow, fog, toon) into the 3D play page.

### Open design questions
- **Why the fires burn** underground (dream logic or an old maintenance network
  plus a hermit's barrels).
- **How the player reads** that the hub lever comes last.
- **How the light is lost for the rush** in the dark, now the beam is gone.
- **The torch in the canal:** stays lit (the prototype) or the water puts it out.
- **Checkpoint before the rush:** the design said none in the rush; the code has
  one at the cistern door.
- **The Rat King:** wanted, to be made later; where we meet him depends on the
  story.
- **Decoration rats** (harmless): doubtful, since every rat should be aggressive.

### Swarm work planned (from A Plague Tale)
1. Flow field round walls: built.
2. Cheaper far rats: **built 2026-10-16** (staggered steps). A rat further than
   12 m from him steps only on its group's turn, one step in 4, by four steps'
   time at once. With 8000 rats the CPU step halves (hub 8.3 to 4.4 ms in Node,
   8.1 to 4.6 ms in the 2D page). Tunable on both pages' panels ("far rats").
3. Waves as authored set pieces: a baked field toward a point, set off by a
   level trigger.
4. Slower rats if the swarm reads jittery.

### Idea backlog (not chosen)
- Sunken stairs with a valve that lowers the water (raised once, not
  re-confirmed).
- A manhole cover pushed up by a wave (an alternative ending idea).
- From the older list: a glow on interactive objects (levers, keys, plates),
  rats dashing at the light's edge to bite, rats too slow to leave the light
  burning away, light through grates, places to set the torch down.

### Rejected (do not bring back without asking)
The bats, the gas branch's right angles, the fifth jet, the squeeze, the beam and its balance, the pit, the cascade, the mushroom cave,
the intro's boat and gutter (all removed 2026-10-16). Wadeable poison water,
fragile lamps, trap lights, collapses, pipes releasing a
wave on a lever, crawling, flushing channels, a water-height system, drips,
igniting gas pockets, luring or baiting rats, the descent/balcony space, the circle-of-lamps and other last-room
mini games, the woods' story.
