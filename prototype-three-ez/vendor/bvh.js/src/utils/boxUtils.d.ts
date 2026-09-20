import { FloatArray } from '../core/BVHNode.js';
export declare function unionBox(A: FloatArray, B: FloatArray, target: FloatArray): void;
export declare function unionBoxChanged(A: FloatArray, B: FloatArray, target: FloatArray): boolean;
export declare function isBoxInsideBox(innerBox: FloatArray, outerBox: FloatArray): boolean;
export declare function isExpanded(A: FloatArray, target: FloatArray): boolean;
export declare function expandBox(A: FloatArray, target: FloatArray): void;
export declare function expandBoxByMargin(target: FloatArray, margin: number): void;
export declare function areaBox(box: FloatArray): number;
export declare function areaFromTwoBoxes(A: FloatArray, B: FloatArray): number;
export declare function getLongestAxis(box: FloatArray): number;
export declare function minDistanceSqPointToBox(box: FloatArray, point: FloatArray): number;
export declare function minDistancePointToBox(box: FloatArray, point: FloatArray): number;
export declare function minMaxDistanceSqPointToBox(box: FloatArray, point: FloatArray): {
    min: number;
    max: number;
};
export declare function minMaxDistancePointToBox(box: FloatArray, point: FloatArray): {
    min: number;
    max: number;
};
//# sourceMappingURL=boxUtils.d.ts.map