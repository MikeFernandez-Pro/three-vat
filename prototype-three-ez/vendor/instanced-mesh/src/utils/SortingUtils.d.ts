import { InstancedMesh2 } from '../core/InstancedMesh2.js';
import { InstancedRenderItem } from '../core/utils/InstancedRenderList.js';
type radixSortCallback = (list: InstancedRenderItem[]) => void;
/**
 * Creates a radix sort function specifically for sorting `InstancedMesh2` instances.
 * The sorting is based on the `depth` property of each `InstancedRenderItem`.
 * This function dynamically adjusts for transparent materials by reversing the sort order if necessary.
 * @param target The `InstancedMesh2` instance that contains the instances to be sorted.
 * @returns A radix sort function.
 */
export declare function createRadixSort(target: InstancedMesh2): radixSortCallback;
export {};
//# sourceMappingURL=SortingUtils.d.ts.map