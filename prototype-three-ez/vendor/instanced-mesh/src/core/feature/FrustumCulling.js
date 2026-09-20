import { Frustum, Matrix4, Sphere, Vector3 } from 'three';
import { sortOpaque, sortTransparent } from '../../utils/SortingUtils.js';
import { InstancedMesh2 } from '../InstancedMesh2.js';
import { InstancedRenderList } from '../utils/InstancedRenderList.js';
const _frustum = new Frustum();
const _renderList = new InstancedRenderList();
const _projScreenMatrix = new Matrix4();
const _invMatrixWorld = new Matrix4();
const _forward = new Vector3();
const _cameraPos = new Vector3();
const _cameraLODPos = new Vector3();
const _position = new Vector3();
const _sphere = new Sphere();
InstancedMesh2.prototype.performFrustumCulling = function (camera, cameraLOD = camera) {
    const mainMesh = this._parentLOD ?? this;
    const LODinfo = mainMesh.LODinfo;
    let LODrenderList;
    if (LODinfo) {
        const isShadowRendering = camera !== cameraLOD;
        LODrenderList = !isShadowRendering ? LODinfo.render : (LODinfo.shadowRender ?? LODinfo.render);
        for (const object of LODinfo.objects) {
            object.count = 0;
        }
    }
    else if (mainMesh._perObjectFrustumCulled || mainMesh._sortObjects) {
        mainMesh.count = 0;
    }
    if (mainMesh._instancesArrayCount === 0)
        return;
    if (LODrenderList?.levels.length > 0)
        mainMesh.frustumCullingLOD(LODrenderList, camera, cameraLOD);
    else
        mainMesh.frustumCulling(camera);
};
InstancedMesh2.prototype.updateLastRenderInfo = function (frame, camera, shadowCamera) {
    const lastRenderInfo = this._lastRenderInfo;
    lastRenderInfo.frame = frame;
    lastRenderInfo.camera = camera;
    lastRenderInfo.shadowCamera = shadowCamera;
};
InstancedMesh2.prototype.frustumCullingAlreadyPerformed = function (frame, camera, shadowCamera) {
    const lastRenderInfo = this._lastRenderInfo;
    if (lastRenderInfo.frame === frame && lastRenderInfo.camera === camera && lastRenderInfo.shadowCamera === shadowCamera) {
        return true;
    }
    this.updateLastRenderInfo(frame, camera, shadowCamera);
    return false;
};
InstancedMesh2.prototype.frustumCulling = function (camera) {
    const sortObjects = this._sortObjects;
    const perObjectFrustumCulled = this._perObjectFrustumCulled;
    const array = this.instanceIndex.array;
    this.instanceIndex._needsUpdate = true; // TODO improve
    if (!perObjectFrustumCulled && !sortObjects) {
        this.updateIndexArray();
        return;
    }
    if (sortObjects) {
        _invMatrixWorld.copy(this.matrixWorld).invert();
        _cameraPos.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_invMatrixWorld);
        _forward.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(_invMatrixWorld);
    }
    if (!perObjectFrustumCulled) {
        this.updateRenderList();
    }
    else {
        _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
        if (this.bvh)
            this.BVHCulling(camera);
        else
            this.linearCulling(camera);
    }
    if (sortObjects) {
        const customSort = this.customSort;
        if (customSort === null) {
            _renderList.array.sort(!this.material?.transparent ? sortOpaque : sortTransparent);
        }
        else {
            customSort(_renderList.array);
        }
        const list = _renderList.array;
        const count = list.length;
        for (let i = 0; i < count; i++) {
            array[i] = list[i].index;
        }
        this.count = count;
        _renderList.reset();
    }
};
InstancedMesh2.prototype.updateIndexArray = function () {
    if (!this._indexArrayNeedsUpdate)
        return;
    const array = this.instanceIndex.array;
    const instancesArrayCount = this._instancesArrayCount;
    let count = 0;
    for (let i = 0; i < instancesArrayCount; i++) {
        if (this.getActiveAndVisibilityAt(i)) {
            array[count++] = i;
        }
    }
    this.count = count;
    this._indexArrayNeedsUpdate = false;
};
InstancedMesh2.prototype.updateRenderList = function () {
    const instancesArrayCount = this._instancesArrayCount;
    for (let i = 0; i < instancesArrayCount; i++) {
        if (this.getActiveAndVisibilityAt(i)) {
            const depth = this.getPositionAt(i).sub(_cameraPos).dot(_forward);
            _renderList.push(depth, i);
        }
    }
};
InstancedMesh2.prototype.BVHCulling = function (camera) {
    const array = this.instanceIndex.array;
    const instancesArrayCount = this._instancesArrayCount;
    const sortObjects = this._sortObjects;
    const onFrustumEnter = this.onFrustumEnter;
    let count = 0;
    this.bvh.frustumCulling(_projScreenMatrix, (node) => {
        const index = node.object;
        // TODO check if (index < instancesArrayCount) is still necessary after last update
        // we don't check if active because we remove inactive instances from BVH
        if (index < instancesArrayCount && this.getVisibilityAt(index) && (!onFrustumEnter || onFrustumEnter(index, camera))) {
            if (sortObjects) {
                const depth = this.getPositionAt(index).sub(_cameraPos).dot(_forward);
                _renderList.push(depth, index);
            }
            else {
                array[count++] = index;
            }
        }
    });
    this.count = count;
};
InstancedMesh2.prototype.linearCulling = function (camera) {
    const array = this.instanceIndex.array;
    if (!this.geometry.boundingSphere)
        this.geometry.computeBoundingSphere();
    const bSphere = this._geometry.boundingSphere;
    const radius = bSphere.radius;
    const center = bSphere.center;
    const instancesArrayCount = this._instancesArrayCount;
    const geometryCentered = center.x === 0 && center.y === 0 && center.z === 0;
    const sortObjects = this._sortObjects;
    const onFrustumEnter = this.onFrustumEnter;
    let count = 0;
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    for (let i = 0; i < instancesArrayCount; i++) {
        if (!this.getActiveAndVisibilityAt(i))
            continue;
        if (geometryCentered) {
            const maxScale = this.getPositionAndMaxScaleOnAxisAt(i, _sphere.center);
            _sphere.radius = radius * maxScale;
        }
        else {
            this.applyMatrixAtToSphere(i, _sphere, center, radius);
        }
        if (_frustum.intersectsSphere(_sphere) && (!onFrustumEnter || onFrustumEnter(i, camera))) {
            if (sortObjects) {
                const depth = _position.subVectors(_sphere.center, _cameraPos).dot(_forward);
                _renderList.push(depth, i);
            }
            else {
                array[count++] = i;
            }
        }
    }
    this.count = count;
};
InstancedMesh2.prototype.frustumCullingLOD = function (LODrenderList, camera, cameraLOD) {
    const { count, levels } = LODrenderList;
    for (let i = 0; i < levels.length; i++) {
        if (!levels[i].object.instanceIndex)
            return;
        count[i] = 0;
        levels[i].object.instanceIndex._needsUpdate = true; // TODO improve
    }
    const isShadowRendering = camera !== cameraLOD;
    const sortObjects = !isShadowRendering && this._sortObjects; // sort is disabled when render shadows
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    _invMatrixWorld.copy(this.matrixWorld).invert();
    _cameraPos.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_invMatrixWorld);
    _cameraLODPos.setFromMatrixPosition(cameraLOD.matrixWorld).applyMatrix4(_invMatrixWorld);
    const indexes = LODrenderList.levels.map((x) => x.object.instanceIndex.array);
    if (this.bvh)
        this.BVHCullingLOD(LODrenderList, indexes, sortObjects, camera, cameraLOD);
    else
        this.linearCullingLOD(LODrenderList, indexes, sortObjects, camera, cameraLOD);
    if (sortObjects) {
        const customSort = this.customSort;
        const list = _renderList.array;
        let levelIndex = 0;
        let levelDistance = levels[1].distance;
        if (customSort === null) {
            list.sort(!levels[0].object.material?.transparent ? sortOpaque : sortTransparent); // TODO improve multimaterial handling
        }
        else {
            customSort(list);
        }
        for (let i = 0, l = list.length; i < l; i++) {
            const item = list[i];
            if (item.depth > levelDistance) {
                levelIndex++;
                levelDistance = levels[levelIndex + 1]?.distance ?? Infinity; // improve this condition and use for of instead
            }
            indexes[levelIndex][count[levelIndex]++] = item.index;
        }
        _renderList.reset();
    }
    for (let i = 0; i < levels.length; i++) {
        const object = levels[i].object;
        object.count = count[i];
    }
};
InstancedMesh2.prototype.BVHCullingLOD = function (LODrenderList, indexes, sortObjects, camera, cameraLOD) {
    const { count, levels } = LODrenderList;
    const instancesArrayCount = this._instancesArrayCount;
    const onFrustumEnter = this.onFrustumEnter;
    if (sortObjects) {
        this.bvh.frustumCulling(_projScreenMatrix, (node) => {
            const index = node.object;
            // we don't check if active because we remove inactive instances from BVH
            if (index < instancesArrayCount && this.getVisibilityAt(index) && (!onFrustumEnter || onFrustumEnter(index, camera, cameraLOD))) {
                const distance = this.getPositionAt(index).distanceToSquared(_cameraLODPos);
                _renderList.push(distance, index);
            }
        });
    }
    else {
        this.bvh.frustumCullingLOD(_projScreenMatrix, _cameraLODPos, levels, (node, level) => {
            const index = node.object;
            if (index < instancesArrayCount && this.getVisibilityAt(index)) {
                if (level === null) {
                    const distance = this.getPositionAt(index).distanceToSquared(_cameraLODPos); // distance can be get by BVH, but is not the distance from center
                    level = this.getObjectLODIndexForDistance(levels, distance);
                }
                if (!onFrustumEnter || onFrustumEnter(index, camera, cameraLOD, level)) {
                    indexes[level][count[level]++] = index;
                }
            }
        });
    }
};
InstancedMesh2.prototype.linearCullingLOD = function (LODrenderList, indexes, sortObjects, camera, cameraLOD) {
    const { count, levels } = LODrenderList;
    if (!this.geometry.boundingSphere)
        this.geometry.computeBoundingSphere();
    const bSphere = this._geometry.boundingSphere;
    const radius = bSphere.radius;
    const center = bSphere.center;
    const instancesArrayCount = this._instancesArrayCount;
    const geometryCentered = center.x === 0 && center.y === 0 && center.z === 0;
    const onFrustumEnter = this.onFrustumEnter;
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    for (let i = 0; i < instancesArrayCount; i++) {
        if (!this.getActiveAndVisibilityAt(i))
            continue;
        if (geometryCentered) {
            const maxScale = this.getPositionAndMaxScaleOnAxisAt(i, _sphere.center);
            _sphere.radius = radius * maxScale;
        }
        else {
            this.applyMatrixAtToSphere(i, _sphere, center, radius);
        }
        if (_frustum.intersectsSphere(_sphere)) {
            if (sortObjects) {
                if (!onFrustumEnter || onFrustumEnter(i, camera, cameraLOD)) {
                    const distance = _sphere.center.distanceToSquared(_cameraLODPos);
                    _renderList.push(distance, i);
                }
            }
            else {
                const distance = _sphere.center.distanceToSquared(_cameraLODPos);
                const levelIndex = this.getObjectLODIndexForDistance(levels, distance);
                if (!onFrustumEnter || onFrustumEnter(i, camera, cameraLOD, levelIndex)) {
                    indexes[levelIndex][count[levelIndex]++] = i;
                }
            }
        }
    }
};
//# sourceMappingURL=FrustumCulling.js.map