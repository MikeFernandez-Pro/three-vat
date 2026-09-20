import { IBVHBuilder, onLeafCreationCallback } from '../builder/IBVHBuilder.js';
import { CoordinateSystem, Frustum } from '../utils/frustum.js';
import { BVHNode, FloatArray } from './BVHNode.js';
export type onTraverseCallback<N, L> = (node: BVHNode<N, L>, depth: number) => boolean;
export type onIntersectionCallback<L> = (obj: L) => boolean;
export type onClosestDistanceCallback<L> = (obj: L) => number;
export type onIntersectionRayCallback<L> = (obj: L) => void;
export type onFrustumIntersectionCallback<N, L> = (node: BVHNode<N, L>, frustum?: Frustum, mask?: number) => void;
export type onFrustumIntersectionLODCallback<N, L> = (node: BVHNode<N, L>, level: number, frustum?: Frustum, mask?: number) => void;
export declare class BVH<N, L> {
    builder: IBVHBuilder<N, L>;
    frustum: Frustum;
    protected _dirInv: FloatArray;
    protected _sign: Uint8Array<ArrayBuffer>;
    get root(): BVHNode<N, L>;
    constructor(builder: IBVHBuilder<N, L>, coordinateSystem?: CoordinateSystem);
    createFromArray(objects: L[], boxes: FloatArray[], onLeafCreation?: onLeafCreationCallback<N, L>, margin?: number): void;
    insert(object: L, box: FloatArray, margin: number): BVHNode<N, L>;
    insertRange(objects: L[], boxes: FloatArray[], margins?: number | FloatArray | number[], onLeafCreation?: onLeafCreationCallback<N, L>): void;
    move(node: BVHNode<N, L>, margin: number): void;
    delete(node: BVHNode<N, L>): BVHNode<N, L>;
    clear(): void;
    traverse(callback: onTraverseCallback<N, L>): void;
    intersectsRay(dir: FloatArray, origin: FloatArray, onIntersection: onIntersectionCallback<L>, near?: number, far?: number): boolean;
    intersectsBox(box: FloatArray, onIntersection: onIntersectionCallback<L>): boolean;
    intersectsSphere(center: FloatArray, radius: number, onIntersection: onIntersectionCallback<L>): boolean;
    isNodeIntersected(node: BVHNode<N, L>, onIntersection: onIntersectionCallback<L>): boolean;
    rayIntersections(dir: FloatArray, origin: FloatArray, onIntersection: onIntersectionRayCallback<L>, near?: number, far?: number): void;
    frustumCulling(projectionMatrix: FloatArray | number[], onIntersection: onFrustumIntersectionCallback<N, L>): void;
    frustumCullingLOD(projectionMatrix: FloatArray | number[], cameraPosition: FloatArray, levels: FloatArray, onIntersection: onFrustumIntersectionLODCallback<N, L>): void;
    closestPointToPoint(point: FloatArray, onClosestDistance?: onClosestDistanceCallback<L>): number;
}
//# sourceMappingURL=BVH.d.ts.map