import { FloatArray } from '../core/BVHNode.js';
export declare function intersectRayBox(box: FloatArray, origins: FloatArray, dirsInv: FloatArray, signs: Uint8Array, near: number, far: number): boolean;
export declare function intersectBoxBox(A: FloatArray, B: FloatArray): boolean;
export declare function intersectSphereBox(center: FloatArray, radius: number, box: FloatArray): boolean;
//# sourceMappingURL=intersectUtils.d.ts.map