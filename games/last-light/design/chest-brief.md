# The hub's chest: an art brief

A brief for ChatGPT, which draws **four separate pictures of one chest**
(front, left side, right side and back), and then for Tripo3D, which turns
those four pictures into a 3D model. Section 4 holds the prompts to paste, in
order, in **one chat**. The pictures show the chest **shut and locked**.

---

## 1. What it is in the game

*Last Light* is a small horror game. A kid of about 8 (1.2 m tall, with an
orange pumpkin head and a burning stick for a torch) has to escape a sewer
full of rats.

In the **hub**, the round stone chamber where every tunnel meets, a chest
stands against the wall. It is a **secret**:

- It opens with a **key** carried by the remains of a sewer worker, lying in
  a corner of the gas tunnel that is easy to miss.
- Most players walk past it.
- It holds a reward (a costume, or an easter egg).

What the chest needs to read as:

- **sewer hardware:** an old maintenance strongbox, the kind the sewer workers
  kept their tools in;
- **locked:** a heavy lock you clearly need a key for;
- **worth a second look:** discreet enough to sit quietly by the wall, but
  solid and a little mysterious once noticed.

## 2. The chest (in metres; the kid is 1.2 m)

A **simple** prop with only four parts. Nothing else.

1. **The box:** a riveted steel strongbox, about **0.8 m wide, 0.5 m deep and
   0.5 m tall**, with rounded edges and one band of big rivets round its
   middle.
2. **The lid:** a slightly domed lid, with two heavy hinges on the **back
   only**.
3. **The lock:** a big round lock plate on the **front only**, with a large
   keyhole for an old iron key, and a heavy hasp coming down from the lid
   over it. It is the one detail that tells the front from the sides and back.
4. **The handles:** a thick iron ring handle on each **side**.

The whole model is about **0.8 m wide and 0.55 m tall**. It sits straight on
the floor.

## 3. Style and colour

- **Style:** a stylized, hand-painted game prop, chunky and slightly
  exaggerated, like Dofus or *Penguins of Madagascar* concept art. Big simple
  shapes, few details, clean silhouette.
- **Colours:**
  - blackened steel, wet and grimy;
  - a teal-green verdigris tint in the worn places and round the rivets;
  - a dull dark brass lock plate, a little brighter than the rest, so it
    catches the torchlight.
- **Leave out:** orange, rust, text, gold, gems, skulls, and any ornaments.

---

## 4. The prompts

Paste them one after the other in **the same chat**, so ChatGPT keeps the
same chest from picture to picture.

### Prompt 1: the front view, and how the four pictures work

> I need reference pictures of one 3D game prop so that a 3D tool (Tripo3D)
> can rebuild it. I will ask you for **four separate pictures, one at a time,
> each in its own image**: the FRONT, the LEFT side, the RIGHT side and the
> BACK. Please do NOT put several views in one image, and do not make a sheet
> or a grid.
>
> The rules for all four pictures:
> - exactly the same object, same size and same position in the frame, centred
>   and fully visible, nothing cropped;
> - a perfectly straight-on orthographic view, with no perspective, no
>   three-quarter angle, and the camera at the object's mid-height;
> - a plain light-grey background, flat even lighting, no cast shadows, no
>   environment, no other objects, no text or labels.
>
> The prop: an old industrial sewer maintenance strongbox, in a stylized
> hand-painted game-asset style (like Dofus), chunky, with big simple shapes
> and few details. It is shut and locked, and has only four parts:
> 1. a riveted steel box, about 0.8 m wide, 0.5 m deep and 0.5 m tall, with
>    rounded edges and one band of big rivets round its middle;
> 2. a slightly domed lid, with two heavy hinges on the BACK only;
> 3. on the FRONT only, a big round dull brass lock plate with a large keyhole
>    for an old iron key, and a heavy hasp coming down from the lid over it;
> 4. a thick iron ring handle on each SIDE.
>
> Colours: blackened wet steel, a little teal-green verdigris on worn edges
> and round the rivets, a dull dark brass lock plate. No orange, no rust, no
> gold, no gems, no ornaments.
>
> Now draw **picture 1 of 4: the FRONT view**, looking straight at the lock.

### Prompt 2: the left side

> Now **picture 2 of 4: the LEFT side view** of exactly the same chest. The
> camera has turned 90° to the chest's left, so the lock is seen edge-on at
> the LEFT edge and the hinges at the RIGHT edge, with the ring handle in the
> middle. Keep the same size, position, background and lighting as picture 1,
> straight-on and orthographic.

### Prompt 3: the right side

> Now **picture 3 of 4: the RIGHT side view** of exactly the same chest. The
> camera has turned 90° to the chest's right, so the lock is seen edge-on at
> the RIGHT edge and the hinges at the LEFT edge, with the ring handle in the
> middle. Keep everything else identical to picture 1.

### Prompt 4: the back

> Now **picture 4 of 4: the BACK view** of exactly the same chest, the camera
> turned 180° from the front. The lock is hidden, and the two heavy hinges
> show along the top of the back. Keep everything else identical to picture 1.

**If a picture drifts** (the box a different size, the lid flat, an angle
instead of straight on, two views in one image), say exactly what is wrong
and ask for that picture again. Tripo3D needs the four views to match.

---

## 5. After Tripo3D (Blender)

- **The pivot** goes at the middle of the chest's base, on the floor.
- **The lid** is cut apart from the box in Blender, its pivot on the line of
  the hinges, so the game can open it.
- **In the guide (`exports/sewers.glb`):**
  - The chest replaces the `chest` placeholder (0.8 × 0.5 × 0.5 m), by the
    hub's wall at (5.4, -7.6).
  - Its back goes against the wall and its lock faces the hub's middle.
