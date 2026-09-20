import { areaBox } from './boxUtils.js';
export class BVHInspector {
    constructor(bvh) {
        this.totalNodes = 0;
        this.totalLeafNodes = 0;
        this.surfaceScore = 0;
        this.areaProportion = 0;
        this.minDepth = Infinity;
        this.maxDepth = 0;
        this.memory = 0; // TODO
        this._bvh = bvh;
        this.update();
    }
    update() {
        this.reset();
        this.getNodeData(this._bvh.root, 0);
        this.areaProportion = this.surfaceScore / areaBox(this._bvh.root.box);
    }
    reset() {
        this.totalNodes = 0;
        this.totalLeafNodes = 0;
        this.surfaceScore = 0;
        this.areaProportion = 0;
        this.minDepth = Infinity;
        this.maxDepth = 0;
        this.memory = 0;
    }
    getNodeData(node, depth) {
        this.totalNodes++;
        const area = areaBox(node.box);
        this.surfaceScore += area;
        if (node.object !== undefined) {
            this.totalLeafNodes++;
            if (depth < this.minDepth)
                this.minDepth = depth;
            if (depth > this.maxDepth)
                this.maxDepth = depth;
            return;
        }
        depth++;
        this.getNodeData(node.left, depth);
        this.getNodeData(node.right, depth);
    }
}
//# sourceMappingURL=inspector.js.map