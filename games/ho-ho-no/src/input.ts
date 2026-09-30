// The player's hands, read into the plain state the simulation steps on: WASD
// or the arrows to move, the cursor to aim, the left button or Space to throw.
// The simulation never sees an event; this is the only module that does.
import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three'
import { AIM_HEIGHT, type SimulationInput } from './simulation/simulation'

type Direction = 'forward' | 'backward' | 'left' | 'right'

const KEYS: Record<string, Direction> = {
  ArrowUp: 'forward',
  ArrowDown: 'backward',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'forward',
  KeyS: 'backward',
  KeyA: 'left',
  KeyD: 'right',
}

export class Input {
  private readonly held: Record<Direction, boolean> = { forward: false, backward: false, left: false, right: false }
  private readonly pointer = new Vector2()
  private mouseDown = false
  private spaceDown = false
  /** A throw pressed since the last sample, held or not: a tap between two frames still throws. */
  private pressed = false

  private readonly raycaster = new Raycaster()
  /** Aiming is done on a plane at the muzzle's height, so the throw passes under the cursor. */
  private readonly aimPlane = new Plane(new Vector3(0, 1, 0), -AIM_HEIGHT)
  private readonly aimPoint = new Vector3()

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKey)
    target.addEventListener('keyup', this.onKey)
    target.addEventListener('mousedown', this.onMouseDown)
    target.addEventListener('mouseup', this.onMouseUp)
    target.addEventListener('mousemove', this.onMouseMove)
    target.addEventListener('blur', this.onBlur)
  }

  /** This frame's input, aimed through `camera`. */
  sample(camera: Camera): SimulationInput {
    const { forward, backward, left, right } = this.held
    this.raycaster.setFromCamera(this.pointer, camera)
    const aim = this.raycaster.ray.intersectPlane(this.aimPlane, this.aimPoint)
    const fire = this.mouseDown || this.spaceDown || this.pressed
    this.pressed = false
    return {
      move: { x: Number(right) - Number(left), z: Number(backward) - Number(forward) },
      aim: aim ? { x: aim.x, y: aim.y, z: aim.z } : null,
      fire,
    }
  }

  private readonly onKey = (event: KeyboardEvent) => {
    const down = event.type === 'keydown'
    // Space on a focused button presses it: the game-over screen's Play Again,
    // or the credits' Close.
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
    if (event.code === 'Space') {
      // Space throws exactly as the button does; the page must not scroll.
      event.preventDefault()
      if (down && !event.repeat) {
        this.spaceDown = true
        this.pressed = true
      } else if (!down) {
        this.spaceDown = false
      }
      return
    }
    const direction = KEYS[event.code]
    if (direction) this.held[direction] = down
  }

  private readonly onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return
    this.aimAt(event)
    this.mouseDown = true
    this.pressed = true
  }

  private readonly onMouseUp = (event: MouseEvent) => {
    if (event.button === 0) this.mouseDown = false
  }

  private readonly onMouseMove = (event: MouseEvent) => this.aimAt(event)

  /** A key released while the window is away never reaches it: let go of everything. */
  private readonly onBlur = () => {
    this.mouseDown = false
    this.spaceDown = false
    for (const direction of Object.keys(this.held) as Direction[]) this.held[direction] = false
  }

  private aimAt(event: MouseEvent): void {
    this.pointer.set((event.clientX / this.target.innerWidth) * 2 - 1, -(event.clientY / this.target.innerHeight) * 2 + 1)
  }
}
