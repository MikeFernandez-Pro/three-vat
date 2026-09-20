import { InstancedMesh2 } from '../InstancedMesh2.js';
import { SquareDataTexture } from '../utils/SquareDataTexture.js';
InstancedMesh2.prototype.getUniformAt = function (id, name, target) {
    if (!this.uniformsTexture) {
        throw new Error('Before get/set uniform, it\'s necessary to use "initUniformsPerInstance".');
    }
    return this.uniformsTexture.getUniformAt(id, name, target);
};
InstancedMesh2.prototype.setUniformAt = function (id, name, value) {
    if (!this.uniformsTexture) {
        throw new Error('Before get/set uniform, it\'s necessary to use "initUniformsPerInstance".');
    }
    this.uniformsTexture.setUniformAt(id, name, value);
    this.uniformsTexture.enqueueUpdate(id);
};
InstancedMesh2.prototype.initUniformsPerInstance = function (schema) {
    if (!this._parentLOD) {
        const { channels, pixelsPerInstance, uniformMap, fetchInFragmentShader } = this.getUniformSchemaResult(schema);
        this.uniformsTexture = new SquareDataTexture(Float32Array, channels, pixelsPerInstance, this._capacity, uniformMap, fetchInFragmentShader);
        this.materialsNeedsUpdate();
    }
};
InstancedMesh2.prototype.getUniformSchemaResult = function (schema) {
    let totalSize = 0;
    const uniformMap = new Map();
    const uniforms = [];
    const vertexSchema = schema.vertex ?? {};
    const fragmentSchema = schema.fragment ?? {};
    let fetchInFragmentShader = true;
    for (const name in vertexSchema) {
        const type = vertexSchema[name];
        const size = this.getUniformSize(type);
        totalSize += size;
        uniforms.push({ name, type, size });
        fetchInFragmentShader = false;
    }
    for (const name in fragmentSchema) {
        if (!vertexSchema[name]) {
            const type = fragmentSchema[name];
            const size = this.getUniformSize(type);
            totalSize += size;
            uniforms.push({ name, type, size });
        }
    }
    uniforms.sort((a, b) => b.size - a.size);
    const tempOffset = [];
    for (const { name, size, type } of uniforms) {
        const offset = this.getUniformOffset(size, tempOffset);
        uniformMap.set(name, { offset, size, type });
    }
    const pixelsPerInstance = Math.ceil(totalSize / 4);
    const channels = Math.min(totalSize, 4);
    return { channels, pixelsPerInstance, uniformMap, fetchInFragmentShader };
};
InstancedMesh2.prototype.getUniformOffset = function (size, tempOffset) {
    if (size < 4) {
        for (let i = 0; i < tempOffset.length; i++) {
            if (tempOffset[i] + size <= 4) {
                const offset = i * 4 + tempOffset[i];
                tempOffset[i] += size;
                return offset;
            }
        }
    }
    const offset = tempOffset.length * 4;
    for (; size > 0; size -= 4) {
        tempOffset.push(size);
    }
    return offset;
};
InstancedMesh2.prototype.getUniformSize = function (type) {
    switch (type) {
        case 'float': return 1;
        case 'vec2': return 2;
        case 'vec3': return 3;
        case 'vec4': return 4;
        case 'mat3': return 9;
        case 'mat4': return 16;
        default:
            throw new Error(`Invalid uniform type: ${type}`);
    }
};
//# sourceMappingURL=Uniforms.js.map