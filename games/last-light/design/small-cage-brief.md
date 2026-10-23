# The small cage: an art brief

A brief for ChatGPT, which draws **four separate pictures of one cage**
(front, left side, right side and back), and then for Tripo3D, which turns
those four pictures into a 3D model. Section 4 holds the prompts to paste, in
order, in **one chat**. The pictures show the cage **shut and empty**.

**The reference:** a screenshot of the well and its lantern
(`public/models/well.glb`), so the cage is drawn in the same hand and belongs
beside them. Attach it to prompt 1.

---

## 1. What it is in the game

*Last Light*'s goose game: a goose, a burning torch in her beak, crosses a
night plain on All Hallows' Eve, from light to light, gathering her goslings.
Rats fill the dark; only fire holds them off.

The plain's props come from a **Halloween village**, crooked and a little
sinister, in the spirit of Tim Burton and *MediEvil*: the old well, its
lantern on a gibbet, carved pumpkins, and the village's prop list, which
names **cages**.

What the cage needs to read as:

- **the village's own:** crooked, hand-forged, a little sinister, the same
  iron as the well's lantern;
- **small:** about the size of a big birdcage, a thing a villager could
  carry by its ring, set on the ground;
- **shut:** a little door on the front, latched with a padlock, that clearly
  opens.

## 2. The cage (in metres; the goose is 0.9 m tall)

A **simple** prop with only four parts. Nothing else.

1. **The floor:** a round, thick plank floor, about **0.45 m across**, bound
   by an iron band round its edge, sitting flat on the ground. A little old
   straw on it.
2. **The bars:** about **twelve** thin, slightly crooked iron bars rising
   from the band, about **0.45 m tall**, one or two bent a little out of
   line, as if something pushed at them once. A second iron band rings them
   halfway up.
3. **The roof:** the bars curve in at the top into a **pointed dome**, a
   little bent to one side like the lantern's witch-hat roof, with a **ring
   on its tip** to carry it by.
4. **The door:** a small square door in the bars on the **front only**,
   about **0.2 m wide and 0.25 m tall**, hinged on its left, shut with a
   chunky **padlock** on its right. It is the one detail that tells the front
   from the sides and back.

The whole model is about **0.5 m wide and 0.7 m tall**, ring included.

**Its age:** the iron is black, with dull flaking where it was hammered and a
little dark verdigris at the joints; the planks are dark and worn; the
padlock is the one dull brass thing on it.

## 3. Style and colour

- **Style:** a stylized, hand-painted game prop, chunky and slightly
  exaggerated, crooked and leaning, like the well and its lantern beside it,
  *MediEvil*'s remake or a Tim Burton village. Big simple shapes, few
  details, a clean, spiky silhouette against the night.
- **Colours:**
  - **iron:** black, with a cool blue-grey sheen on its edges;
  - **floor:** dark worn wood, with pale dry straw;
  - **padlock:** dull dark brass, a little brighter than the rest, so it
    catches the torchlight.
- **Leave out:** any animal or bird inside, fire, glow, text, skulls, faces,
  pumpkins on the cage itself, gems, and any ornaments beyond the ring.

---

## 4. The prompts

Paste them one after the other in **the same chat**, so ChatGPT keeps the
same cage from picture to picture. **Attach the well's screenshot to
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
> The attached picture is the old well and its lantern this cage stands
> near, in a Halloween village at night: draw the cage **in the same style**,
> so they belong together. Do not draw the well or the lantern.
>
> The prop: a small crooked village cage, about the size of a big birdcage,
> in a stylized hand-painted game-asset style, chunky and slightly
> exaggerated, in the spirit of Tim Burton and MediEvil. It is about 0.7 m
> tall and has only four parts:
> 1. a round thick plank floor, about 0.45 m across, bound by an iron band,
>    sitting flat on the ground, a little old straw on it;
> 2. about twelve thin, slightly crooked black iron bars rising from the band,
>    one or two bent a little out of line, with a second iron band round them
>    halfway up;
> 3. at the top the bars curve in to a pointed dome, a little bent to one side
>    like a witch's hat, with an iron ring on its tip to carry it by;
> 4. on the FRONT only, a small square door in the bars, hinged on its left
>    and shut with a chunky dull brass padlock on its right.
>
> Colours: black iron with a cool blue-grey sheen on its edges and a little
> dark verdigris at the joints, dark worn wood, pale dry straw, a dull dark
> brass padlock. The cage is EMPTY: no bird, no animal inside. No fire, no
> glow, no skulls, no faces, no pumpkins, no text.
>
> Now draw **picture 1 of 4: the FRONT view**. The door faces the camera,
> its hinges on the LEFT of the picture and the padlock on the RIGHT.

### Prompt 2: the left side

> Now **picture 2 of 4: the LEFT side view** of exactly the same cage. The
> camera has turned 90° to the cage's left, so the door is seen edge-on at
> the RIGHT edge of the cage, its hinge side nearest the camera. The dome's
> bend is seen from the side. Keep the same size, position, background and
> lighting as picture 1, straight-on and orthographic.

### Prompt 3: the right side

> Now **picture 3 of 4: the RIGHT side view** of exactly the same cage. The
> camera has turned 90° to the cage's right, so the door is seen edge-on at
> the LEFT edge of the cage, the padlock nearest the camera. Keep everything
> else identical to picture 1.

### Prompt 4: the back

> Now **picture 4 of 4: the BACK view** of exactly the same cage, the camera
> turned 180° from the front. The door is hidden behind the bars, so only the
> plain back of the cage shows, with the door's outline faintly seen through
> the bars. Keep everything else identical to picture 1.

**If a picture drifts** (a bird or animal inside, a glow, the door on another
face or hinged on the other side, the padlock missing, straight perfect bars,
the dome round and upright instead of pointed and bent, a square cage instead
of a round one, an angle instead of straight on, two views in one image), say
exactly what is wrong and ask for that picture again. Tripo3D needs the four
views to match.

---

## 5. After Tripo3D (Blender)

- **The pivot** goes at the middle of the floor, on the ground.
- **The door** is cut apart from the bars, its pivot on its hinge line, so
  the game can swing it open. Name it `CageDoor`; the rest `Cage`.
- **The padlock** stays on the door, so it swings open with it.
- **The ring** on the dome's tip: mark its middle with an empty named
  `ring`, so the game can hang the cage from it, or lift it.
- **A collider**, as the well's and its lantern's: a box or a few faces
  round the floor, named `ColliderCage`.
- **The scale:** the goose is 0.9 m tall; the cage comes up to about her
  eye.
