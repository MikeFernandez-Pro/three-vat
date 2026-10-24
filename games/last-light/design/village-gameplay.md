# Last Light: the village, the agreed design

> Superseded on 2026-10-16: the game went back to the sewers (`sewers-gameplay.md`). Kept as a record; the village's code and pages were removed.

This file holds only what was **agreed** in the design talk of 2026-10-14. Some
rules were carried over from the sewers version without being discussed again;
they are marked **(carried over)**. Anything not decided yet is listed under
**Open**.

Style, colour palette, lighting mood and the choice of assets and props are
**left to the art pass** (the agent building the 3D world). Its inputs are in
section 7.

---

## 1. The story

Once a year, on **All Hallows' Eve, the rats rise**: a folk-tale curse.

The village holds a **dark festival, celebrating out of fear**, not joy. At dusk
it lights **warding fires** everywhere (the great bonfire, braziers, lanterns)
to hold the rats back, then every family locks itself in. The fires burn out
slowly through the night.

**The boy has no family.** He lives alone, and nobody cares about him. He fell
asleep in the **hay of a cart** at the edge of the festival, and everyone went
home without him. He wakes in the dark, near a dying lantern, with rats all
round its light.

The villagers will not open their doors: **opening a door lets the rats in.**

His home is the **bell tower**, at the far end of the village. **The old
bell-ringer took him in**, then died, and the boy kept living up there alone.
Nobody waits for him there.

## 2. The hand

- A **talking skeletal hand** is with him from the very first moment. It wakes
  him and tells him to grab the stick and light it ("Hey, grab this stick and
  light it in the fire, we're gonna get you back home, kid").
- It **has no abilities.** It only talks, and it walks at his feet or rides on
  his shoulder.
- It **jokes** now and then to lighten the dread, since the theme is Halloween.
  For example: "I know the situation is critical, but I'd be happy if we could
  find the rest of my corpse."
- It talks in **calm moments** and at **scripted moments.**
- **Who it is stays a mystery until the very end.** In the belfry it says:
  *"You did it, kid. This bell tower was my home for decades. Now it's yours."*
  It was the old bell-ringer.
- **Its bones** are scattered round the village as an **easter egg**. They are
  not collectibles, and nothing is counted. Finding one only gets a joke
  ("Oh great, still in shape. Unfortunately I don't need it anymore.").

The rest of the supernatural is **mood only**: trees that move, bones that
twitch on their own. They never touch him.

## 3. Rules (carried over from the sewers)

- **The torch:** the stick, once lit, burns down. Its light circle shrinks,
  then it goes out (30 s of fuel in the sewers' tuning). He relights it by
  holding the interact key next to an open fire.
- **Light protects.** Rats keep out of the light. Walls block it.
- **Rats** come out of holes and cellar grates at the foot of the walls, and
  dive back in when light reaches them. **Rats never climb.** **Rats never
  cross water** (agreed for the village: the river is the true protection).
- **Caught:** rats touching him wear down a hidden life. At zero he restarts at
  the last checkpoint, and nothing already done is lost.
- **Candles are decoration only.** They are too weak to protect him or to
  relight the torch.
- **Moves:** walk, run (slower than the fastest rats), interact (light, pull,
  push, press), climb ladders, cross a beam.

## 4. The run, in order

1. **Waking.** In the hay of a cart at the edge of the festival, near a dying
   lantern, rats all round its light. The hand wakes him; he lights the stick
   at the lantern. The way to the square is open (no squeeze, no boat).

2. **The market square: the hub, the village centre.**
   - The **great warding bonfire** burns in the middle. The square is **always
     full of rats** round it; this doesn't escalate.
   - The **inner gate** out of the centre is a **portcullis**, raised by a
     **winch in the square** and held by **two locks**.
   - Each lock is released at a **wall tower**, one at the end of each branch.
     Their chains run along the wall-walk.

3. **Branch 1: the windmill lane**, a windy riverside lane (millers, rope-makers,
   washing lines).
   - Many **small festival pinwheels**, plus a few small wooden windmills on
     poles and roofs.
   - **Gusts** cross the lane through **gaps between the houses** (side alleys
     open to the river). Each gap has its own rhythm. A gust puts the torch out.
   - The windmills **creak and start turning about a second before a gust**,
     spin wildly during it, then wind down.
   - He goes **from shelter to shelter**: waits behind a wall, watches the next
     gap's windmills stop, then crosses.
   - At the end: **wall tower, lock 1.**
   - **The way back keeps the same danger.** He knows the rhythm now.

4. **Branch 2: the festival lane**, where the lanterns were strung for the
   parade, with stalls and masks.
   - **Bats** burst out **right at the lane's entrance** and put his torch out.
   - **Festival lanterns** hang across the street and swing in the wind. He moves
     from one pool of light to the next, with their rhythm.
   - At the end: **wall tower, lock 2.** Releasing it makes **the lanterns
     fall**. They burn on the cobbles, the rats flee, and the way back is lit.

5. **Back in the square.** With both locks released, he goes to the winch and
   takes **a few seconds** to open it, **protected by the bonfire** (the winch
   stands in its light). The portcullis rises.

6. **The chase to the water.** Through the gate, a **meadow** of grass runs
   all the way to the church, with pumpkin heads, tombs and other things along
   both sides. The rats come after him, and he runs to the stream. **He is
   forced into the water** (agreed; how it's done is a prototype pick): low
   fences keep him on a short paved landing and then in the stream, while the
   rats slip under them onto the meadow.

7. **The stream.** A **small, shallow, more or less straight stream**, centred
   down the meadow, about 28 m long, starting about 7 m past the gate. He
   **walks up inside it** and is protected there: **the rats never enter the
   water.** The **water droplets put his torch out.** Out of the stream's end, a
   **short stone path** leads to the church front, with **a fire** at its end, so
   he steps out of the water into its protection.

8. **The church door.**
   - Across the river he reaches the **closed church door**. It has a **light**,
     where he **relights his stick**, and **tombs** stand around it.
   - **No rats** here: a calm moment.
   - The church and its tower were **sealed for the vigil** by the priest with an
     old lock of **four symbols**: the four saints whose tombs stand around the
     door. The boy never needed it; any other night the door is open.
   - Each of the **four tombs** shows **a numeral (I to IV) beside a symbol**. The
     door has **four symbol buttons**, to press in the tombs' order. A wrong order
     does nothing, and there's no notebook UI.
   - The symbols for now are fish, wheel, skull and key; **better ones will be
     found later.**

9. **The door opens.** The **night wind** rushes out and **blows out every
   fire**, his torch included. **The rats pour out of the crypt.**

10. **The rush.** No obstacle: he **runs in the dark** to the tower's **first
    ladder**, with the rats coming. **The chase ends when he reaches the
    ladder** (rats never climb).

11. **The tower.** **The first ladder**, then **the second ladder** to the
    top. (A high beam between them, looking down on the rats, is **set aside
    for now**, to be added later if there is time.)

12. **The belfry.** *"You did it, kid. This bell tower was my home for decades.
    Now it's yours."* The end.

## 5. Open

Each of these needs deciding before the map or the build.

| Topic | Open question |
|---|---|
| The map | Distances and shapes: the cart to the square, the square's size, each branch's length, how many wind gaps and lanterns, the chase from the gate to the river, the river's width, the tombs' layout, the dark run's length, the tower's heights. The sewer map is the starting point ("more or less the same map"), but the river, the church front and the new tower are new. |
| The dark run | Its length and the rats' head start must make it thrilling, not impossible: he runs at 2.1 m/s, the fastest rats at 2.3, and in the dark the swarm brings him down in about 3 s. Tune in 2D. |
| The chase to the ford | Its length and where the rats come from. |
| The symbols | Better ones than fish, wheel, skull, key. |
| Checkpoints | Not discussed again. In the sewers: the square, each branch's end, after the dark crossing, before the puzzle room, before the rush. |
| Rat holes | Where they are in each lane, and when each opens. |
| The hand's lines | All of them, beyond the examples above. |
| The boy's look | The current model is a pumpkin-headed kid in pyjamas. Does the pumpkin become his festival mask? |

## 6. Rejected or dropped

- From the sewers: the squeeze and the boat at the start; the secret chest and
  the key on a corpse; the hub's long push under pressure; the safe churchyard
  walk guided in the dark; the puzzle inside a room full of rats; the floor-level
  beam over a pit with rats on it.
- In this talk: the hand having abilities; the square getting worse on each
  return; candles that protect.

## 7. For the art pass

The art agent decides the style, palette, lighting mood, assets and props.
Inputs:
- The 100 picture references:
  - originals in `C:\Users\lezen\Downloads\LastLighReferences`
  - numbered contact sheets in `games/last-light/exports/village-references/sheet01.jpg`
    to `sheet12.jpg` (`index.txt` maps the numbers to the files)
- The prop catalogue for a Tim Burton-style spooky medieval Halloween
  village (written in French, given in the chat): leaning half-timbered houses,
  twisted chimneys, eye-like windows, signs on chains, wrought-iron gates,
  gargoyles, carved pumpkins, skulls, cages, broken gravestones, crows,
  scarecrows, lanterns on gibbets, torches, braziers, lit windows, will-o'-wisps,
  twisted trees, carts, barrels, stalls, washing lines, bats, black cats,
  mist, chimney smoke, a clock running backwards, a leaning bell tower, an
  abandoned festival (torn bunting, masks on doors, overturned chairs).
- The story above: a festival **of fear**, not a happy one.
