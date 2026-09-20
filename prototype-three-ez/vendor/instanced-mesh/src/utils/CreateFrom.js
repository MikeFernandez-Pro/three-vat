import { InstancedMesh2 } from '../core/InstancedMesh2.js';
/**
 * Create an `InstancedMesh2` instance from an existing `Mesh` or `InstancedMesh`.
 * @param mesh The `Mesh` or `InstancedMesh` to create an `InstanceMesh2` from.
 * @param params  Optional configuration parameters object. See `InstancedMesh2Params` for details.
 * @returns The created `InstancedMesh2` instance.
 */
export function createInstancedMesh2From(mesh, params = {}) {
    if (mesh.isSkinnedMesh)
        return createFromSkinnedMesh(mesh);
    if (mesh.isInstancedMesh)
        return createFromInstancedMesh(mesh);
    // TODO add morph support
    return new InstancedMesh2(mesh.geometry, mesh.material, params);
    function createFromSkinnedMesh(mesh) {
        const instancedMesh = new InstancedMesh2(mesh.geometry.clone(), mesh.material, params);
        instancedMesh.initSkeleton(mesh.skeleton);
        return instancedMesh;
    }
    function createFromInstancedMesh(mesh) {
        params.capacity = Math.max(mesh.count, params.capacity);
        const geometry = mesh.geometry.clone();
        geometry.deleteAttribute('instanceIndex');
        warnIfInstancedAttribute();
        const instancedMesh = new InstancedMesh2(geometry, mesh.material, params);
        instancedMesh.position.copy(mesh.position);
        instancedMesh.quaternion.copy(mesh.quaternion);
        instancedMesh.scale.copy(mesh.scale);
        copyInstances();
        copyMatrices();
        copyColors();
        // TODO copy morph target?
        return instancedMesh;
        function copyInstances() {
            instancedMesh.setInstancesArrayCount(mesh.count);
            instancedMesh._instancesCount = mesh.count;
            instancedMesh.availabilityArray.fill(true, 0, mesh.count * 2);
        }
        function copyMatrices() {
            instancedMesh.matricesTexture.image.data.set(mesh.instanceMatrix.array);
        }
        function copyColors() {
            if (mesh.instanceColor) {
                instancedMesh.initColorsTexture();
                const rgbArray = mesh.instanceColor.array;
                const rgbaArray = instancedMesh.colorsTexture.image.data;
                for (let i = 0, j = 0; i < rgbArray.length; i += 3, j += 4) {
                    rgbaArray[j] = rgbArray[i];
                    rgbaArray[j + 1] = rgbArray[i + 1];
                    rgbaArray[j + 2] = rgbArray[i + 2];
                    rgbaArray[j + 3] = 1;
                }
            }
        }
        function warnIfInstancedAttribute() {
            const attributes = geometry.attributes;
            for (const name in attributes) {
                if (attributes[name].isInstancedBufferAttribute) {
                    console.warn(`InstancedBufferAttribute "${name}" is not supported. It will be ignored.`);
                }
            }
        }
    }
}
//# sourceMappingURL=CreateFrom.js.map