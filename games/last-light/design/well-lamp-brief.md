# The well's lamp: an art brief

A brief for ChatGPT, which draws **four separate pictures of one lamp**
(front, left side, right side and back), and then for Tripo3D, which turns
those four pictures into a 3D model. Section 4 holds the prompts to paste, in
order, in **one chat**. The model is the **lamp only**: the flame is a game
effect, so the pictures show no fire.

**The reference:** a screenshot of the well (`public/models/well.glb`), so
the lamp is drawn in the same hand and belongs beside it. Attach it to
prompt 1.

---

## 1. What it is in the game

*Last Light*'s goose game: a goose, a burning torch in her beak, crosses a
night plain on All Hallows' Eve, from light to light, gathering her goslings.
Rats fill the dark; only fire holds them off, and her torch burns down. She
fills it again at each flame, touching her torch to it.

One of the lights is the **well scene**. A gosling has fallen down an old
village well, into its bucket, and she winches it up by holding the interact
key, standing in the light while the rats wait at its edge. The well is a
ring of stone under a little roof with a winch, carved pumpkins round its
foot. **The lamp** stands beside it and gives that light, in place of a
brazier.

What the lamp needs to read as:

- **the Halloween village's own:** crooked, hand-forged, a little sinister,
  in the spirit of Tim Burton and *MediEvil*, the "lantern on a gibbet" of
  the village's prop list;
- **set there for the well:** the kind of lamp a village hangs by its well so
  water can be drawn after dark;
- **a flame within her reach:** the lantern hangs low and open-sided, so the
  goose, 0.9 m tall, can touch her torch to its wick.

## 2. The lamp (in metres; the goose is 0.9 m tall)

A **simple** prop with only four parts. Nothing else.

1. **The foot:** a rough, squat stone block, about **0.4 m square and 0.25 m
   tall**, its edges chipped, the post set in its middle.
2. **The post:** a crooked iron post, about **1.7 m tall**, leaning a little
   and bending once, like an old hand-forged gibbet. At its top, an arm
   reaches out **about 0.5 m to one side**, ending in a curl, a hook hanging
   from it.
3. **The chain:** a short heavy chain from the hook, lowering the lantern
   **low**, as if for someone small.
4. **The lantern:** a squat iron cage lantern, about **0.3 m wide and 0.4 m
   tall**, with a pointed, slightly bent **witch-hat roof** and a ring at its
   top for the chain. Its sides are **open**: iron bars, **no glass**. Inside
   stands one fat stub of candle, cold, its wick at about **0.75 m** off the
   ground, the goose's beak height. **No flame, no glow.**

The whole model is about **0.75 m wide and 1.75 m tall**; the lantern hangs
with its bottom at about 0.55 m.

**Its age:** the iron is black, with dull flaking where it was hammered and a
little dark verdigris at the joints; the stone foot is mossy and cracked;
old wax has run down the candle and dripped through the lantern's floor.

## 3. Style and colour

- **Style:** a stylized, hand-painted game prop, chunky and slightly
  exaggerated, crooked and leaning, like the well beside it, *MediEvil*'s
  remake or a Tim Burton village. Big simple shapes, few details, a clean,
  spiky silhouette against the night.
- **Colours:**
  - **iron:** black, with a cool blue-grey sheen on its edges;
  - **stone:** dark grey, cold, with moss;
  - **candle:** old yellowed wax, the only warm, pale value on the lamp.
- **Leave out:** fire, flame, glow, light rays, glass, text, faces, skulls,
  pumpkins on the lamp itself, and any ornaments beyond the curl.

---

## 4. The prompts

Paste them one after the other in **the same chat**, so ChatGPT keeps the
same lamp from picture to picture. **Attach the well's screenshot to
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
> The attached picture is the old well this lamp stands beside, in a
> Halloween village at night: draw the lamp **in the same style**, so the two
> belong together. Do not draw the well.
>
> The prop: a crooked village lamp, in a stylized hand-painted game-asset
> style, chunky and slightly exaggerated, in the spirit of Tim Burton and
> MediEvil. It is about 1.75 m tall and has only four parts:
> 1. a rough, squat, chipped stone block at the foot, about 0.4 m square;
> 2. a crooked hand-forged black iron post rising from it, leaning a little
>    and bending once, like a small gibbet; at its top an arm reaches out
>    about 0.5 m to ONE side, ending in a curl with a hook;
> 3. a short heavy chain from the hook;
> 4. hanging LOW on the chain, its bottom about a third of the way up the
>    post, a squat iron cage lantern with a pointed, slightly bent witch-hat
>    roof and OPEN sides (iron bars, NO glass), one fat cold stub of candle
>    inside with old wax run down it. It is NOT lit: no flame, no glow.
>
> Colours: black iron with a cool blue-grey sheen on its edges, dark grey
> mossy stone, old yellowed wax. No fire, no glass, no faces, no skulls, no
> pumpkins, no text.
>
> Now draw **picture 1 of 4: the FRONT view**. From the front, the arm
> reaches to the RIGHT of the picture, and the lantern hangs to the right of
> the post, clear of it.

### Prompt 2: the left side

> Now **picture 2 of 4: the LEFT side view** of exactly the same lamp. The
> camera has turned 90° to the lamp's left, so the arm now points straight
> AT the camera: the lantern hangs directly IN FRONT of the post, its cage
> seen face on, the post behind it. The post's lean
> and bend are seen from the side. Keep the same size, position, background
> and lighting as picture 1, straight-on and orthographic.

### Prompt 3: the right side

> Now **picture 3 of 4: the RIGHT side view** of exactly the same lamp. The
> camera has turned 90° to the lamp's right, so the arm points straight
> AWAY from the camera: the lantern hangs directly BEHIND the post, mostly
> hidden by it, only its edges and roof showing either side. Keep everything else identical to picture 1.

### Prompt 4: the back

> Now **picture 4 of 4: the BACK view** of exactly the same lamp, the camera
> turned 180° from the front. The arm now reaches to the LEFT of the
> picture, the lantern hanging to the left of the post, clear of it. Keep
> everything else identical to picture 1.

**If a picture drifts** (a flame or glow, glass in the lantern, the lantern
hanging high under the arm, the arm on the other side, the post straight and
plain, a face or pumpkin added, an angle instead of straight on, two views
in one image), say exactly what is wrong and ask for that picture again.
Tripo3D needs the four views to match.

---

## 5. After Tripo3D (Blender)

- **The pivot** goes at the middle of the stone foot, on the ground.
- **The lantern and its chain** are cut apart from the post, their pivot at
  the hook, so the game can sway them a little in the wind.
- **The flame** comes from the game, not from the model: flame and light sit
  on the candle's wick, at about 0.75 m. Mark the wick with an empty named
  `wick`.
- **In the game:** the lamp takes the place of the brazier the plain sets
  beside the well, at its point and with its reach (3 m). The well's model
  turns side on to the camera; turn the lamp so its arm reaches toward the
  well, the lantern hanging between the post and the well, where the goose
  stands to winch.
