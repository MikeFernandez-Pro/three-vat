// The goose game's edit mode on the 3D page (E): the play paused and the camera
// free, a click picks a piece of a scene (the well, its brazier's place, the dead tree
// and its brazier, the cage, its cart, campfire and dead body,
// a plain brazier, a waiting gosling), a drag moves it over the ground, the
// wheel turns it about its own place (Shift, a degree at a time); with Alt, a
// drag raises and lowers it and the wheel sizes it, as drawn only, and R puts
// both back. Only the drawing and the paused play move; Save writes the route the pieces now make
// to src/gooseroute.json through the dev server, as the 2D page does, and
// loads the page again, so the play lays its rules out afresh on it.
import { BoxHelper, Plane, Raycaster, Vector2, Vector3, type Camera, type Object3D, type Scene } from 'three/webgpu'
import { layShown, type EditPiece } from './goosescenes'

/** How far a notch of the wheel turns a piece, degrees; with Shift. */
const NOTCH = 5
const FINE = 1
/** How much a notch of the wheel with Alt sizes a piece, times its size; with Shift too. And the smallest it is sized to. */
const SIZE_NOTCH = 0.05
const SIZE_FINE = 0.01
const SMALLEST = 0.05
/** How far the pointer may move between down and up and still be a click, px. */
const CLICK = 4
const INK = '#f6ead0'

export interface EditMode {
  readonly on: boolean
  toggle(): void
  /** A frame: the picked piece's box kept round it. */
  frame(): void
}

/** `piece` drawn as its `shown` has it: by its own `lay`, else raised and sized round its place. */
function lay(piece: EditPiece) {
  if (piece.lay) piece.lay()
  else if (piece.shown) layShown(piece.object, piece.shown)
}

/** The pieces drawn raised and sized as the route keeps them: once, as the page loads, edit mode or not. */
export function layPieces(pieces: readonly EditPiece[]) {
  for (const piece of pieces) lay(piece)
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
  /** What a drag runs over: level to move a piece, upright and facing the camera to raise it. */
  const plane = new Plane()
  const up = new Vector3(0, 1, 0)
  const facing = new Vector3()
  const hit = new Vector3()
  let dragging = false
  let raising = false
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
  line.textContent = 'EDIT: click a piece, drag it to move, wheel to turn (Shift: 1°); Alt+drag to raise, Alt+wheel to size, R to put both back. Drag elsewhere to turn the camera.'

  const say = () => {
    if (!picked) {
      status.textContent = 'nothing picked'
      return
    }
    const shown = picked.shown ? `: ${picked.shown.y >= 0 ? '+' : ''}${picked.shown.y.toFixed(2)} m, ${picked.shown.size.toFixed(2)}x` : ' (not raised or sized)'
    status.textContent = `${picked.name}${shown}${picked.turn ? '' : ' (not turned)'}`
  }

  /** The drag over the level plane through `last`, or the upright one facing the camera: `last` where the ray meets it, so the change moves nothing. */
  const dragOver = (rise: boolean) => {
    raising = rise
    if (rise) {
      camera.getWorldDirection(facing).setY(0)
      if (facing.lengthSq() < 1e-6) facing.set(0, 0, 1)
      plane.setFromNormalAndCoplanarPoint(facing.normalize(), last)
    } else plane.setFromNormalAndCoplanarPoint(up, last)
    if (raycaster.ray.intersectPlane(plane, hit)) last.copy(hit)
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
      // Dragged over a level plane at the height it was taken at, or with Alt up and down.
      last = found.point.clone()
      dragOver(event.altKey && found.piece.shown !== undefined)
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
    const rise = event.altKey && picked.shown !== undefined
    if (rise !== raising) dragOver(rise)
    if (!raycaster.ray.intersectPlane(plane, hit)) return
    if (rise && picked.shown) {
      picked.shown.y += hit.y - last.y
      lay(picked)
      say()
    } else picked.move(hit.x - last.x, hit.z - last.z)
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
      if (!on || !picked) return
      const notch = Math.sign(event.deltaY || event.deltaX)
      if (notch === 0) return
      // With Alt, sized: bigger rolled away.
      if (event.altKey && picked.shown) {
        const size = picked.shown.size - notch * (event.shiftKey ? SIZE_FINE : SIZE_NOTCH)
        picked.shown.size = Math.max(SMALLEST, Math.round(size * 100) / 100)
        lay(picked)
        say()
      } else if (!event.altKey && picked.turn) picked.turn((notch * (event.shiftKey ? FINE : NOTCH) * Math.PI) / 180)
      else return
      event.stopImmediatePropagation()
      event.preventDefault()
    },
    { capture: true, passive: false },
  )

  // R: the picked piece drawn where and as big as the play has it again.
  addEventListener('keydown', (event) => {
    if (!on || !picked?.shown || event.code !== 'KeyR' || event.repeat || event.target instanceof HTMLInputElement) return
    picked.shown.y = 0
    picked.shown.size = 1
    lay(picked)
    say()
  })

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
