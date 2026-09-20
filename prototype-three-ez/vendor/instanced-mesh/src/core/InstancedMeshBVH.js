import { box3ToArray, BVH, HybridBuilder, vec3ToArray, WebGLCoordinateSystem } from 'bvh.js';
import { Box3 } from 'three';
/**
 * Class to manage BVH (Bounding Volume Hierarchy) for `InstancedMesh2`.
 * Provides methods for managing bounding volumes, frustum culling, raycasting, and bounding box computation.
 */
export class InstancedMeshBVH {
    /**
     * @param target The target `InstancedMesh2`.
     * @param margin The margin applied for bounding box calculations (default is 0).
     * @param getBBoxFromBSphere Flag to determine if instance bounding boxes should be computed from the geometry bounding sphere. Faster but less precise (default is false).
     * @param accurateCulling Flag to enable accurate frustum culling without considering margin (default is true).
     */
    constructor(target, margin = 0, getBBoxFromBSphere = false, accurateCulling = true) {
        /**
         * A map that stores the BVH nodes for each instance.
         */
        this.nodesMap = new Map();
        this.LODsMap = new Map();
        this._geoBoundingSphere = null;
        this._sphereTarget = null;
        this.target = target;
        this.accurateCulling = accurateCulling;
        this._margin = margin;
        const geometry = target._geometry;
        if (!geometry.boundingBox)
            geometry.computeBoundingBox();
        this.geoBoundingBox = geometry.boundingBox;
        if (getBBoxFromBSphere) {
            if (!geometry.boundingSphere)
                geometry.computeBoundingSphere();
            const center = geometry.boundingSphere.center;
            if (center.x === 0 && center.y === 0 && center.z === 0) {
                this._geoBoundingSphere = geometry.boundingSphere;
                this._sphereTarget = { centerX: 0, centerY: 0, centerZ: 0, maxScale: 0 };
            }
            else {
                console.warn('"getBoxFromSphere" is ignored because geometry is not centered.');
                getBBoxFromBSphere = false;
            }
        }
        this.bvh = new BVH(new HybridBuilder(), WebGLCoordinateSystem);
        this._origin = new Float32Array(3);
        this._dir = new Float32Array(3);
        this._cameraPos = new Float32Array(3);
        this._getBoxFromSphere = getBBoxFromBSphere;
    }
    /**
     * Builds the BVH from the target mesh's instances using a top-down construction method.
     * This approach is more efficient and accurate compared to incremental methods, which add one instance at a time.
     */
    create() {
        const count = this.target._instancesCount;
        const instancesArrayCount = this.target._instancesArrayCount;
        const boxes = new Array(count); // test if single array and recreation inside node creation is faster due to memory location
        const objects = new Uint32Array(count);
        let index = 0;
        this.clear();
        for (let i = 0; i < instancesArrayCount; i++) {
            if (!this.target.getActiveAt(i))
                continue;
            boxes[index] = this.getBox(i, new Float32Array(6));
            objects[index] = i;
            index++;
        }
        this.bvh.createFromArray(objects, boxes, (node) => {
            this.nodesMap.set(node.object, node);
        }, this._margin);
    }
    /**
     * Inserts an instance into the BVH.
     * @param id The id of the instance to insert.
     */
    insert(id) {
        const node = this.bvh.insert(id, this.getBox(id, new Float32Array(6)), this._margin);
        this.nodesMap.set(id, node);
    }
    /**
     * Inserts a range of instances into the BVH.
     * @param ids An array of ids to insert.
     */
    insertRange(ids) {
        const count = ids.length;
        const boxes = new Array(count);
        for (let i = 0; i < count; i++) {
            boxes[i] = this.getBox(ids[i], new Float32Array(6));
        }
        this.bvh.insertRange(ids, boxes, this._margin, (node) => {
            this.nodesMap.set(node.object, node);
        });
    }
    /**
     * Moves an instance within the BVH.
     * @param id The id of the instance to move.
     */
    move(id) {
        const node = this.nodesMap.get(id);
        if (!node)
            return;
        this.getBox(id, node.box); // this also updates box
        this.bvh.move(node, this._margin);
    }
    /**
     * Deletes an instance from the BVH.
     * @param id The id of the instance to delete.
     */
    delete(id) {
        const node = this.nodesMap.get(id);
        if (!node)
            return;
        this.bvh.delete(node);
        this.nodesMap.delete(id);
    }
    /**
     * Clears the BVH.
     */
    clear() {
        this.bvh.clear();
        this.nodesMap.clear();
    }
    /**
     * Performs frustum culling to determine which instances are visible based on the provided projection matrix.
     * @param projScreenMatrix The projection screen matrix for frustum culling.
     * @param onFrustumIntersection Callback function invoked when an instance intersects the frustum.
     */
    frustumCulling(projScreenMatrix, onFrustumIntersection) {
        if (this._margin > 0 && this.accurateCulling) {
            this.bvh.frustumCulling(projScreenMatrix.elements, (node, frustum, mask) => {
                if (frustum.isIntersectedMargin(node.box, mask, this._margin)) {
                    onFrustumIntersection(node);
                }
            });
        }
        else {
            this.bvh.frustumCulling(projScreenMatrix.elements, onFrustumIntersection);
        }
    }
    /**
     * Performs frustum culling with Level of Detail (LOD) consideration.
     * @param projScreenMatrix The projection screen matrix for frustum culling.
     * @param cameraPosition The camera's position used for LOD calculations.
     * @param levels An array of LOD levels.
     * @param onFrustumIntersection Callback function invoked when an instance intersects the frustum.
     */
    frustumCullingLOD(projScreenMatrix, cameraPosition, levels, onFrustumIntersection) {
        if (!this.LODsMap.has(levels)) {
            this.LODsMap.set(levels, new Float32Array(levels.length));
        }
        const levelsArray = this.LODsMap.get(levels);
        for (let i = 0; i < levels.length; i++) {
            levelsArray[i] = levels[i].distance;
        }
        const camera = this._cameraPos;
        camera[0] = cameraPosition.x;
        camera[1] = cameraPosition.y;
        camera[2] = cameraPosition.z;
        if (this._margin > 0 && this.accurateCulling) {
            this.bvh.frustumCullingLOD(projScreenMatrix.elements, camera, levelsArray, (node, level, frustum, mask) => {
                if (frustum.isIntersectedMargin(node.box, mask, this._margin)) {
                    onFrustumIntersection(node, level);
                }
            });
        }
        else {
            this.bvh.frustumCullingLOD(projScreenMatrix.elements, camera, levelsArray, onFrustumIntersection);
        }
    }
    /**
     * Performs raycasting to check if a ray intersects any instances.
     * @param raycaster The raycaster used for raycasting.
     * @param onIntersection Callback function invoked when a ray intersects an instance.
     */
    raycast(raycaster, onIntersection) {
        const ray = raycaster.ray;
        const origin = this._origin;
        const dir = this._dir;
        vec3ToArray(ray.origin, origin);
        vec3ToArray(ray.direction, dir);
        // TODO should we add margin check? maybe is not worth it
        this.bvh.rayIntersections(dir, origin, onIntersection, raycaster.near, raycaster.far);
    }
    /**
     * Checks if a given box intersects with any instance bounding box.
     * @param target The target bounding box.
     * @param onIntersection Callback function invoked when an intersection occurs.
     * @returns `True` if there is an intersection, otherwise `false`.
     */
    intersectBox(target, onIntersection) {
        if (!this._boxArray)
            this._boxArray = new Float32Array(6);
        const array = this._boxArray;
        box3ToArray(target, array);
        return this.bvh.intersectsBox(array, onIntersection);
    }
    getBox(id, array) {
        if (this._getBoxFromSphere) {
            const matrixArray = this.target.matricesTexture._data;
            const { centerX, centerY, centerZ, maxScale } = this.getSphereFromMatrix_centeredGeometry(id, matrixArray, this._sphereTarget);
            const radius = this._geoBoundingSphere.radius * maxScale;
            array[0] = centerX - radius;
            array[1] = centerX + radius;
            array[2] = centerY - radius;
            array[3] = centerY + radius;
            array[4] = centerZ - radius;
            array[5] = centerZ + radius;
        }
        else {
            _box3.copy(this.geoBoundingBox).applyMatrix4(this.target.getMatrixAt(id));
            box3ToArray(_box3, array);
        }
        return array;
    }
    getSphereFromMatrix_centeredGeometry(id, array, target) {
        const offset = id * 16;
        const m0 = array[offset + 0];
        const m1 = array[offset + 1];
        const m2 = array[offset + 2];
        const m4 = array[offset + 4];
        const m5 = array[offset + 5];
        const m6 = array[offset + 6];
        const m8 = array[offset + 8];
        const m9 = array[offset + 9];
        const m10 = array[offset + 10];
        const scaleXSq = m0 * m0 + m1 * m1 + m2 * m2;
        const scaleYSq = m4 * m4 + m5 * m5 + m6 * m6;
        const scaleZSq = m8 * m8 + m9 * m9 + m10 * m10;
        target.maxScale = Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
        target.centerX = array[offset + 12];
        target.centerY = array[offset + 13];
        target.centerZ = array[offset + 14];
        return target;
    }
}
const _box3 = new Box3();
//# sourceMappingURL=InstancedMeshBVH.js.map