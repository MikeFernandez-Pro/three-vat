type ItemListType = {
    node: any;
    inheritedCost: number;
};
export declare class SortedListDesc {
    array: ItemListType[];
    clear(): void;
    push(node: ItemListType): void;
    pop(): ItemListType;
    binarySearch(score: number): number;
}
export {};
//# sourceMappingURL=sortedListDesc.d.ts.map