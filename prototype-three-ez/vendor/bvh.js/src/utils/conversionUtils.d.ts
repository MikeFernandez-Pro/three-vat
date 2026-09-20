import { FloatArray } from '../core/BVHNode.js';
export interface Vector3 {
    x: number;
    y: number;
    z: number;
}
export interface Box3 {
    min: Vector3;
    max: Vector3;
}
export declare function vec3ToArray(vector: Vector3, target: FloatArray): FloatArray;
export declare function box3ToArray(box: Box3, target: FloatArray): FloatArray;
//# sourceMappingURL=conversionUtils.d.ts.map