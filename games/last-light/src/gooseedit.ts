// The goose game's edit mode on the 3D page (E): the play paused and the camera
// free, a click picks a piece of a scene (the well, its brazier's place, the dead tree
// and its brazier, the cage, its cart, campfire and dead body,
// a plain brazier, a waiting gosling), a drag moves it over the ground, the
// wheel turns it about its own place (Shift, a degree at a time). Only the
// drawing and the paused play move; Save writes the route the pieces now make
// to src/gooseroute.json through the dev server, as the 2D page does, and
// loads the page again, so the play lays its rules out afresh on it.
import { BoxHelper, Plane, Raycaster, Vector2, Vector3, type Camera, type Object3D, type Scene } from 'three/webgpu'
import type { EditPiece } from './goosescenes'

/** How far a notch of the wheel turns a piece, degrees; with Shift. */
const NOTCH = 5
const FINE = 1
/** How far the pointer may move between down and up and still be a click, px. */
const CLICK = 4
const INK = '#f6ead0'

export interface EditMode {
  readonly on: boolean
  toggle(): void
  /** A frame: the picked piece's box kept round it. */
  frame(): void
}

export interface EditOptions {
  camera: Camera
  dom: HTMLElement
  scene: Scene
  /** The pieces, gathered as the mode comes on. */
  pieces(): EditPiece[]
  /** The mode on and off: the play paused and the camera freed, and both back. */
  entered(): void
  left(): void
  /** Write the route the pieces now make, and load the page again; or say why it cannot. */
  save(pieces: EditPiece[]): Promise<string | undefined>
  /** Whether the free camera may take the pointer: false while a piece is held or turned. */
  cameraTakes(takes: boolean): void
}

export function createEditMode(options: EditOptions): EditMode {
  const { camera, dom, scene } = options
  let on = false
  let pieces: EditPiece[] = []
  let byObject = new Map<Object3D, EditPiece>()
  let picked: EditPiece | undefined
  let box: BoxHelper | undefined
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  const ground = new Plane(new Vector3(0, 1, 0), 0)
  const hit = new Vector3()
  let dragging = false
  let last = new Vector3()
  const down = { x: 0, y: 0 }

  const hud = document.createElement('div')
  hud.style.cssText = `position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:20;display:none;padding:8px 14px;border-radius:10px;background:#000b;color:${INK};font:14px/1.4 system-ui,sans-serif;text-align:center;user-select:none`
  const line = document.createElement('div')
  const status = document.createElement('div')
  status.style.cssText = 'margin-top:4px;opacity:0.85'
  const buttons = document.createElement('div')
  buttons.style.cssText = 'margin-top:6px;display:flex;gap:8px;justify-content:center'
  const button = (label: string, act: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `font:inherit;padding:3px 10px;border-radius:6px;border:1px solid ${INK};background:#0006;color:${INK};cursor:pointer`
    b.addEventListener('click', act)
    buttons.append(b)
    return b
  }
  const saveButton = button('Save and reload', () => void save())
  button('Leave (E)', () => toggle())
  hud.append(line, status, buttons)
  document.body.append(hud)
  line.textContent = 'EDIT: click a piece, drag it to move, wheel to turn (Shift: 1°). Drag elsewhere to turn the camera.'

  const say = () => {
    status.textContent = picked ? `${picked.name}${picked.turn ? '' : ' (moves only)'}` : 'nothing picked'
  }

  const pick = (piece: EditPiece | undefined) => {
    picked = piece
    box?.removeFromParent()
    box = undefined
    if (piece) {
      box = new BoxHelper(piece.object, 0xffd23f)
      scene.add(box)
    }
    // The wheel turns a picked piece, so the camera's zoom waits.
    options.cameraTakes(!piece)
    say()
  }

  /** The pointer's ray, from a pointer event on the page. */
  const aim = (event: PointerEvent | WheelEvent) => {
    const rect = dom.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
  }

  /** The piece under the pointer and where its ray meets it, the nearest whose object holds what the ray met. */
  const under = (): { piece: EditPiece; point: Vector3 } | undefined => {
    const hits = raycaster.intersectObjects(
      pieces.map((p) => p.object),
      true,
    )
    for (const { object, point } of hits) {
      for (let o: Object3D | null = object; o; o = o.parent) {
        const piece = byObject.get(o)
        if (piece) return { piece, point }
      }
    }
    return undefined
  }

  dom.addEventListener(
    'pointerdown',
    (event) => {
      if (!on || event.button !== 0) return
      down.x = event.clientX
      down.y = event.clientY
      aim(event)
      const found = under()
      if (!found) return
      pick(found.piece)
      // Dragged over a level plane at the height it was taken at.
      ground.constant = -found.point.y
      last = found.point.clone()
      dragging = true
      options.cameraTakes(false)
      dom.setPointerCapture(event.pointerId)
      event.stopImmediatePropagation()
      event.preventDefault()
    },
    { capture: true },
  )
  dom.addEventListener('pointermove', (event) => {
    if (!on || !dragging || !picked) return
    aim(event)
    if (!raycaster.ray.intersectPlane(ground, hit)) return
    picked.move(hit.x - last.x, hit.z - last.z)
    last.copy(hit)
  })
  dom.addEventListener('pointerup', (event) => {
    if (!on) return
    if (dragging) {
      dragging = false
      options.cameraTakes(!picked)
      return
    }
    // A click on nothing lets go of the piece; a drag of the camera keeps it.
    if (event.button === 0 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < CLICK) pick(undefined)
  })
  dom.addEventListener(
    'wheel',
    (event) => {
      if (!on || !picked?.turn) return
      const notch = Math.sign(event.deltaY || event.deltaX)
      if (notch === 0) return
      picked.turn((notch * (event.shiftKey ? FINE : NOTCH) * Math.PI) / 180)
      event.stopImmediatePropagation()
      event.preventDefault()
    },
    { capture: true, passive: false },
  )

  async function save() {
    saveButton.disabled = true
    status.textContent = 'saving...'
    const failed = await options.save(pieces)
    if (failed) {
      status.textContent = failed
      saveButton.disabled = false
    }
  }

  function toggle() {
    on = !on
    hud.style.display = on ? '' : 'none'
    if (on) {
      pieces = options.pieces()
      byObject = new Map(pieces.map((p) => [p.object, p]))
      options.entered()
      pick(undefined)
    } else {
      pick(undefined)
      dragging = false
      options.cameraTakes(true)
      options.left()
    }
  }

  return {
    get on() {
      return on
    },
    toggle,
    frame() {
      box?.update()
    },
  }
}
