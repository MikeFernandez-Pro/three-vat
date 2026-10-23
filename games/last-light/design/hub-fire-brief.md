# The hub's fire basin: an art brief

A brief for ChatGPT, which draws **four separate pictures of one fire basin**
(front, left side, right side and back), and then for Tripo3D, which turns
those four pictures into a 3D model. Section 4 holds the prompts to paste, in
order, in **one chat**. The model is the **container only**: the fire is a
game effect, so the pictures show no flames.

---

## 1. What it is in the game

*Last Light* is a small horror game. A kid of about 8 (1.2 m tall, with an
orange pumpkin head and a burning stick for a torch) has to escape a sewer
full of rats. Light holds the rats off.

In the middle of the **hub**, a round stone chamber 16 m across where every
tunnel meets, burns the **great fire**: the safe centre of the game. The rats
circle it in the dark. The kid comes back to it after each tunnel and relights
his torch at it, holding the stick into the flames over its rim.

What the basin needs to read as:

- **the biggest fire container in the sewer,** heavier than the small braziers
  in the tunnels;
- **sewer hardware:** plain, heavy, industrial, like a piece of old plumbing
  turned into a fire pit;
- **low and wide,** so the kid can reach over its rim with his torch.

## 2. The basin (in metres; the kid is 1.2 m)

A **simple** prop with only four parts. Nothing else.

1. **The bowl:** a wide, round, open steel tank, about **1.5 m across and
   0.6 m tall**, cut from an old riveted boiler or water tank. It has one or
   two bands of big rivets round it and a thick rolled rim.
2. **The legs:** three or four short, stubby steel legs, about 0.25 m tall,
   with flat feet. With them, the rim stands at about **0.85 m**, the kid's
   chest height.
3. **The front hatch:** a small square riveted hatch with a latch, low on the
   bowl's **front only**, like a boiler's stoking door. It is the one detail
   that tells the front from the sides and back.
4. **The fuel:** a low heap of black coal and charred wood inside the bowl,
   showing just above the rim. It is dead and dark, with no flames and no
   glow.

The whole model is about **1.5 m wide and 0.95 m tall**.

## 3. Style and colour

- **Style:** a stylized, hand-painted game prop, chunky and slightly
  exaggerated, like Dofus or *Penguins of Madagascar* concept art. Big simple
  shapes, few details, clean silhouette.
- **Colours:**
  - blackened steel, sooty toward the rim;
  - a teal-green verdigris tint in the worn places and round the rivets;
  - black coal and charred wood.
- **Leave out:** flames, glow, smoke, orange, rust, text, and any ornaments.

---

## 4. The prompts

Paste them one after the other in **the same chat**, so ChatGPT keeps the
same basin from picture to picture.

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
>   three-quarter angle, and the camera level with the object's rim;
> - a plain light-grey background, flat even lighting, no cast shadows, no
>   environment, no other objects, no text or labels.
>
> The prop: a large industrial sewer fire basin, in a stylized hand-painted
> game-asset style (like Dofus), chunky, with big simple shapes and few
> details. It has only four parts:
> 1. a wide, round, open steel bowl, about 1.5 m across and 0.6 m tall, cut
>    from an old riveted boiler tank, with one or two bands of big rivets and a
>    thick rolled rim;
> 2. three or four short stubby steel legs with flat feet, lifting the rim to
>    about 0.85 m;
> 3. on the FRONT of the bowl only, low down, a small square riveted hatch
>    with a latch, like a boiler's stoking door;
> 4. inside, a low heap of black coal and charred wood showing just above the
>    rim. It is cold: no flames, no glow, no smoke.
>
> Colours: blackened sooty steel, a little teal-green verdigris on worn edges
> and round the rivets, black coal. No fire, no orange, no rust, no ornaments.
>
> Now draw **picture 1 of 4: the FRONT view**, looking straight at the small
> hatch.

### Prompt 2: the left side

> Now **picture 2 of 4: the LEFT side view** of exactly the same basin. The
> camera has turned 90° to the basin's left, so the small hatch is seen
> edge-on at the LEFT edge of the bowl. Keep the same size, position,
> background and lighting as picture 1, straight-on and orthographic.

### Prompt 3: the right side

> Now **picture 3 of 4: the RIGHT side view** of exactly the same basin. The
> camera has turned 90° to the basin's right, so the small hatch is seen
> edge-on at the RIGHT edge of the bowl. Keep everything else identical to
> picture 1.

### Prompt 4: the back

> Now **picture 4 of 4: the BACK view** of exactly the same basin, the
> camera turned 180° from the front. The small hatch is hidden, so only the
> plain riveted back of the bowl shows. Keep everything else identical to
> picture 1.

**If a picture drifts** (the bowl wider, the legs a different count, an angle
instead of straight on, flames appearing, two views in one image), say
exactly what is wrong and ask for that picture again. Tripo3D needs the four
views to match.

---

## 5. After Tripo3D (Blender)

- **The pivot** goes at the middle of the basin's base, on the floor.
- **The fire** comes from the game, not from the model: flames, embers and
  light sit over the coal.
- **In the guide (`exports/sewers.glb`):**
  - The basin replaces the `hub fire` placeholder, at the hub's centre,
    (0, -11.2).
  - Its light reaches 1.8 m round it.
  - The kid relights his torch within 0.8 m of the flame, so the rim must
    stay low enough to reach over.
