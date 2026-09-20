import { BVH } from '../core/BVH.js';
import { BVHNode } from '../core/BVHNode.js';
export declare class BVHInspector {
    totalNodes: number;
    totalLeafNodes: number;
    surfaceScore: number;
    areaProportion: number;
    minDepth: number;
    maxDepth: number;
    memory: number;
    protected _bvh: BVH<{}, {}>;
    constructor(bvh: BVH<{}, {}>);
    update(): void;
    protected reset(): void;
    protected getNodeData(node: BVHNode<{}, {}>, depth: number): void;
}
//# sourceMappingURL=inspector.d.ts.map