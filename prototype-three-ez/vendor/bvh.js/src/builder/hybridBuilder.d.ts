import { BVHNode, FloatArray, FloatArrayType } from '../core/BVHNode.js';
import { SortedListPriority } from '../utils/sortedListPriority.js';
import { IBVHBuilder, onLeafCreationCallback } from './IBVHBuilder.js';
export declare class HybridBuilder<N = {}, L = {}> implements IBVHBuilder<N, L> {
    root: BVHNode<N, L>;
    readonly highPrecision: boolean;
    protected _sortedList: SortedListPriority;
    protected _typeArray: FloatArrayType;
    protected count: number;
    constructor(highPrecision?: boolean);
    createFromArray(objects: L[], boxes: FloatArray[], onLeafCreation?: onLeafCreationCallback<N, L>, margin?: number): void;
    insert(object: L, box: FloatArray, margin: number): BVHNode<N, L>;
    insertRange(objects: L[], boxes: FloatArray[], margins?: number | FloatArray | number[], onLeafCreation?: onLeafCreationCallback<N, L>): void;
    move(node: BVHNode<N, L>, margin: number): void;
    delete(node: BVHNode<N, L>): BVHNode<N, L>;
    clear(): void;
    protected insertLeaf(leaf: BVHNode<N, L>, newParent?: BVHNode<N, L>): void;
    protected createLeafNode(object: L, box: FloatArray): BVHNode<N, L>;
    protected createInternalNode(parent: BVHNode<N, L>, sibling: BVHNode<N, L>, leaf: BVHNode<N, L>): BVHNode<N, L>;
    protected findBestSibling(leafBox: FloatArray): BVHNode<N, L>;
    protected refit(node: BVHNode<N, L>): void;
    protected refitAndRotate(node: BVHNode<N, L>, sibling: BVHNode<N, L>): void;
    protected swap(A: BVHNode<N, L>, B: BVHNode<N, L>): void;
}
//# sourceMappingURL=hybridBuilder.d.ts.map