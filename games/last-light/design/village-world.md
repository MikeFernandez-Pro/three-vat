# Last Light: the village, build brief for Blender

> Superseded on 2026-10-16: the game went back to the sewers (`sewers-gameplay.md`). Kept as a record; the village's code and pages were removed.

You are building the 3D world of **Last Light** in Blender (through Blender
MCP). This brief tells you what is fixed and must be respected exactly, and
what is yours to decide.

- **Fixed:** the walkable plan, every gameplay object and where it stands. They
  were designed and play-tested in 2D. Don't move, widen or narrow anything the
  child or the rats walk on.
- **Yours:** the style, colour palette, lighting mood, architecture, props and
  decoration. Section 9 gives you the inputs and the constraints.

Read sections 1 to 4 before building anything.

## Files

All paths are under `C:\Users\lezen\ThreJsJourney\three-vat\games\last-light\`.

| File | What it is |
|---|---|
| `exports/village-guide.glb` | **The raw 3D guide, exact. Import it first** (section 3). |
| `design/village-sketch.png` | The plan at a glance: north up, 10 m grid. |
| `design/village-gameplay.md` | The agreed story and gameplay. Read it for the mood. |
| `village2d.html` | The playable 2D version. Run it with the game's dev server at `localhost:5173/village2d.html` to see the game working. |
| `exports/village-references/sheet01.jpg` to `sheet12.jpg` | The user's 100 picture references, numbered. `index.txt` maps each number to its file in `C:\Users\lezen\Downloads\LastLighReferences`. |
| `src/village.ts` | The level data the guide is exported from. If the plan changes, run `pnpm --dir games/last-light export-village` to rebuild the guide. |

---

## 1. The game in short

The game is a short third-person escape, about 7 minutes, in the style of
*A Plague Tale*.

- **Who:** a boy (about 1.2 m tall) with no family, whom nobody cares about.
- **When:** All Hallows' Eve, the one night a year the rats rise.
- **The village:** it held a **dark festival, out of fear**. At dusk it lit
  warding fires everywhere, then locked itself in. The fires are burning out.
- **The danger:** thousands of rats fill the dark streets. **Only fire holds
  them off.** He carries a stick he lights at fires; it burns down.
- **His companion:** a talking skeletal hand rides on his shoulder and jokes.
- **The goal:** his home is the **bell tower** at the far end of the village.

**Do not model the rats or the boy.** The game draws them.

The run, in order:
1. He wakes in a **cart's hay** in the start street.
2. The **market square** with its great **bonfire**.
3. The **windmill lane** (west branch): wind gusts put the torch out.
4. The **festival lane** (east branch): bats, then swinging lanterns.
5. Back at the square, the **winch** opens the **gate**.
6. The chase onto the **meadow**, into the shallow **stream**, where the rats
   can't follow.
7. The **church front**: four tombs and a sealed door.
8. The door opens and the wind kills every fire. He runs through the dark
   **nave** to the **tower**.
9. Two **ladders** up to the belfry. Home.

## 2. Coordinates and scale

- **Metres**, with Blender axes **X east, Y north, Z up**. All coordinates below
  are `(X, Y)`. The game's own code uses `x = X`, `z = -Y`; you don't need that.
- **The walkable ground is flat at Z 0**, except the stream: its **bed is at
  Z -0.3** and its **water at Z -0.1**.
- **Scale:** the boy is 1.2 m tall and a rat about 0.45 m long. Doors are 2 to
  2.4 m, storeys 2.6 to 3 m.
- **Play area:** X -50 to 50, Y -26 to 100. Beyond it is backdrop only.

## 3. Import the guide first

1. **File > Import > glTF 2.0**, then pick `exports/village-guide.glb` with the
   default settings. It arrives with Z up and +Y north.
2. Put it in a collection **`00_Guide`**. Show it as wire or in front, and
   **exclude it from your export**.
3. What it contains:
   - **`Ground and walls`:**
     - `ground (walkable)`: the exact walkable floor.
     - `walls (every edge of the walk)`: 3 m guide walls standing **exactly on
       the edges** the game collides on.
     - The stream's bed, banks and water.
     - The meadow grass and the paved landing.
   - **`Gameplay (placeholders)`:** every gameplay piece as a named box or
     empty at its exact place, with its data in custom properties (light reach,
     gust rhythm, lantern swing, and so on).
4. Every wall in the guide is a boundary. What it becomes (a house front, the
   town wall, a fence, a hedge, the church) is your choice, guided by sections
   5 and 9. Its **foot must stay on the guide's line (within 5 cm)**.

## 4. Rules that apply everywhere

1. **The walkable floor is sacred.** Nothing solid may stand on it between Z 0
   and Z 2.4, except the objects in section 6. The game doesn't collide with
   decoration, so the boy and the rats would walk through it.
2. **Decoration against a wall** (barrels, steps, crates, stalls, pumpkins) may
   reach **at most 0.3 m** into the walk.
3. **Streets stay open to the sky** down their middle, so the camera can stay
   high or come in close (not decided yet). Upper storeys may overhang a street
   by **at most 1.2 m in total per side**.
4. **Every roof or vault over the walk** (the gate passage, the church porch,
   the nave, the tower) is **its own object named `*.roof`**, so the game can
   hide it when the camera is under it.
5. **Lights are objects, not Blender lamps.** Model each source (bonfire,
   brazier, lamp, lantern) with emissive flame and glass. The game adds the
   real lights at the given points with the given reach. Blender lamps are for
   your preview only (collection `99_PreviewLights`, not exported).
6. **Only fire protects.** Candles and carved pumpkins are decoration: keep
   them small and dim, clearly weaker than the gameplay fires.
7. **The tower must be visible from the start.** From the start `(0.6, -19.2)`
   at eye height, the bell tower at the far north end `(0, 93)` must show above
   everything in between. Keep the gate, the inner wall, the church front and
   the nave low enough on that line, or make the tower tall enough. It's the
   player's goal, seen from the first second.

---

## 5. The map, zone by zone

What follows is the fixed layout, plus the role of each place. Its look is
yours (section 9).

### 5.1 Start street
- **Walk:** X -3 to 3, Y -22.5 to 5. A straight street running north into the
  square.
- **The cart** is solid: X -2.6 to -0.6, Y -21.5 to -18.5. It's a hay cart
  left from the festival, and **he wakes in its hay**. It's part of the walls:
  the guide has walls round it.
- **Start:** the boy at `(0.6, -19.2)`, facing north.
- **Waking lantern** (gameplay light, reach 1.8): `(1.6, -20.4)`. A dying
  lantern; he lights his stick at it.
- 240 rats wait round him at the start.
- **The south end** (Y -22.5) is closed. Show why: a barricade, a dead end,
  whatever fits.

### 5.2 Market square (the hub)
- **Walk:** an ellipse, centre `(0, 11.6)`, half-axes 10.9 m (X) and 7.6 m (Y).
- **Openings:**
  - south: the start street
  - west: the windmill lane
  - east: the festival lane
  - north: **the gate**
- **The bonfire** (gameplay light, reach 2.6, the biggest fire): at the centre
  `(0, 11.6)`. This is the festival's warding fire. **Nothing else stands in
  the middle.**
- **The winch** at `(0, 13.6)`, 2 m from the fire, in its light. The boy turns
  it for 3 s to raise the portcullis, once both locks are released.
- The square is **always full of rats** round the fire (200 wait here).

### 5.3 The gate and the inner wall
- **The gate:** a **portcullis** on the line Y 20.2, from X -2.45 to 2.45, in a
  passage X -2.35 to 2.35, Y 18.6 to 21.4 (roofed: `gate.roof`).
- **Two lock bars** hold the portcullis. They're released from the two wall
  towers at the ends of the branches, so the chains run from the gate along the
  inner wall to each tower.
- **The inner wall** closes the square's north side, between the square and
  the meadow. It runs east and west to the two **wall towers** at the lanes'
  ends.

### 5.4 Windmill lane (west branch)
- **Walk:** X -45 to -9, Y 9.6 to 13.6 (4 m wide, 36 m).
- **The wind:** four **gaps between the houses** on its north side, the mouths
  of alleys that are **not walkable**. Each is 1.6 m wide, centred at X -16.5,
  -23.5, -30.5 and -37.5 on the north face (Y 13.6).
  - Wind gusts out of each gap and crosses the lane north to south, **putting
    the torch out**.
  - Each gap has its own rhythm, given in the guide's `gust.N` properties:
    period, `on` time and phase.
  - **The windmills warn:** many small festival **pinwheels** along the lane,
    and a small wooden windmill at each gap. They **creak and spin up about
    1 s before a gust**, spin wildly during it, then wind down.
  - The house walls between the gaps are the shelter.
- **Brazier** at the lane's mouth `(-12, 12.6)`, reach 1.3.
- **West tower** at the lane's end (beyond X -45):
  - its **lock lever** at `(-44, 11)`, pulled for 2 s
  - a **lamp** at `(-43.5, 12.6)`, reach 1.2
- **The quarter** (agreed): a windy riverside lane of millers, rope-makers and
  washing lines.

### 5.5 Festival lane (east branch)
- **Walk:** X 9 to 45, Y 9.6 to 13.6.
- **The bats** burst out right at the lane's entrance (the band X 11.4 to
  12.2) and put the torch out. Give them somewhere to come from: a dark
  overhang, an attic, rafters.
- **Four festival lanterns** hang from one rope down the middle of the lane at
  **Z 6.5**:
  - positions: X 18.5, 25, 31.5 and 38, at Y 11.6
  - each body hangs at Z 2 to 2.8
  - each swings **±1.5 m along the lane** every 4.4 s, neighbours in opposite
    phase
  - reach 1.5 while hanging
  - when the east lock is released they **fall and burn on the cobbles**
    (reach 3.2)
  - model each lantern as an object with its origin at its pivot on the rope,
    plus a separate fallen version
- **East tower** at the lane's end (beyond X 45):
  - its **lock lever** at `(44, 11)`, pulled for 2 s
  - a **lamp** at `(43.5, 12.6)`, reach 1.2
- **The quarter** (agreed): the festival lane where the lanterns were strung
  for the parade, with stalls and masks.

### 5.6 The meadow, the landing and the fences
- **The landing:** past the gate, a paved landing X -2.35 to 2.35, Y 21.2 to
  27.8.
- **The meadow:** grass X -6 to 6 from the gate (Y 21.2) to a fence at Y 59.
  - The rats spread over it.
  - Decorate it, with nothing solid in the walk: grass, pumpkin-headed
    scarecrows, tombs, pumpkins. These were agreed.
- **The boy's fences** (guide: `fence.N`): low fences, about 0.9 m. They **stop
  the boy but let the rats slip under**. They run:
  - along both sides of the landing (X ±2.35)
  - in to the stream at Y 27.8
  - along both stream banks (X ±1.5) up to Y 55.5

  So once through the gate, his **only way on is into the water.**

### 5.7 The stream
- **The water:** X -1.5 to 1.5, Y 27.8 to 56 (28 m).
  - **Shallow:** he walks up inside it.
  - Bed Z -0.3, water Z -0.1. More or less straight; it may wobble a little
    visually, but the walk must stay as given.
  - **The rats never enter the water.**
- **The droplets:** about 2 m in (Y 29.8 to 31.2), the water's droplets put
  the torch out.
- **The stone path:** out of the stream's end, X -1.5 to 1.5, Y 56 to 60.6, to
  the church front. Fenced off from the grass on both sides, so no rat reaches
  it.
- **The stream-end fire** at `(1.2, 60)`: a brazier, reach 1.8. He steps out
  of the water into its protection and relights his stick there.

### 5.8 Church front
- **Walk:** a circle, centre `(0, 67)`, radius 7, outside the church's main
  door. **No rats** come here before the door opens.
- **Four tombs** (gameplay), each slab 0.9 x 1.8 m with its long side
  north-south. Each shows **a Roman numeral beside a symbol**:

  | Tomb | Symbol | Centre |
  |---|---|---|
  | I | fish | (-4.6, 66.6) |
  | II | wheel | (4.8, 68) |
  | III | skull | (0.2, 62.6) |
  | IV | key | (0, 67) |

  The symbols are placeholders, to be replaced later. Keep the carvings as
  separate objects or material slots so they're easy to swap.
- **The church door** on the line Y 74, X -2 to 2, at the end of a porch X
  -1.9 to 1.9, Y 72.5 to 76.2.
  - It's **sealed for the vigil** by an old lock of four symbols.
  - Before it, **four symbol stones** (about 1 m posts with a carved face) at
    Y 72.7: X -1.5 key, -0.5 fish, 0.5 skull, 1.5 wheel.
  - The door opens inward. Make it separate leaves with hinges at their pivots.
- **Door lamp** at `(3, 72)`, reach 1.3.
- **Crypt grates** (`grate.23` to `grate.26`) at the church front's edge:
  `(-5.7, 71)`, `(5.7, 71)`, `(-6.8, 68)`, `(6.8, 68)`. When the door opens,
  the rats pour out of them, behind him.

### 5.9 Nave and tower
- **Nave:** X -3.5 to 3.5, Y 76 to 89. When the door opens, the wind blows out
  **every fire** and he **runs through it in the dark**. Roof it as
  `nave.roof`.
- **Tower:** interior X -3.5 to 3.5, Y 89 to 97, at the far north end.
  - **Ladder 1** at `(0, 96)`, from Z 0 to Z 6. **The chase ends when he
    reaches it**, because rats never climb.
  - **Ladder 2** above it, from Z 6 to Z 12.
  - Then the **belfry**: his home, where the old bell-ringer lived. The ending
    happens there.
  - **The tower is the tallest thing in the village** (rule 4.7).
- A high beam between the ladders was **set aside for now**. Don't build it.

## 6. Objects allowed on the walk

These, and nothing else, may stand on the walkable floor:
- the **cart** (solid in the plan)
- the **bonfire's** stone ring (radius 1.0 m at most)
- the **winch**
- the **lock levers**
- the **braziers and lamps** at their points
- the **symbol stones**
- the **tombs** (flush with the ground, or low)
- the **boy's fences** on their lines
- the **ladders**

## 7. Objects the game moves: names and pivots

Make each of these a separate object with this exact name and origin:

| Name | Origin | What the game does |
|---|---|---|
| `winch` | (0, 13.6, 0) | turns it about Z |
| `gate.portcullis` | bottom centre on Y 20.2 | raises it 4.6 m |
| `gate.bar.west`, `gate.bar.east` | bar centres | slide them out sideways |
| `lock.west`, `lock.east` | lever hinges | rotate them about 70 degrees |
| `windmill.1` to `windmill.4` | hub | spin them (one per gap) |
| `pinwheel.*` | hub | spin them |
| `lantern.1` to `lantern.4` | pivot on the rope, Z 6.5 | swing them |
| `lantern.1.fallen` to `lantern.4.fallen` | on the cobbles | shown when fallen |
| `rope`, `rope.slack` | any | swaps them |
| `stream.water` | any | animates the flow |
| `tomb.I` to `tomb.IV` | slab centre | none |
| `sign.key`, `sign.fish`, `sign.skull`, `sign.wheel` | the face | pushes it in |
| `church_door.left`, `church_door.right` | hinges | opens them |
| `ladder.1`, `ladder.2` | foot | none |
| `trapdoor` | hinge, Z 12 | opens it (only if you give the belfry a hatch; your choice) |
| `*.flame` | flame base | flickers it; one per gameplay fire |
| `*.roof` | any | hides it when the camera is under it |

## 8. Collections, budgets, export

**Collections:**
- `00_Guide` (not exported)
- `10_Ground` (cobbles, grass, stream)
- `20_Buildings_<zone>`
- `30_Walls_Gate_Towers`
- `40_Props_<zone>`
- `50_Gameplay` (the objects of sections 6 and 7)
- `80_Backdrop` (the village beyond the play area, the skyline)
- `99_PreviewLights` (not exported)

**Budgets** (it's a web game, and the GPU also draws up to 16,000 rats):
- under **400k triangles** in the play area, under **60k** in the backdrop
- at most **24 materials**
- textures at most **2048 px**, packed into atlases where possible
- **linked duplicates** for repeated props (they export instanced)
- the game renders in **toon shading** with fog, so flat colours, vertex
  colours or simple painted textures read best

**Export:**
- Save as `exports/village.blend`.
- Export **glTF binary** to `exports/village.glb`, with:
  - +Y up (the default)
  - apply modifiers
  - custom properties on
  - all collections except `00_Guide` and `99_PreviewLights`

## 9. Yours to decide: style, palette, assets

The user has left **style, colour palette, lighting mood and assets** to you.
Your inputs:

- **The mood** (agreed): a Tim Burton-like spooky medieval village on Halloween
  night. A **festival of fear, not a happy one**: warding fires, a village shut
  in and indifferent.
  - Leaning half-timbered houses.
  - Abandoned festival dressing: torn bunting, masks on doors, overturned
    chairs.
  - Moving trees and twitching bones for mood only.
  - The hand's own bones lie at three spots, as an easter egg (guide: `bone.N`).
- **The references:** 100 images, numbered in the contact sheets. They fall
  into roughly these groups (your reading, not a ranking):
  - **MediEvil remake** screenshots: 69 to 89
  - **stylized low-poly dioramas:** 94 to 99. **99**, a torch in the dark from
    above, is close to the game.
  - **dark, misty streets:** 5, 11, 15, 56, 60, 64
  - **orange Halloween postcards:** 4, 23, 26, 42, 44, 67
  - **Burton-like illustrations:** 3, 6, 14, 22, 68
  - **props:** 2, 13, 31, 46 to 48, 58, 65
  - **100** is a pumpkin-headed figure; the boy has a pumpkin head
- **The user's prop catalogue** (written in French, condensed):
  - crooked houses, narrow towers, twisted chimneys, eye-like windows
  - signs on chains, wrought-iron gates, gargoyles, bat or crow weathervanes
  - carved pumpkins, skulls, cages, broken gravestones, mausoleums
  - crows, scarecrows, dolls, cauldrons, jars
  - lanterns on gibbets, torches, braziers, lit windows behind curtains
  - twisted trees, roots lifting cobbles, ivy
  - carts, barrels, stalls, washing lines
  - bats, black cats, mist, chimney smoke
  - a clock running backwards, a leaning bell tower

**The only constraints on your choices:**
- **Rules 4.1 to 4.7.**
- **Fire must read as precious and warm** against the night.
- **The boy must stay readable** against the world: he's small, with an orange
  pumpkin head and a torch.

## 10. Checklist before export

- [ ] The walkable ground matches the guide's floor and is flat at Z 0. The
      stream bed is at Z -0.3 and its water at Z -0.1.
- [ ] Every wall, house front, fence and hedge has its foot on the guide's
      lines, within 5 cm.
- [ ] Nothing solid stands on the walk between Z 0 and 2.4, except section 6.
- [ ] Decoration reaches at most 0.3 m into the walk.
- [ ] The tower is visible from the start.
- [ ] Every object in section 7 exists with its exact name and origin.
- [ ] Every roof over the walk is a separate `*.roof`.
- [ ] The budgets are met.
- [ ] `00_Guide` and the preview lights are not in the GLB.
