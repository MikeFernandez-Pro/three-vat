import { InstancedEntity } from '../InstancedEntity.js';
import { InstancedMesh2 } from '../InstancedMesh2.js';
InstancedMesh2.prototype.clearTempInstance = function (index) {
    const instance = this._tempInstance;
    instance.id = index;
    return this.clearInstance(instance);
};
InstancedMesh2.prototype.clearTempInstancePosition = function (index) {
    const instance = this._tempInstance;
    instance.id = index;
    instance.position.set(0, 0, 0);
    return instance;
};
InstancedMesh2.prototype.clearInstance = function (instance) {
    instance.position.set(0, 0, 0);
    instance.scale.set(1, 1, 1);
    instance.quaternion.identity();
    return instance;
};
InstancedMesh2.prototype.updateInstances = function (onUpdate) {
    const end = this._instancesArrayCount;
    const instances = this.instances;
    for (let i = 0; i < end; i++) {
        if (!this.getActiveAt(i))
            continue;
        const instance = instances ? instances[i] : this.clearTempInstance(i);
        onUpdate(instance, i);
        instance.updateMatrix();
    }
    return this;
};
InstancedMesh2.prototype.updateInstancesPosition = function (onUpdate) {
    const end = this._instancesArrayCount;
    const instances = this.instances;
    for (let i = 0; i < end; i++) {
        if (!this.getActiveAt(i))
            continue;
        const instance = instances ? instances[i] : this.clearTempInstancePosition(i);
        onUpdate(instance, i);
        instance.updateMatrixPosition();
    }
    return this;
};
InstancedMesh2.prototype.createEntities = function (start) {
    const end = this._instancesArrayCount;
    if (!this.instances) {
        this.instances = new Array(end);
    }
    else if (this.instances.length < end) {
        this.instances.length = end;
    }
    else {
        return this;
    }
    // we can also revert this for and put 'break' instead of 'continue' but no it's memory consecutive
    const instances = this.instances;
    for (let i = start; i < end; i++) {
        if (instances[i])
            continue;
        instances[i] = new InstancedEntity(this, i, this._allowsEuler);
    }
    return this;
};
InstancedMesh2.prototype.addInstances = function (count, onCreation) {
    if (!onCreation && this.bvh) {
        console.warn('InstancedMesh2: if `computeBVH()` has already been called, it is better to valorize the instances in the `onCreation` callback for better performance.');
    }
    // refill holes created from removeInstances
    const freeIds = this._freeIds;
    if (freeIds.length > 0) {
        let maxId = -1;
        const freeIdsUsed = Math.min(freeIds.length, count);
        const freeidsEnd = freeIds.length - freeIdsUsed;
        for (let i = freeIds.length - 1; i >= freeidsEnd; i--) {
            const id = freeIds[i];
            if (id > maxId)
                maxId = id;
            this.addInstance(id, onCreation);
        }
        freeIds.length -= freeIdsUsed;
        count -= freeIdsUsed;
        this._instancesArrayCount = Math.max(maxId + 1, this._instancesArrayCount);
    }
    const start = this._instancesArrayCount;
    const end = start + count;
    this.setInstancesArrayCount(end);
    for (let i = start; i < end; i++) {
        this.addInstance(i, onCreation);
    }
    return this;
};
InstancedMesh2.prototype.addInstance = function (id, onCreation) {
    this._instancesCount++;
    this.setActiveAndVisibilityAt(id, true);
    const instance = this.instances ? this.clearInstance(this.instances[id]) : this.clearTempInstance(id);
    if (onCreation) {
        onCreation(instance, id);
        instance.updateMatrix();
    }
    else {
        instance.setMatrixIdentity();
    }
    this.bvh?.insert(id);
};
InstancedMesh2.prototype.removeInstances = function (...ids) {
    const freeIds = this._freeIds;
    const bvh = this.bvh;
    for (const id of ids) {
        if (id < this._instancesArrayCount && this.getActiveAt(id)) {
            this.setActiveAt(id, false);
            freeIds.push(id);
            bvh?.delete(id);
            this._instancesCount--;
        }
    }
    for (let i = this._instancesArrayCount - 1; i >= 0; i--) {
        if (this.getActiveAt(i))
            break;
        this._instancesArrayCount--;
    }
    return this;
};
InstancedMesh2.prototype.clearInstances = function () {
    this._instancesCount = 0;
    this._instancesArrayCount = 0;
    this._freeIds.length = 0;
    this.bvh?.clear();
    if (this.LODinfo) {
        for (const obj of this.LODinfo.objects) {
            obj.count = 0;
        }
    }
    return this;
};
//# sourceMappingURL=Instances.js.map