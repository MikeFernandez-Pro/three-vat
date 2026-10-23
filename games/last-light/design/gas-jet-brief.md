# The gas jets: an art brief

For ChatGPT to draw **four views of a gas jet: front, back, left and
right**. Tripo3D then turns those views into a 3D model. Section 6 holds the
prompts to paste. The jet is a piece of **sewer plumbing bolted to the wall**.
The gas cloud it blows out is a game effect, not part of the 3D model; prompt 2
asks for a picture of it only to fix its look.

---

## 1. What it is in the game

*Last Light* is a small horror game. A kid of about 8 (1.2 m tall, with an
orange pumpkin head and a burning stick for a torch) has to escape a sewer
full of rats. His torch is his only protection.

The **gas tunnel** is a straight gallery 3.2 m wide and 27 m long, with
almost no light, and a lever at its end. **Four gas jets** stand along it,
on the left and right walls in turn. Each one blows a blast of gas
**right across the tunnel, wall to wall**, on its own rhythm:

| Jet | Distance in | Wall | Blasts for | Every |
|---|---|---|---|---|
| 1 | 5.85 m | right | 1.6 s | 4.0 s |
| 2 | 11.45 m | left | 1.5 s | 3.6 s |
| 3 | 17.05 m | right | 1.5 s | 3.4 s |
| 4 | 21.85 m | left | 1.4 s | 3.2 s |

If the kid is in a blast, **his torch goes out**. He has to time each pass.
The gas never catches fire, never explodes, and never hurts him: it only
puts the light out. When he pulls the lever at the tunnel's end, **every jet
shuts off for good** and the way back is safe.

A **danger sign** at the tunnel's entrance warns about the gas.

## 2. What the player must read

1. **This is a gas outlet, and it is dangerous.** It should look like heavy,
   pressurised industrial plumbing.
2. **When it is about to blast.** I propose a short **warning** of about 0.5 s
   before each blast: the flaps rattle, a thin hiss of gas leaks out of the
   seams, and the gauge needle jumps to red. This is the timing cue, a
   proposal not yet in the game.
3. **When it is blasting.** The flaps slam open and a dense cloud fills the
   tunnel from wall to wall.
4. **When it is safe for good.** Once the lever is pulled, every gauge drops
   to zero, the flaps hang shut and a drip runs from the mouth.
5. **That the lever cuts the gas.** I propose a **main gas pipe** that runs
   along both walls of the tunnel, feeds each jet, and ends at the lever.
   The player follows the pipe to the lever.

## 3. The jet, part by part (in metres; the kid is 1.2 m)

The whole assembly is about **1.0 m wide, 1.4 m tall and 0.6 m deep** from
the wall. It hangs on the wall with the middle of its mouth at about **0.8 m**
(the kid's chest and torch height).

- **The vent box.** A squat riveted steel box, about 0.9 m wide, 0.7 m tall
  and 0.4 m deep, bolted to the wall by a flanged back plate with big bolts in
  the corners. Its front face is the **mouth**: a wide rectangular opening
  about 0.8 × 0.5 m, shaped like a flattened funnel (a fishtail nozzle)
  whose lips flare slightly outward. Being wide, it reads as something that
  sprays a whole wall of gas.
- **The flaps.** Three or four horizontal steel **louvre flaps** across the
  mouth, like a vent shutter. Shut, they lie flat and closed. Blasting, they
  slam open, each one level. They are the jet's clearest moving part.
- **The feed pipe.** A thick copper pipe, about 0.15 m across, comes in from
  the side along the wall, at about 1.2 m height. It bends down through two
  elbows with flanges into the top of the vent box. Toward the far side, it
  carries a **valve body** (a chunky cast block with bolts, and **no
  handwheel**) and a **pressure gauge** with a glass face and a red sector.
- **The supply stub.** The feed pipe leaves the model on one side and ends in
  a bolted flange, about 0.3 m past the box. That is where the main gas pipe
  along the wall joins on, so the same model can be mirrored for the other
  wall.
- **Stains and wear.** A dark fan of stains spreads on the wall round the
  mouth, sickly yellow-green, left by years of gas. The edges of the mouth
  carry a pale crust of deposit. Fine drips run below the box.

**The state drawn: SHUT** (between blasts): flaps closed, the gauge needle in
the middle.

## 4. The gas cloud (the game effect, for its look only)

- Out of the mouth, a **flat, dense blast** that crosses the tunnel in
  under 0.2 s. It is **about 1.6 m wide** along the tunnel and **1.6 m tall**,
  and it hits the far wall and rolls back on itself.
- **It must look different from the sewer's mist.** The mist is a pale,
  slow teal haze. The gas is **thicker, more opaque and faster**, in a
  **sickly yellow-green** (chartreuse), with curling, puffy shapes and a
  bright core near the mouth.
- When the blast stops, it **thins out and drifts down** in about half a
  second, leaving low wisps on the floor.
- **Sound** (for later): a hard hiss on the blast and a rattle on the warning.

## 5. Style and colour

The jets share their style and colour with the huge door (see
`huge-door-brief.md`).

- **Style:** a stylized, hand-painted game prop, chunky and slightly
  exaggerated, like Dofus or *Penguins of Madagascar* concept art: big
  rivets, bold shapes, clean silhouettes.
- **Steel:** dark blackened steel, wet and grimy.
- **Pipes:** old copper with heavy **teal-green verdigris**, with dark steel
  flanges.
- **Gauges:** dull, dark brass, with a pale face and one **red** sector.
- **Gas:** sickly **yellow-green**, the only yellow-green in the tunnel, so it
  reads as danger.
- **No orange and no orange rust** (the kid's pumpkin head is the scene's
  only orange). **No text and no gore.**

---

## 6. The prompts

### Prompt 1: the jet, four views on one sheet (for Tripo3D)

> A character-turnaround-style reference sheet for a single 3D game prop: an
> industrial sewer gas jet bolted to a wall. Four **orthographic** views in
> a 2 × 2 grid, the same scale, aligned at the same height: **FRONT** (top
> left), **BACK** (top right), **LEFT side** (bottom left), **RIGHT side**
> (bottom right). Plain light-grey background, flat even lighting, no cast
> shadows, no perspective, no wall, no environment, no gas, no characters, no
> labels or text. Stylized hand-painted game-asset look, chunky exaggerated
> proportions, clean readable shapes.
>
> The prop: a squat riveted steel vent box, about 0.9 m wide and 0.7 m tall,
> on a flanged steel back plate with big corner bolts. Its front is a wide
> flattened funnel nozzle (a fishtail mouth) with slightly flared lips. Three
> horizontal steel louvre flaps, shown closed, sit across the mouth. A thick
> verdigris copper pipe comes in from the right side at the top, bends down
> through two flanged elbows into the top of the box, and carries a chunky
> bolted valve body (no handwheel) and a round brass pressure gauge with a
> red sector. The pipe ends on the right in a bolted flange. Pale crusty
> deposits round the mouth, fine drips below.
>
> The back view shows the flat back plate with its bolts, and the pipe's
> flange end. The side views show the box's depth (0.4 m), the flared mouth
> in profile, the flaps' edges, and the pipe's elbows.
>
> Colours: dark blackened wet steel, copper with heavy teal-green verdigris,
> dull dark brass gauge. No orange, no rust, no text.

Then, in **the same chat**, if Tripo3D needs separate images:

> Now draw only the FRONT view of this exact gas jet, on its own: one
> orthographic image, centred, filling the frame, plain light-grey background,
> flat lighting, no shadows, nothing cropped. Keep every detail identical to
> the sheet.

Ask the same for the BACK, LEFT and RIGHT views, one picture each. If a view
drifts from the others, say exactly what differs and ask again.

### Prompt 2: the jet in its tunnel (concept only, not for Tripo3D)

> Concept art for a stylized hand-painted horror game, Dofus or Penguins of
> Madagascar style: a narrow sewer tunnel of pale sage and teal stone, 3.2 m
> wide, seen at the kid's eye level, very dark. On the right wall, an
> industrial gas jet (a riveted steel vent box with a wide fishtail mouth and
> open louvre flaps, fed by a verdigris copper pipe with a brass gauge) blasts
> a dense, opaque, sickly yellow-green gas cloud straight across the tunnel to
> the far wall, where it rolls back on itself. Further down, another jet on
> the left wall is shut. A copper main pipe runs along both walls, feeding
> each jet. A small kid with an orange pumpkin head and a burning stick stands
> in the foreground, waiting for the blast to end. Cool pale light from his
> torch only. The gas is the only yellow-green in the image; the tunnel's mist
> is a pale slow teal haze. No orange except the pumpkin head, no text, no
> gore.

### Prompt 3: the danger sign (a small prop)

> A single flat 3D game prop on a plain light-grey background, front and back
> views side by side, orthographic, flat lighting, no shadows: a battered
> enamelled steel warning sign, about 0.6 × 0.45 m, hung by two short chains
> from a bracket. A bone-white field with a dark teal border carries a simple
> stencilled symbol: a pipe nozzle puffing a gas cloud, with a torch flame
> struck through beside it. Chipped enamel, dark water stains, bent corner,
> rivets. No text, no letters, no orange, no rust.

The sign's symbol is the same as the **gas emblem** on the huge door's left
bar. Seeing it again in the tunnel ties that bar to this branch.

---

## 7. After Tripo3D (Blender)

- **One model, four jets:** jets 2 and 4 are on the left wall, so mirror the
  model for them, with the feed pipe on the other side.
- **Moving parts:** Tripo3D gives back one fused mesh. Cut the **flaps** apart
  in Blender (each one hinges on its long top edge), and the **gauge needle**
  too.
- **Fit to the guide (`exports/sewers.glb`):**
  - Each jet's empty, `jet.00` to `jet.03`, sits at the wall at the mouth's
    middle, facing across the tunnel.
  - Its data gives the rhythm: `period`, `on` and `phase`, in seconds.
  - Its gas zone (`length` 3.2 m, `half` 0.8 m) is the box `jet.NN.cloud`.
    Make the effect cover it.
- **Nothing in the walk:** the jet stands out at most **0.6 m** from the wall.
  The tunnel is only 3.2 m wide and the rats need the room.
