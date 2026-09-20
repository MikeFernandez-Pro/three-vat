export class SortedListDesc {
    constructor() {
        this.array = [];
    }
    clear() {
        this.array = [];
    }
    push(node) {
        const index = this.binarySearch(node.inheritedCost);
        this.array.splice(index, 0, node);
    }
    pop() {
        return this.array.pop();
    }
    binarySearch(score) {
        const array = this.array;
        let low = 0, high = array.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (array[mid].inheritedCost > score)
                low = mid + 1;
            else
                high = mid;
        }
        return low;
    }
}
//# sourceMappingURL=sortedListDesc.js.map