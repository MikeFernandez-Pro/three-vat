// The torch's light with a hard edge. three's point light fades out over the
// whole of its distance, so its pool on the floor has no edge to read; this
// one holds its falloff to the edge and cuts off over the last `torchEdge`
// share of its distance, so the circle it lights is seen, and seen shrinking.

import { type Node, PointLight, PointLightNode, type NodeBuilder, type WebGPURenderer } from 'three/webgpu'
import { float, smoothstep, uniform } from 'three/tsl'

/** A point light drawn with a hard edge, once `useTorchLights` has told the renderer of it. */
export class TorchLight extends PointLight {}

/** The share of its distance, the last of it, over which a torch light goes from full to nothing: small for a hard edge. */
export const torchEdge = uniform(0.06)

class TorchLightNode extends PointLightNode {
  override setupDirect(builder: NodeBuilder) {
    // three's types leave these nodes untyped: they are a vec3, two floats and a colour.
    const toLight = this.getLightVector(builder) as Node<'vec3'>
    const cutoff = this.cutoffDistanceNode as Node<'float'>
    const decay = this.decayExponentNode as Node<'float'>
    const color = (this as unknown as { colorNode: Node<'vec3'> }).colorNode
    const distance = toLight.length()
    const falloff = distance.pow(decay).max(0.01).reciprocal()
    const inside = float(1).sub(smoothstep(cutoff.mul(float(1).sub(torchEdge.max(0.001))), cutoff, distance))
    return { lightDirection: toLight.normalize(), lightColor: color.mul(falloff).mul(inside) }
  }
}

/** The renderer draws every `TorchLight` with the hard edge. */
export const useTorchLights = (renderer: WebGPURenderer): void => {
  renderer.library.addLight(TorchLightNode, TorchLight)
}
