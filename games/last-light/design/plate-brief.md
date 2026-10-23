# The cistern's plates: an art brief

A brief for ChatGPT, which paints **one picture of one plate, seen from
straight above**. The plate is almost flat, so Tripo3D has nothing to rebuild:
Blender makes the disc in a minute (section 5), and the picture is its
texture. Section 4 holds the prompts to paste, in order, in **one chat**.
**One plate** is made, and the game places it four times.

The plates are drawn **blank**. Their numerals (I to IV) and symbols (fish,
wheel, skull, key) are added later, so the middle of the plate is left empty
for them.

---

## 1. What it is in the game

*Last Light* is a small horror game. A kid of about 8 (1.2 m tall, with an
orange pumpkin head and a burning stick for a torch) has to escape a sewer
full of rats.

Near the end he reaches the **cistern**: an old round water tank, 14 m across,
long since drained. It is full of rats waiting in the dark. Four pillars stand
in its middle round a brazier, and **four plates** lie in its floor, hidden
under the rats. Each will show a numeral and a symbol, and their order opens
the door out. He finds them only in light: in his torch's, within 1.8 m, or
near the brazier.

What the plate needs to read as:

- **old cistern hardware:** a heavy round plate set into the floor when the
  cistern was built, as plain as the pillars;
- **marked by the water:** it lay under water for years, with stains, silt
  and a pale crust in its seams;
- **worth stopping for:** quiet in the dark, but its iron ring catches the
  torchlight, and its smooth middle looks made to carry a mark.

## 2. The plate (in metres; the kid is 1.2 m)

A **simple** prop with only three parts. Nothing else.

1. **The ring:** a flat ring of blackened iron, **0.9 m across** on the
   outside and about **0.06 m wide**, set flush in the floor.
2. **The bolts:** four big round bolt heads on the ring, at the quarter
   points (top, bottom, left and right in the picture).
3. **The face:** a single disc of smooth stone filling the ring, about
   **0.78 m across**. Its middle, about **0.6 m across**, is **empty and
   smooth**: no carving, no symbol, no number, no crack across it. The
   numeral and symbol go there later.

It rises **no more than 0.03 m** above the floor, so the kid and the rats walk
straight over it.

**The water's marks:** green-brown stains and a little dark silt toward the
edge of the face, a pale limescale crust in the seam between the ring and the
stone, and a few soft drips of verdigris from the bolts. The empty middle
stays **paler and cleaner** than the edge, so a mark painted there later reads
clearly.

## 3. Style and colour

- **Style:** a stylized, hand-painted game texture, chunky and slightly
  exaggerated, like Dofus or *Penguins of Madagascar* concept art. Big simple
  shapes, soft edges, few details. The same family as the pillars.
- **Colours:**
  - **face:** pale blue-green and sage stone, darker and greener at the edge,
    palest in the middle;
  - **ring and bolts:** blackened iron, with a teal-green verdigris tint round
    the bolts;
  - a pale crust of limescale in the seam.
- **Leave out:** orange, rust, gold, text, numbers, symbols, carvings,
  engravings, runes, patterns, cracks across the middle, and any ornaments.

---

## 4. The prompts

Paste them one after the other in **the same chat**.

### Prompt 1: the plate from above

> I need a texture for a 3D game prop: a round plate set into a stone floor,
> seen from **straight above**. A 3D tool will wrap this picture onto a flat
> disc, so the view must be exactly top-down and orthographic: no perspective,
> no tilt, no angle, the plate a perfect circle.
>
> Framing: a square image, the plate centred and filling it, its edge just
> touching all four sides of the picture. Flat even lighting from above, no
> cast shadows, no highlights from a lamp, no environment, nothing else in the
> picture, no text or labels.
>
> The prop: a plate from the floor of an old drained underground water
> cistern, in a stylized hand-painted game-asset style (like Dofus), chunky,
> with big simple shapes and few details. It has only three parts:
> 1. a flat ring of blackened iron round the edge, about a fifteenth of the
>    plate's width;
> 2. four big round bolt heads on the ring, at the top, bottom, left and right;
> 3. inside the ring, a single disc of smooth pale blue-green and sage stone.
>
> It lay under water for years: green-brown stains and a little dark silt
> toward the stone's edge, a pale limescale crust in the seam between the ring
> and the stone, and soft drips of teal-green verdigris from the bolts.
>
> **The middle of the stone, about two thirds of its width, must stay empty,
> smooth, pale and clean.** Do NOT put anything there: no symbol, no number,
> no letter, no carving, no engraving, no pattern, no crack. Marks will be
> added there later.
>
> Colours: pale blue-green and sage stone, blackened iron with teal-green
> verdigris. No orange, no rust, no gold, no ornaments.

### Prompt 2: if it needs another try

> Draw exactly the same plate again, but [say what is wrong]. Keep it
> straight top-down, a perfect circle filling the square, flat lighting, and
> the middle of the stone empty and smooth.

**If the picture drifts** (a symbol, rune or number in the middle, a carved
pattern, the plate seen at an angle or as an oval, a cast shadow, the plate
square or cropped, an orange or rusty tint), say exactly what is wrong and ask
again with prompt 2.

---

## 5. In Blender

- **The disc:** a cylinder of 48 sides, **radius 0.45 m, 0.03 m tall**, its
  top edge bevelled about 0.01 m. Map the picture onto the top face from
  straight above (UV project from the top view, the circle filling the
  square), so the ring in the picture sits on the disc's rim. The side takes
  the ring's dark iron.
- **The pivot** goes at the middle of the plate's underside, on the floor.
- **One plate, four places:** use linked duplicates, each turned a different
  way (a quarter turn apart, say) so their stains don't look copied.
- **The marks later:** the numeral and symbol will be a second layer over the
  blank face, one per plate, so the plate itself stays shared. Keep the
  middle of the texture as it is.
- **The guide (`exports/sewers.glb`):**
  - Each plate replaces its `plate.I fish`, `plate.II wheel`,
    `plate.III skull` or `plate.IV key` placeholder (a disc of radius
    0.45 m), keeping its name and its `numeral` and `symbol` properties.
  - They lie in the cistern's floor round the brazier: I at (0.06, -50.74),
    II at (10.08, -51.84), III at (6.78, -45.55), IV at (1.78, -53.8).
