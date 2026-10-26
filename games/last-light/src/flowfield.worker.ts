// The way round the walls' thread (see flowfield-remote.ts): keeps the field,
// and answers each holder the page sends with the field round her.
import { serveFlow, type Field, type ToFlow } from './flowfield-remote'

/** The worker's global, typed for what it is used for here: the DOM lib types `self` as a window. */
const scope = self as unknown as {
  postMessage(message: Field, transfer: Transferable[]): void
  onmessage: ((event: MessageEvent<ToFlow>) => void) | null
}

const serve = serveFlow((field, transfer) => scope.postMessage(field, transfer))
scope.onmessage = (event) => serve(event.data)
