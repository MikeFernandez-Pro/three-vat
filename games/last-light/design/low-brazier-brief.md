# The low brazier: an art brief

A brief for ChatGPT, which draws **four separate pictures of one brazier**
(front, left side, right side and back), and then for Tripo3D, which turns
those four pictures into a 3D model. Section 4 holds the prompts to paste, in
order, in **one chat**. The model is the **brazier only**: the fire is a game
effect, so the pictures show no flame.

**The reference:** a screenshot of the well and its lantern
(`public/models/well.glb`), so the brazier is drawn in the same hand and
belongs beside them. Attach it to prompt 1.

---

## 1. What it is in the game

*Last Light*'s goose game: a goose, a burning torch in her beak, crosses a
night plain on All Hallows' Eve, from light to light, gathering her goslings.
Rats fill the dark; only fire holds them off, and her torch burns down. The
lights she crosses the plain between are **braziers**: each holds the rats
off, and she fills her torch again at it, dipping it into the fire.

The plain's props come from a **Halloween village**, crooked and a little
sinister, in the spirit of Tim Burton and *MediEvil*: the old well, its
lantern on a gibbet, carved pumpkins.

What the brazier needs to read as:

- **low, at a goose's height:** a small fire close to the ground, on a little
  stone platform, that a goose 0.9 m tall dips her torch into by lowering her
  head, where a person's brazier would stand at their chest;
- **the village's own:** rough old stone and black hand-forged iron, like the
  well and its lantern;
- **easy to read from far off:** the iron claws round the bowl give it a
  spiky silhouette she spots in the dark, before its light reaches her.

## 2. The brazier (in metres; the goose is 0.9 m tall)

A **simple** prop with only three parts. Nothing else.

1. **The platform:** a low, roughly round stone platform, about **0.8 m
   across and 0.15 m tall**, built of **three or four big flat stones**
   fitted together unevenly, their edges soft and chipped, one of them
   cracked. It sits flat on the ground.
2. **The fire bowl:** a round, shallow blackened iron bowl, about **0.45 m
   across**, standing on **three short, bowed iron legs** on the platform's
   middle, its rim at about **0.4 m** off the ground. Inside, a low heap of
   black coal and charred wood, showing just below the rim. It is cold: no
   flames, no glow.
3. **The claws:** **five flat iron straps** rising from under the bowl,
   round its outside, each curling **outward** at its tip like a claw, the
   tips at about **0.55 m**, a little uneven, one bent further out than the
   rest. A thin iron band rings them just under the rim. One claw, on the
   **front only**, is **broken off short**: the one detail that tells the
   front from the sides and back.

The whole model is about **0.8 m wide and 0.55 m tall**.

**Its age:** the stone is mossy in its cracks, darker at its foot, with old
soot marks round the bowl; the iron is sooty toward the rim, with dull
flaking where it was hammered and a little dark verdigris at the joints.

## 3. Style and colour

- **Style:** a stylized, hand-painted game prop, chunky and slightly
  exaggerated, crooked and leaning, like the well and its lantern beside it,
  *MediEvil*'s remake or a Tim Burton village. Big simple shapes, few
  details, a clean, spiky silhouette against the night.
- **Colours:**
  - **stone:** dark grey, cold, with moss in the cracks;
  - **iron:** black, with a cool blue-grey sheen on its edges;
  - **fuel:** black coal and charred wood, a few grey ashes.
- **Leave out:** fire, flame, glow, embers, smoke, text, faces, skulls,
  pumpkins on the brazier itself, a tall pedestal or pillar, and any
  ornaments beyond the claws.

---

## 4. The prompts

Paste them one after the other in **the same chat**, so ChatGPT keeps the
same brazier from picture to picture. **Attach the well's screenshot to
prompt 1.**

### Prompt 1: the front view, and how the four pictures work

> I need reference pictures of one 3D game prop so that a 3D tool (Tripo3D)
> can rebuild it. I will ask you for **four separate pictures, one at a time,
> each in its own image**: the FRONT, the LEFT side, the RIGHT side and the
> BACK. Please do NOT put several views in one image, and do not make a sheet
> or a grid.
>
> The rules for all four pictures:
> - exactly the same object, same size and same position in the frame, centred
>   and fully visible from the ground to the top, nothing cropped;
> - a perfectly straight-on orthographic view, with no perspective, no
>   three-quarter angle, and the camera at the object's mid-height;
> - a plain light-grey background, flat even lighting, no cast shadows, no
>   environment, no other objects, no text or labels.
>
> The attached picture is the old well and its lantern this brazier stands
> near, in a Halloween village at night: draw the brazier **in the same
> style**, so they belong together. Do not draw the well or the lantern.
>
> The prop: a small, LOW village brazier close to the ground, in a stylized
> hand-painted game-asset style, chunky and slightly exaggerated, in the
> spirit of Tim Burton and MediEvil. It is only about 0.55 m tall and 0.8 m
> wide, and has only three parts:
> 1. a low, roughly round stone platform, about 0.8 m across and 0.15 m tall,
>    made of three or four big flat stones fitted together unevenly, soft
>    chipped edges, one stone cracked, moss in the cracks;
> 2. on its middle, a round shallow blackened iron fire bowl, about 0.45 m
>    across, on three short bowed iron legs, its rim about 0.4 m off the
>    ground, a low heap of black coal and charred wood inside, just below the
>    rim;
> 3. five flat iron straps rising round the bowl's outside, each curling
>    OUTWARD at its tip like a claw, a little uneven, one bent further out,
>    a thin iron band round them just under the rim; the claw on the FRONT is
>    broken off short.
>
> Colours: dark grey cold stone with moss, black iron with a cool blue-grey
> sheen on its edges and a little dark verdigris, black coal and grey ash. It
> is NOT lit: no fire, no flame, no glow, no embers, no smoke. No pillar or
> tall pedestal, no skulls, no faces, no pumpkins, no text.
>
> Now draw **picture 1 of 4: the FRONT view**. The broken claw faces the
> camera, in the middle of the picture.

### Prompt 2: the left side

> Now **picture 2 of 4: the LEFT side view** of exactly the same brazier. The
> camera has turned 90° to the brazier's left, so the broken claw is now seen
> side-on at the RIGHT edge of the bowl. Keep the same size, position,
> background and lighting as picture 1, straight-on and orthographic.

### Prompt 3: the right side

> Now **picture 3 of 4: the RIGHT side view** of exactly the same brazier.
> The camera has turned 90° to the brazier's right, so the broken claw is
> now seen side-on at the LEFT edge of the bowl. Keep everything else
> identical to picture 1.

### Prompt 4: the back

> Now **picture 4 of 4: the BACK view** of exactly the same brazier, the
> camera turned 180° from the front. The broken claw is hidden behind the
> bowl, so only whole claws show. Keep everything else identical to
> picture 1.

**If a picture drifts** (a flame, glow or smoke, the brazier raised on a
pillar or pedestal, the platform square or tall, a deep bowl, claws curling
inward, every claw whole, another number of claws, an angle instead of
straight on, two views in one image), say exactly what is wrong and ask for
that picture again. Tripo3D needs the four views to match.

---

## 5. After Tripo3D (Blender)

- **The pivot** goes at the middle of the platform, on the ground.
- **The fire** comes from the game, not from the model: flames, embers and
  light sit over the coal. Mark that point with an empty named `flame`, at
  about 0.4 m, the bowl's rim.
- **A collider**, as the well's and its lantern's: a box or a few faces round
  the platform, named `ColliderBrazier`.
- **The scale:** the goose is 0.9 m tall; the bowl's rim comes to about her
  breast, low enough that she dips her torch into it by lowering her head.
