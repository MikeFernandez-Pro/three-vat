import { FloatArray } from '../core/BVHNode.js';
export declare const WebGLCoordinateSystem = 0;
export declare const WebGPUCoordinateSystem = 1;
export type CoordinateSystem = typeof WebGLCoordinateSystem | typeof WebGPUCoordinateSystem;
export declare class Frustum {
    array: FloatArray;
    coordinateSystem: CoordinateSystem;
    constructor(highPrecision: boolean, coordinateSystem: CoordinateSystem);
    setFromProjectionMatrix(mat: FloatArray | number[]): this;
    protected updatePlane(index: number, x: number, y: number, z: number, constant: number): void;
    isIntersectedMargin(box: FloatArray, mask: number, margin: number): boolean;
}
//# sourceMappingURL=frustum.d.ts.map