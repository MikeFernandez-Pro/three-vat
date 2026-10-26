// The way round the walls (flowfield.ts), worked out on a thread of its own
// for the GPU step (gpuswarm.ts), whose page would otherwise pay for it: the
// field is worked out again each time the holder moves half a cell, some
// fourteen times a second as she walks, at 2 ms a time on a fast machine and
// 10 on a slow one. The CPU step works its own out in the swarm's worker.
//
// The page sends the level's walls when they change and the holder when she
// has moved half a cell, one holder at a time: while the field is being
// worked out, she is sent again only once it has come back. So the field the
// step reads lags her by a frame or two, which is nothing to walls that stand
// still. Where there are no workers, under Node, it is worked out in the same
// thread, as the worker would.
import { FLOW_SIZE, FlowField, MOVED } from './flowfield'
import { Walls, type Wall } from './walls'

export interface SetWalls {
  type: 'walls'
  walls: readonly Wall[]
}
export interface MoveHolder {
  type: 'holder'
  x: number
  z: number
}
export type ToFlow = SetWalls | MoveHolder

/** The field worked out round the holder last sent, as `FlowField` holds it. */
export interface Field {
  type: 'field'
  texels: Float32Array
  cornerX: number
  cornerZ: number
}

/** The worker's end of the wire, as the page holds it: a `Worker`, or a stand-in under test. */
export interface FlowPort {
  postMessage(message: ToFlow, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<Field>) => void) | null
  terminate?(): void
}

/** The worker's side: a field kept, its walls set and each holder answered with the field round her, posted by `post`. */
export function serveFlow(post: (field: Field, transfer: Transferable[]) => void): (message: ToFlow) => void {
  const flow = new FlowField()
  return (message) => {
    if (message.type === 'walls') {
      flow.setWalls(new Walls(message.walls))
      return
    }
    flow.update(message.x, message.z)
    const texels = flow.texels.slice()
    post({ type: 'field', texels, cornerX: flow.cornerX, cornerZ: flow.cornerZ }, [texels.buffer])
  }
}

/** The field's own thread, started; or, with no workers, a stand-in that answers in this one. */
function spawnPort(): FlowPort {
  if (typeof Worker !== 'undefined') return new Worker(new URL('./flowfield.worker.ts', import.meta.url), { type: 'module' })
  const port: FlowPort = {
    onmessage: null,
    postMessage: (message) => serve(message),
  }
  const serve = serveFlow((field) => port.onmessage?.({ data: field } as MessageEvent<Field>))
  return port
}

/** The page's end: the field the step reads, as `FlowField` holds it, worked out elsewhere. */
export class RemoteFlowField {
  /** Each cell's (way x, way z, how far or -1 where no rat goes, 1 where the holder is in clear sight or 0), row by row from the square's corner. */
  readonly texels = new Float32Array(FLOW_SIZE * FLOW_SIZE * 4)
  /** The square's corner, m. */
  cornerX = 0
  cornerZ = 0
  /** Counts up each time a field comes back: a texture of it that finds it unchanged needs no upload. */
  version = 0

  private walled = false
  /** Whether a field has come back since the level last had no walls. */
  private got = false
  /** Whether a holder is out, its field not yet back. */
  private out = false
  private sentX = Number.NaN
  private sentZ = Number.NaN

  constructor(private readonly port: FlowPort = spawnPort()) {
    port.onmessage = (event) => this.take(event.data)
  }

  /** Whether there are walls, and a field round them to read: until one comes back, every rat's straight line is its way. */
  get active(): boolean {
    return this.walled && this.got
  }

  /** The level's walls as they now stand: the field round the holder is asked for again at the next update. */
  setWalls(walls: readonly Wall[]): void {
    this.walled = walls.length > 0
    if (!this.walled) this.got = false
    this.port.postMessage({ type: 'walls', walls })
    this.sentX = this.sentZ = Number.NaN
  }

  /** The holder at (x, z): sent, if she has moved half a cell since she was last sent and no field is out. */
  update(x: number, z: number): void {
    if (!this.walled || this.out) return
    if (Math.abs(x - this.sentX) < MOVED && Math.abs(z - this.sentZ) < MOVED) return
    this.sentX = x
    this.sentZ = z
    this.out = true
    this.port.postMessage({ type: 'holder', x, z })
  }

  /** The thread stopped. */
  dispose(): void {
    this.port.terminate?.()
  }

  private take(field: Field): void {
    this.out = false
    if (!this.walled) return
    this.texels.set(field.texels)
    this.cornerX = field.cornerX
    this.cornerZ = field.cornerZ
    this.got = true
    this.version++
  }
}
