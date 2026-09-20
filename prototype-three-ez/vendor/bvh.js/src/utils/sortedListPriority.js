export class SortedListPriority {
    constructor() {
        this.array = [];
    }
    clear() {
        this.array = [];
    }
    push(node) {
        const array = this.array;
        const cost = node.inheritedCost;
        const end = array.length > 6 ? array.length - 6 : 0;
        let i;
        for (i = array.length - 1; i >= end; i--) {
            if (cost <= array[i].inheritedCost)
                break;
        }
        if (i > array.length - 7)
            array.splice(i + 1, 0, node); // if in last 6 place, add it do the list
    }
    pop() {
        return this.array.pop();
    }
}
//# sourceMappingURL=sortedListPriority.js.map