// The page's end of the way round the walls, through its own calls only: a
// stand-in for the worker holds what the page sends, and answers when the
// test says, as the worker itself would.
import { describe, expect, it } from 'vitest'
import { FLOW_CELL, FlowField } from './flowfield'
import { RemoteFlowField, serveFlow, type Field, type FlowPort, type ToFlow } from './flowfield-remote'
import { Walls, type Wall } from './walls'

/** A worker that answers only when told to, each holder sent in turn. */
class HeldPort implements FlowPort {
  onmessage: ((event: MessageEvent<Field>) => void) | null = null
  readonly sent: ToFlow[] = []
  private readonly answers: Field[] = []
  private readonly serve = serveFlow((field) => this.answers.push(field))
  postMessage(message: ToFlow): void {
    this.sent.push(message)
    this.serve(message)
  }
  /** The fields worked out so far, as they arrive on the page. */
  answer(): void {
    for (const field of this.answers.splice(0)) this.onmessage?.({ data: field } as MessageEvent<Field>)
  }
  get holders(): ToFlow[] {
    return this.sent.filter((message) => message.type === 'holder')
  }
}

const WALLS: Wall[] = [{ from: { x: -3, z: 2 }, to: { x: 3, z: 2 } }]

describe('RemoteFlowField', () => {
  it('sends nothing on open ground, and is no way round', () => {
    const port = new HeldPort()
    const flow = new RemoteFlowField(port)
    flow.update(0, 0)
    flow.update(5, 5)
    expect(port.holders).toEqual([])
    expect(flow.active).toBe(false)
  })

  it('reads the field the worker works out, as the field itself has it round the same holder and walls', () => {
    const port = new HeldPort()
    const flow = new RemoteFlowField(port)
    flow.setWalls(WALLS)
    flow.update(0.3, -0.4)
    expect(flow.active).toBe(false)
    port.answer()
    const own = new FlowField()
    own.setWalls(new Walls(WALLS))
    own.update(0.3, -0.4)
    expect(flow.active).toBe(true)
    expect(flow.version).toBe(1)
    expect(flow.cornerX).toBe(own.cornerX)
    expect(flow.cornerZ).toBe(own.cornerZ)
    expect(flow.texels).toEqual(own.texels)
  })

  it('sends the holder again only once she has moved half a cell, and one at a time', () => {
    const port = new HeldPort()
    const flow = new RemoteFlowField(port)
    flow.setWalls(WALLS)
    flow.update(0, 0)
    port.answer()
    flow.update(FLOW_CELL * 0.4, 0)
    expect(port.holders).toHaveLength(1)
    flow.update(FLOW_CELL, 0)
    expect(port.holders).toHaveLength(2)
    // Out: she walks on, and is not sent until the field comes back.
    flow.update(FLOW_CELL * 3, 0)
    expect(port.holders).toHaveLength(2)
    port.answer()
    flow.update(FLOW_CELL * 3, 0)
    expect(port.holders.at(-1)).toEqual({ type: 'holder', x: FLOW_CELL * 3, z: 0 })
  })

  it('asks again when the walls change, though she stands still', () => {
    const port = new HeldPort()
    const flow = new RemoteFlowField(port)
    flow.setWalls(WALLS)
    flow.update(0, 0)
    port.answer()
    flow.setWalls([{ from: { x: -3, z: -2 }, to: { x: 3, z: -2 } }])
    flow.update(0, 0)
    expect(port.holders).toHaveLength(2)
    expect(flow.active).toBe(true)
  })

  it('is no way round once the walls are gone, though a field still comes back', () => {
    const port = new HeldPort()
    const flow = new RemoteFlowField(port)
    flow.setWalls(WALLS)
    flow.update(0, 0)
    flow.setWalls([])
    port.answer()
    expect(flow.active).toBe(false)
    expect(flow.version).toBe(0)
  })
})
