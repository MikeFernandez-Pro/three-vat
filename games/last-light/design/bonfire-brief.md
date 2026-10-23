# The bonfire: an art brief

A brief for ChatGPT, which draws **four separate pictures of one bonfire**
(front, left side, right side and back), and then for Tripo3D, which turns
those four pictures into a 3D model. Section 4 holds the prompts to paste, in
order, in **one chat**. The model is the **wood and stones only**: the fire
is a game effect, so the pictures show no flame.

**The reference:** a screenshot of the well and its lantern
(`public/models/well.glb`), so the bonfire is drawn in the same hand and
belongs beside them. Attach it to prompt 1.

---

## 1. What it is in the game

*Last Light*'s goose game: a goose, a burning torch in her beak, crosses a
night plain on All Hallows' Eve, from light to light, gathering her goslings.
Rats fill the dark; only fire holds them off, and her torch burns down. Each
light holds the rats off, and she fills her torch again at it, dipping it
into the fire.

The plain's props come from a **Halloween village**, crooked and a little
sinister, in the spirit of Tim Burton and *MediEvil*: the old well, its
lantern on a gibbet, carved pumpkins.

What the bonfire needs to read as:

- **a fire on the open ground:** logs stacked in a ring of stones, the kind
  the village lights on All Hallows' Eve, no iron, no stand;
- **at a goose's height:** low enough that a goose 0.9 m tall dips her torch
  into it by lowering her head;
- **easy to read from far off:** the leaning logs give it a tall, pointed
  silhouette she spots in the dark, before its light reaches her.

## 2. The bonfire (in metres; the goose is 0.9 m tall)

A **simple** prop with only three parts. Nothing else.

1. **The ring:** about **nine** big rounded stones laid in a ring about
   **1 m across**, uneven in size, a few half sunk in the ground, one
   cracked. There is a **gap** in the ring on the **front only**, one stone
   missing: the one detail that tells the front from the sides and back.
2. **The stack:** about **six** thick, crooked logs leaning together into a
   **cone**, their tops crossing at about **0.7 m**, their feet inside the
   ring. Bark on them, a few broken-off branch stubs, their lower ends
   charred black.
3. **The bed:** a low heap of black coal, charred sticks and grey ash in the
   middle, under the logs, filling the ring to about **0.1 m**.

The whole model is about **1 m wide and 0.75 m tall**.

**Its age:** the stones are mossy, sooted black on their inner faces; the
logs are old dead wood, grey where the bark has come off, black where they
have burned.

## 3. Style and colour

- **Style:** a stylized, hand-painted game prop, chunky and slightly
  exaggerated, crooked and leaning, like the well and its lantern beside it,
  *MediEvil*'s remake or a Tim Burton village. Big simple shapes, few
  details, a clean, spiky silhouette against the night.
- **Colours:**
  - **stone:** dark grey, cold, with moss, sooted inside the ring;
  - **wood:** dark brown bark, pale grey bare wood, charred black ends;
  - **bed:** black coal and grey ash.
- **Leave out:** fire, flame, glow, embers, smoke, text, faces, skulls,
  bones, pumpkins on the bonfire itself, iron, a spit or a pot, and any
  ornaments.

---

## 4. The prompts

Paste them one after the other in **the same chat**, so ChatGPT keeps the
same bonfire from picture to picture. **Attach the well's screenshot to
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
> The attached picture is the old well and its lantern this bonfire stands
> near, in a Halloween village at night: draw the bonfire **in the same
> style**, so they belong together. Do not draw the well or the lantern.
>
> The prop: a small UNLIT bonfire on the open ground, in a stylized
> hand-painted game-asset style, chunky and slightly exaggerated, in the
> spirit of Tim Burton and MediEvil. It is about 1 m wide and 0.75 m tall,
> and has only three parts:
> 1. a ring of about nine big rounded stones, about 1 m across, uneven in
>    size, a few half sunk in the ground, one cracked, with a GAP in the ring
>    on the FRONT where one stone is missing;
> 2. about six thick crooked logs leaning together into a cone, their tops
>    crossing at about 0.7 m, their feet inside the ring, bark on them, a few
>    broken branch stubs, their lower ends charred black;
> 3. in the middle under the logs, a low heap of black coal, charred sticks
>    and grey ash.
>
> Colours: dark grey cold stone with moss, sooted black inside the ring; dark
> brown bark, pale grey bare wood, charred black ends; black coal and grey
> ash. It is NOT lit: no fire, no flame, no glow, no embers, no smoke. No
> iron, no pot, no skulls, no bones, no faces, no pumpkins, no text.
>
> Now draw **picture 1 of 4: the FRONT view**. The gap in the stone ring
> faces the camera, in the middle of the picture.

### Prompt 2: the left side

> Now **picture 2 of 4: the LEFT side view** of exactly the same bonfire.
> The camera has turned 90° to the bonfire's left, so the gap in the stone
> ring is now at the RIGHT edge of the ring. Keep the same size, position,
> background and lighting as picture 1, straight-on and orthographic.

### Prompt 3: the right side

> Now **picture 3 of 4: the RIGHT side view** of exactly the same bonfire.
> The camera has turned 90° to the bonfire's right, so the gap in the stone
> ring is now at the LEFT edge of the ring. Keep everything else identical
> to picture 1.

### Prompt 4: the back

> Now **picture 4 of 4: the BACK view** of exactly the same bonfire, the
> camera turned 180° from the front. The gap is hidden behind the logs, so
> the ring looks whole. Keep everything else identical to picture 1.

**If a picture drifts** (a flame, glow or smoke, a neat log cabin stack
instead of a leaning cone, logs standing straight and even, the stone ring
whole all round or the gap on another side, a pot or iron added, an angle
instead of straight on, two views in one image), say exactly what is wrong
and ask for that picture again. Tripo3D needs the four views to match.

---

## 5. After Tripo3D (Blender)

- **The pivot** goes at the middle of the ring, on the ground.
- **The fire** comes from the game, not from the model: flames, embers and
  light rise from the bed through the logs. Mark that point with an empty
  named `flame`, at about 0.25 m, inside the cone.
- **A collider**, as the well's and its lantern's: a few faces round the
  stone ring, named `ColliderBonfire`.
- **The scale:** the goose is 0.9 m tall; the logs' tops come to about her
  head, the fire's heart low enough that she dips her torch into it by
  lowering her head.
