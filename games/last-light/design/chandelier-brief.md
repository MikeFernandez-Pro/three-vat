# The hanging lantern: an art brief

A brief for ChatGPT, which draws **four separate pictures of one hanging
lantern** (front, left side, right side and back), and then for Tripo3D, which
turns those four pictures into a 3D model. Section 4 holds the prompts to
paste, in order, in **one chat**.

---

## 1. What it is in the game

*Last Light* is a small horror game. A kid of about 8 (1.2 m tall, with an
orange pumpkin head and a burning stick for a torch) has to escape a sewer
full of rats. Light holds the rats off.

In one tunnel, 5.3 m wide, **four of these lanterns hang down the middle**
on long chains and **swing slowly along the tunnel like pendulums**. Each one
throws a round pool of pale light on the floor, and the kid moves from pool to
pool to stay safe. They hang about 2.4 m up, out of his reach.

What the lantern needs to read as:

- **sewer hardware:** plain, heavy, industrial;
- **heavy enough** to swing slowly;
- **a light that falls down** in a pool.

## 2. The lantern (in metres; the kid is 1.2 m)

A **simple** prop with only four parts. Nothing else.

1. **The hood:** a plain shallow steel cone, about 0.8 m across and 0.25 m
   tall, open underneath, with a rolled rim. It is blackened steel outside and
   pale dirty enamel inside.
2. **The lantern:** one big lantern hanging under the hood's middle, about
   0.35 m across and 0.5 m tall. A clouded glass cylinder sits in a cage of
   four iron bars, on a round brass base, with a small pale near-white flame
   inside.
3. **The front door:** a small square hinged door in the cage, on the
   **front only**, with a latch. It is the one detail that tells the front
   from the sides and back.
4. **The hanger:** a thick iron ring on top of the hood, holding the first
   0.5 m of a heavy chain.

The whole model is about **0.8 m wide and 1.3 m tall**, chain stub included.
It hangs straight, at rest.

## 3. Style and colour

- **Style:** a stylized, hand-painted game prop, chunky and slightly
  exaggerated, like Dofus or *Penguins of Madagascar* concept art. Big simple
  shapes, few details, clean silhouette.
- **Colours:**
  - blackened steel and iron;
  - dull dark brass;
  - clouded, slightly green glass;
  - a teal-green verdigris tint in the worn places;
  - a pale near-white flame.
- **Leave out:** orange, rust, candles, crystals, text, and any ornaments.

---

## 4. The prompts

Paste them one after the other in **the same chat**, so ChatGPT keeps the
same lantern from picture to picture.

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
> The prop: a simple industrial sewer hanging lantern, in a stylized
> hand-painted game-asset style (like Dofus), chunky, with big simple shapes
> and few details. It has only four parts:
> 1. a plain shallow cone-shaped hood of blackened steel, about 0.8 m across,
>    open underneath, with a rolled rim and pale dirty enamel inside;
> 2. under the hood's middle, one big lantern: a clouded greenish glass
>    cylinder in a cage of four iron bars, on a round dull brass base, with a
>    small pale white flame inside;
> 3. on the FRONT of the cage only, a small square hinged door with a latch;
> 4. on top of the hood, a thick iron ring holding a short piece of heavy
>    chain going straight up.
>
> It hangs straight, at rest. Colours: blackened iron, dull dark brass,
> greenish glass, a little teal-green verdigris on worn edges. No orange, no
> rust, no candles, no ornaments.
>
> Now draw **picture 1 of 4: the FRONT view**, looking straight at the small
> door.

### Prompt 2: the left side

> Now **picture 2 of 4: the LEFT side view** of exactly the same lantern.
> The camera has turned 90° to the lantern's left, so the small door is seen
> edge-on at the LEFT edge of the cage. Keep the same size, position,
> background and lighting as picture 1, straight-on and orthographic.

### Prompt 3: the right side

> Now **picture 3 of 4: the RIGHT side view** of exactly the same lantern.
> The camera has turned 90° to the lantern's right, so the small door is seen
> edge-on at the RIGHT edge of the cage. Keep everything else identical to
> picture 1.

### Prompt 4: the back

> Now **picture 4 of 4: the BACK view** of exactly the same lantern, the
> camera turned 180° from the front. The small door is hidden behind the
> cage, so only the plain back of the cage shows. Keep everything else
> identical to picture 1.

**If a picture drifts** (the hood wider, the chain longer, an angle instead of
straight on, two views in one image), say exactly what is wrong and ask for
that picture again. Tripo3D needs the four views to match.

---

## 5. After Tripo3D (Blender)

- The pivot goes at the top of the chain stub. The game hangs the lantern
  high up and swings it along the tunnel.
- The light comes from the game, not from the model: one light under the
  hood, aimed down.
- In the guide (`exports/sewers.glb`), the lanterns are `chandelier 1` to
  `chandelier 4`. The bottom of each lantern sits at about 2.4 m.
