/**
 * A class that creates and manages a list of render items, used to determine the rendering order based on depth.
 */
export class InstancedRenderList {
    constructor() {
        /**
         * The main array that holds the list of render items for instanced rendering.
         */
        this.array = [];
        this.pool = [];
    }
    /**
     * Adds a new render item to the list.
     * @param depth The depth value used for sorting or determining the rendering order.
     * @param index The unique instance id of the render item.
     */
    push(depth, index) {
        const pool = this.pool;
        const list = this.array;
        const count = list.length;
        if (count >= pool.length) {
            pool.push({ depth: null, index: null, depthSort: null });
        }
        const item = pool[count];
        item.depth = depth;
        item.index = index;
        list.push(item);
    }
    /**
     * Resets the render list by clearing the array.
     */
    reset() {
        this.array.length = 0;
    }
}
//# sourceMappingURL=InstancedRenderList.js.map