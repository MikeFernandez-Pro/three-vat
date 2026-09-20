import { ShaderMaterial } from 'three';
import { InstancedMesh2 } from '../InstancedMesh2.js';
InstancedMesh2.prototype.getObjectLODIndexForDistance = function (levels, distance) {
    for (let i = levels.length - 1; i > 0; i--) {
        const level = levels[i];
        const levelDistance = level.distance - (level.distance * level.hysteresis);
        if (distance >= levelDistance)
            return i;
    }
    return 0;
};
InstancedMesh2.prototype.setFirstLODDistance = function (distance) {
    if (this._parentLOD) {
        throw new Error('Cannot create LOD for this InstancedMesh2.');
    }
    if (!this.LODinfo) {
        this.LODinfo = { render: null, shadowRender: null, objects: [this] };
    }
    if (!this.LODinfo.render) {
        this.LODinfo.render = {
            levels: [{ distance, hysteresis: 0, object: this }], // hysteresis is always 0 at first level
            count: [0]
        };
    }
    return this;
};
InstancedMesh2.prototype.addLOD = function (geometry, material, distance = 0, hysteresis = 0) {
    if (this._parentLOD) {
        throw new Error('Cannot create LOD for this InstancedMesh2.');
    }
    if (!this.LODinfo?.render && distance === 0) {
        throw new Error('Cannot set distance to 0 for the first LOD. Call "setFirstLODDistance" method before use "addLOD".');
    }
    this.setFirstLODDistance(0);
    this.addLevel(this.LODinfo.render, geometry, material, distance, hysteresis);
    return this;
};
InstancedMesh2.prototype.addShadowLOD = function (geometry, distance = 0, hysteresis = 0) {
    if (this._parentLOD) {
        throw new Error('Cannot create LOD for this InstancedMesh2.');
    }
    if (!this.LODinfo) {
        this.LODinfo = { render: null, shadowRender: null, objects: [this] };
    }
    if (!this.LODinfo.shadowRender) {
        this.LODinfo.shadowRender = { levels: [], count: [] };
    }
    const object = this.addLevel(this.LODinfo.shadowRender, geometry, null, distance, hysteresis);
    object.castShadow = true;
    this.castShadow = true;
    return this;
};
InstancedMesh2.prototype.addLevel = function (renderList, geometry, material, distance, hysteresis) {
    const objectsList = this.LODinfo.objects;
    const levels = renderList.levels;
    let index;
    let object;
    distance = distance ** 2; // to avoid to use Math.sqrt every time
    const objIndex = objectsList.findIndex((e) => e.geometry === geometry);
    if (objIndex === -1) {
        const params = { capacity: this._capacity, renderer: this._renderer };
        object = new InstancedMesh2(geometry, material ?? new ShaderMaterial(), params, this);
        object.frustumCulled = false;
        this.patchLevel(object);
        objectsList.push(object);
        this.add(object);
    }
    else {
        object = objectsList[objIndex];
        if (material)
            object.material = material;
    }
    for (index = 0; index < levels.length; index++) {
        if (distance < levels[index].distance)
            break;
    }
    levels.splice(index, 0, { distance, hysteresis, object });
    renderList.count.push(0);
    return object;
};
InstancedMesh2.prototype.updateLevel = function (renderList, levelIndex, distance, hysteresis) {
    if (!renderList)
        throw new Error('Render list is invalid.');
    const level = renderList.levels[levelIndex];
    if (!level)
        throw new Error('Cannot update an empty LOD.');
    if (distance != null && !Number.isNaN(distance)) {
        const d2 = distance ** 2;
        level.distance = d2;
    }
    if (hysteresis != null && !Number.isNaN(hysteresis))
        level.hysteresis = hysteresis;
    return this;
};
InstancedMesh2.prototype.updateLOD = function (levelIndex, distance, hysteresis) {
    const list = this?.LODinfo?.render;
    if (levelIndex === 0)
        throw new Error('Cannot change distance for LOD0. It is the main mesh and must stay at 0.'); // If user try to change first lod
    return this.updateLevel(list, levelIndex, distance, hysteresis);
};
InstancedMesh2.prototype.updateShadowLOD = function (levelIndex, distance, hysteresis) {
    return this.updateLevel(this.LODinfo?.shadowRender, levelIndex, distance, hysteresis);
};
InstancedMesh2.prototype.updateAllLevels = function (renderList, distances, hysteresis) {
    if (!renderList?.levels)
        throw new Error('Invalid LOD list.');
    const levels = renderList.levels;
    const isRender = this.LODinfo?.render === renderList;
    const start = isRender ? 1 : 0; // for shadowLOD
    if (isRender)
        levels[0].distance = 0;
    const hasDistances = distances?.length > 0;
    let _distances = [];
    if (hasDistances) { // Only when distances provided
        _distances = (isRender && distances[0] === 0) // If user give 0 for first distance, handle this w/o throw error
            ? distances.slice(1, Math.min(levels.length, distances.length))
            : distances.slice(0, Math.min(levels.length - start, distances.length));
        // Validate
        _distances.every((_d, i) => {
            if (i > 0 && _d <= _distances[i - 1])
                throw new Error(`LOD distances must be strictly increasing: d[${i - 1}]=${_distances[i - 1]} < d[${i}]=${_d}`);
            return true;
        });
    }
    // apply: if no distances, update only hysteresis for all levels
    const total = hasDistances ? _distances.length : (levels.length - start);
    for (let i = 0; i < total; i++) {
        const _d = hasDistances ? _distances[i] : undefined;
        const _h = Array.isArray(hysteresis) ? hysteresis[i] : hysteresis;
        this.updateLevel(renderList, start + i, _d, _h);
    }
    return this;
};
InstancedMesh2.prototype.updateAllLOD = function (distances, hysteresis) {
    return this.updateAllLevels(this.LODinfo?.render, distances, hysteresis);
};
InstancedMesh2.prototype.updateAllShadowLOD = function (distances, hysteresis) {
    return this.updateAllLevels(this.LODinfo?.shadowRender, distances, hysteresis);
};
InstancedMesh2.prototype.disposeLOD = function (object) {
    object.geometry.dispose();
    const mat = object.material;
    if (Array.isArray(mat))
        for (const m of mat)
            m.dispose();
    else
        mat.dispose();
};
InstancedMesh2.prototype.removeLOD = function (levelIndex, removeObject = true) {
    const info = this.LODinfo;
    const list = info?.render;
    if (!list?.levels)
        throw new Error('Invalid LOD list.');
    const n = list.levels.length;
    if (levelIndex < 0 || levelIndex >= n)
        throw new Error('Level index OOB');
    if (n > 1 && levelIndex === 0)
        throw new Error('Cannot remove LOD0 while others exist');
    // Remove whole list if only LOD0 remains
    const [removed] = list.levels.splice(levelIndex, 1);
    list.count?.splice?.(levelIndex, 1);
    if (list.levels.length <= 1)
        info.render = null;
    const obj = removed.object;
    // Mirror remove on shadow list if that index exists
    const shadow = this.LODinfo?.shadowRender;
    if (shadow?.levels && levelIndex < shadow.levels.length) {
        shadow.levels.splice(levelIndex, 1);
        shadow.count?.splice?.(levelIndex, 1);
        if (shadow.levels.length === 0)
            this.LODinfo.shadowRender = null;
    }
    // Remove LOD object
    if (removeObject && obj !== this) {
        try {
            this.remove(obj);
            const idx = info.objects?.indexOf(obj) ?? -1;
            if (idx !== -1)
                info.objects.splice(idx, 1);
            this.disposeLOD(obj);
        }
        catch (e) {
            console.error(e);
        }
    }
    return this;
};
InstancedMesh2.prototype.patchLevel = function (obj) {
    Object.defineProperty(obj, 'renderOrder', {
        get() {
            return this._parentLOD.renderOrder; // TODO reduce overdraw with renderOrder
        }
    });
    Object.defineProperty(obj, '_lastRenderInfo', {
        get() {
            return this._parentLOD._lastRenderInfo;
        }
    });
    Object.defineProperty(obj, 'matricesTexture', {
        get() {
            return this._parentLOD.matricesTexture;
        }
    });
    Object.defineProperty(obj, 'colorsTexture', {
        get() {
            return this._parentLOD.colorsTexture;
        }
    });
    Object.defineProperty(obj, 'uniformsTexture', {
        get() {
            return this._parentLOD.uniformsTexture;
        }
    });
    Object.defineProperty(obj, 'morphTexture', {
        get() {
            return this._parentLOD.morphTexture;
        }
    });
    Object.defineProperty(obj, 'boneTexture', {
        get() {
            return this._parentLOD.boneTexture;
        }
    });
    Object.defineProperty(obj, 'skeleton', {
        get() {
            return this._parentLOD.skeleton;
        }
    });
    Object.defineProperty(obj, 'bindMatrixInverse', {
        get() {
            return this._parentLOD.bindMatrixInverse;
        }
    });
    Object.defineProperty(obj, 'bindMatrix', {
        get() {
            return this._parentLOD.bindMatrix;
        }
    });
};
//# sourceMappingURL=LOD.js.map