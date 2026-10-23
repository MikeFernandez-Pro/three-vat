# The cistern's pillar: an art brief

A brief for ChatGPT, which draws **four separate pictures of one pillar**
(front, left side, right side and back), and then for Tripo3D, which turns
those four pictures into a 3D model. Section 4 holds the prompts to paste, in
order, in **one chat**. **One model** is made, and the game places it four
times.

---

## 1. What it is in the game

*Last Light* is a small horror game. A kid of about 8 (1.2 m tall, with an
orange pumpkin head and a burning stick for a torch) has to escape a sewer
full of rats.

Near the end he reaches the **cistern**: an old round water tank, 14 m across,
long since drained. It is full of rats waiting in the dark. In its middle,
**four pillars** stand in a square 4 m apart, holding up the vault. A brazier
burns between them, and the floor round them hides the plates of a puzzle.

What the pillar needs to read as:

- **an old cistern's support:** heavy, plain masonry that once stood in water;
- **marked by the water:** a clear old water line, with stains and crust
  below it;
- **part of the sewer's machinery:** one iron pipe climbing it, with iron
  bands holding the stone together.

## 2. The pillar (in metres; the kid is 1.2 m)

A **simple** prop with only four parts. Nothing else.

1. **The shaft:** a plain **hexagonal** column of big stone blocks, about
   **0.85 m across** (flat face to flat face) and **3.5 m tall**, with six flat
   faces. One flat face is the **front**.
2. **The base and the capital:**
   - The base is a low hexagonal plinth, 0.25 m tall. It is **no wider than
     1 m** (corner to corner), because the kid and the rats walk right up to
     it.
   - The capital is a simple hexagonal block on top, 0.3 m tall, a little
     wider than the shaft (up to 1.2 m), where the vault would spring.
3. **The iron bands:** two plain riveted iron bands round the shaft, at
   about **1.2 m and 2.4 m** high.
4. **The pipe:** one old copper pipe, about 0.12 m across, that rises up the
   **front face only**, from the floor to the capital, held by the two bands.
   It is the one detail that tells the front from the sides and back.

**The water line:** a clear horizontal line round the whole shaft at about
**1.6 m**. Below it, the stone is darker, stained green-brown, with a pale
crust of limescale and a little moss at the foot. Above it, the stone is
paler and drier.

The whole model is about **1.2 m wide and 3.5 m tall**.

## 3. Style and colour

- **Style:** a stylized, hand-painted game prop, chunky and slightly
  exaggerated, like Dofus or *Penguins of Madagascar* concept art. Big simple
  shapes, big stone blocks with soft edges, few details, clean silhouette.
- **Colours:**
  - **stone:** pale blue-green and sage, darker and greener below the water
    line;
  - **iron bands:** blackened iron;
  - **pipe:** copper with teal-green verdigris;
  - a pale crust of limescale under the water line.
- **Leave out:** orange, rust, text, carvings, statues, and any ornaments.

---

## 4. The prompts

Paste them one after the other in **the same chat**, so ChatGPT keeps the
same pillar from picture to picture.

### Prompt 1: the front view, and how the four pictures work

> I need reference pictures of one 3D game prop so that a 3D tool (Tripo3D)
> can rebuild it. I will ask you for **four separate pictures, one at a time,
> each in its own image**: the FRONT, the LEFT side, the RIGHT side and the
> BACK. Please do NOT put several views in one image, and do not make a sheet
> or a grid.
>
> The rules for all four pictures:
> - exactly the same object, same size and same position in the frame, centred
>   and fully visible from the floor to the top, nothing cropped;
> - a perfectly straight-on orthographic view, with no perspective, no
>   three-quarter angle, and the camera at the object's mid-height;
> - a plain light-grey background, flat even lighting, no cast shadows, no
>   environment, no other objects, no text or labels.
>
> The prop: a pillar from an old drained underground water cistern, in a
> stylized hand-painted game-asset style (like Dofus), chunky, with big simple
> shapes and few details. It has only four parts:
> 1. a plain HEXAGONAL column of big soft-edged stone blocks, six flat faces,
>    about 0.85 m across and 3.5 m tall;
> 2. a low hexagonal plinth at the foot, barely wider than the column, and a
>    simple hexagonal capital block on top, a little wider;
> 3. two plain riveted iron bands round the column, at about a third and two
>    thirds of its height;
> 4. one old copper pipe rising straight up the FRONT face only, from the
>    floor to the capital, held by the two bands.
>
> Round the whole column at about 1.6 m runs a clear old water line. Below
> it, the stone is darker, stained green-brown, with a pale limescale crust
> and a little moss at the foot. Above it, the stone is paler and drier.
>
> Colours: pale blue-green and sage stone, blackened iron bands, copper pipe
> with teal-green verdigris. No orange, no rust, no carvings, no ornaments.
>
> Now draw **picture 1 of 4: the FRONT view**, looking straight at the flat
> face with the pipe, so the pipe runs up the middle of the picture.

### Prompt 2: the left side

> Now **picture 2 of 4: the LEFT side view** of exactly the same pillar. The
> camera has turned 90° to the pillar's left. The column is hexagonal, so a
> CORNER now points at the camera, with two faces sloping away on either
> side, and the pipe is seen from the side at the LEFT edge of the column.
> Keep the same size, position, background and lighting as picture 1,
> straight-on and orthographic.

### Prompt 3: the right side

> Now **picture 3 of 4: the RIGHT side view** of exactly the same pillar. The
> camera has turned 90° to the pillar's right. A corner points at the camera,
> and the pipe is seen from the side at the RIGHT edge of the column. Keep
> everything else identical to picture 1.

### Prompt 4: the back

> Now **picture 4 of 4: the BACK view** of exactly the same pillar, the
> camera turned 180° from the front, looking straight at the flat face
> opposite the pipe. The pipe is hidden, so only stone, the bands and the
> water line show. Keep everything else identical to picture 1.

**If a picture drifts** (the column round or square instead of hexagonal, the
pipe on another face, the water line at another height, an angle instead of
straight on, two views in one image), say exactly what is wrong and ask for
that picture again. Tripo3D needs the four views to match.

---

## 5. After Tripo3D (Blender)

- **The pivot** goes at the middle of the pillar's foot, on the floor.
- **One model, four pillars:** use linked duplicates. Turn each so its pipe
  faces a different way (toward the cistern's wall, for instance), so the
  four don't look copied.
- **The guide (`exports/sewers.glb`):**
  - Each pillar is a solid hexagon of **radius 0.5 m** (corner to centre),
    with flat faces toward the east and west and corners toward the north and
    south.
  - The pillars stand at the cistern's centre (4.5, -50.75), offset by ±2 m
    on x and on z.
  - The base must stay inside that hexagon, because the kid and the rats
    collide with it, not with the model.
  - Above 2.4 m, out of everyone's way, the model may be wider: the capital
    can be.
