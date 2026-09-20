import { AttachedBindMode, Box3, Color, ColorManagement, DetachedBindMode, InstancedBufferAttribute, Matrix4, Mesh, Sphere, Vector3 } from 'three';
import { InstancedEntity } from './InstancedEntity.js';
import { InstancedMeshBVH } from './InstancedMeshBVH.js';
import { GLInstancedBufferAttribute } from './utils/GLInstancedBufferAttribute.js';
import { patchProperties, unpatchProperties } from './utils/PropertiesOverride.js';
import { SquareDataTexture } from './utils/SquareDataTexture.js';
/**
 * Alternative `InstancedMesh` class to support additional features like frustum culling, fast raycasting, LOD and more.
 * @template TData Type for additional instance data.
 * @template TGeometry Type extending `BufferGeometry`.
 * @template TMaterial Type extending `Material` or an array of `Material`.
 * @template TEventMap Type extending `Object3DEventMap`.
 */
export class InstancedMesh2 extends Mesh {
    /**
     * The capacity of the instance buffers.
     */
    get capacity() { return this._capacity; }
    /**
     * The number of active instances.
     */
    get instancesCount() { return this._instancesCount; }
    /**
     * Determines if per-instance frustum culling is enabled.
     * @default true
     */
    get perObjectFrustumCulled() { return this._perObjectFrustumCulled; }
    set perObjectFrustumCulled(value) {
        this._perObjectFrustumCulled = value;
        this._indexArrayNeedsUpdate = true;
    }
    /**
     * Determines if objects should be sorted before rendering.
     * @default false
     */
    get sortObjects() { return this._sortObjects; }
    set sortObjects(value) {
        this._sortObjects = value;
        this._indexArrayNeedsUpdate = true;
    }
    /**
     * An instance of `BufferGeometry` (or derived classes), defining the object's structure.
     */
    // @ts-expect-error It's defined as a property, but is overridden as an accessor.
    get geometry() { return this._geometry; }
    set geometry(value) {
        this._geometry = value;
        this.patchGeometry(value);
    }
    /**
     * @remarks Geometry cannot be shared. If reused, it will be cloned.
     * @param geometry An instance of `BufferGeometry`.
     * @param material A single or an array of `Material`.
     * @param params Optional configuration parameters object. See `InstancedMesh2Params` for details.
     */
    constructor(geometry, material, params = {}, LOD) {
        if (!geometry)
            throw new Error('"geometry" is mandatory.');
        if (!material)
            throw new Error('"material" is mandatory.');
        const { allowsEuler, renderer, createEntities } = params;
        super(geometry, null);
        /**
         * @defaultValue `InstancedMesh2`
         */
        this.type = 'InstancedMesh2';
        /**
         * Indicates if this is an `InstancedMesh2`.
         */
        this.isInstancedMesh2 = true;
        /**
         * An array of `Entity` representing individual instances.
         * This array is only initialized if `createEntities` is set to `true` in the constructor parameters.
         */
        this.instances = null;
        /**
         * Attribute storing indices of the instances to be rendered.
         */
        this.instanceIndex = null;
        /**
         * Texture storing colors for instances.
         */
        this.colorsTexture = null;
        /**
         * Texture storing morph target influences for instances.
         */
        this.morphTexture = null;
        /**
         * Texture storing bones for instances.
         */
        this.boneTexture = null;
        /**
         * Texture storing custom uniforms per instance.
         */
        this.uniformsTexture = null;
        /**
         * This bounding box encloses all instances, which can be calculated with `computeBoundingBox` method.
         * Bounding box isn't computed by default. It needs to be explicitly computed, otherwise it's `null`.
         */
        this.boundingBox = null;
        /**
         * This bounding sphere encloses all instances, which can be calculated with `computeBoundingSphere` method.
         * Bounding sphere is computed during its first render. You may need to recompute it if an instance is transformed.
         */
        this.boundingSphere = null;
        /**
         * BVH structure for optimized culling and intersection testing.
         * It's possible to create the BVH using the `computeBVH` method. Once created it will be updated automatically.
         */
        this.bvh = null;
        /**
         * Custom sort function for instances.
         * It's possible to create the radix sort using the `createRadixSort` method.
         * @default null
        */
        this.customSort = null;
        /**
         * Flag indicating if raycasting should only consider the last frame frustum culled instances.
         * This is ignored if the bvh has been created.
         * @default false
         */
        this.raycastOnlyFrustum = false;
        /**
         * Contains data for managing LOD, allowing different levels of detail for rendering and shadow casting.
         */
        this.LODinfo = null;
        /**
         * Flag indicating whether to automatically perform frustum culling before rendering.
         * @default true
         */
        this.autoUpdate = true;
        /**
         * Either `AttachedBindMode` or `DetachedBindMode`. `AttachedBindMode` means the skinned mesh shares the same world space as the skeleton.
         * This is not true when using `DetachedBindMode` which is useful when sharing a skeleton across multiple skinned meshes.
         * @default `AttachedBindMode`
         */
        this.bindMode = AttachedBindMode;
        /**
         * The base matrix that is used for the bound bone transforms.
         */
        this.bindMatrix = null;
        /**
         * The base matrix that is used for resetting the bound bone transforms.
         */
        this.bindMatrixInverse = null;
        /**
         * Skeleton representing the bone hierarchy of the skinned mesh.
         */
        this.skeleton = null;
        /**
         * Flag indicating whether to automatically update the BVH structure (if present).
         * @default true
         */
        this.autoUpdateBVH = true;
        /**
         * Callback function called if an instance is inside the frustum.
         */
        this.onFrustumEnter = null;
        /** @internal */ this._renderer = null;
        /** @internal */ this._instancesCount = 0;
        /** @internal */ this._instancesArrayCount = 0;
        /** @internal */ this._perObjectFrustumCulled = true;
        /** @internal */ this._sortObjects = false;
        /** @internal */ this._indexArrayNeedsUpdate = false;
        /** @internal */ this._useOpacity = false;
        this._currentMaterial = null;
        this._customProgramCacheKeyBase = null;
        this._onBeforeCompileBase = null;
        this._definesBase = null;
        this._freeIds = [];
        // HACK TO MAKE IT WORK WITHOUT UPDATE CORE
        /** @internal */ this.isInstancedMesh = true; // must be set to use instancing rendering
        /** @internal */ this.instanceMatrix = new InstancedBufferAttribute(new Float32Array(0), 16); // must be init to avoid exception
        /** @internal */ this.instanceColor = null; // must be null to avoid exception
        this._customProgramCacheKey = () => {
            return `ez_${!!this.colorsTexture}_${this._useOpacity}_${!!this.boneTexture}_${!!this.uniformsTexture}_${this._customProgramCacheKeyBase.call(this._currentMaterial)}`;
        };
        this._onBeforeCompile = (shader, renderer) => {
            if (this._onBeforeCompileBase)
                this._onBeforeCompileBase.call(this._currentMaterial, shader, renderer);
            shader.defines = { ...shader.defines }; // clone to avoid problem with standard material when used for scene.overrideMaterial
            shader.defines['USE_INSTANCING_INDIRECT'] = '';
            shader.uniforms.matricesTexture = { value: this.matricesTexture };
            if (this.uniformsTexture) {
                shader.uniforms.uniformsTexture = { value: this.uniformsTexture };
                const { vertex, fragment } = this.uniformsTexture.getUniformsGLSL('uniformsTexture', 'instanceIndex', 'uint');
                shader.vertexShader = shader.vertexShader.replace('void main() {', vertex);
                shader.fragmentShader = shader.fragmentShader.replace('void main() {', fragment);
            }
            if (this.colorsTexture && shader.fragmentShader.includes('#include <color_pars_fragment>')) {
                shader.defines['USE_INSTANCING_COLOR_INDIRECT'] = '';
                shader.uniforms.colorsTexture = { value: this.colorsTexture };
                shader.vertexShader = shader.vertexShader.replace('<color_vertex>', '<instanced_color_vertex>');
                if (shader.vertexColors) {
                    shader.defines['USE_VERTEX_COLOR'] = '';
                }
                shader.defines['USE_COLOR_ALPHA'] = '';
            }
            if (this.boneTexture) {
                shader.defines['USE_SKINNING'] = '';
                shader.defines['USE_INSTANCING_SKINNING'] = '';
                shader.uniforms.bindMatrix = { value: this.bindMatrix };
                shader.uniforms.bindMatrixInverse = { value: this.bindMatrixInverse };
                shader.uniforms.bonesPerInstance = { value: this.skeleton.bones.length };
                shader.uniforms.boneTexture = { value: this.boneTexture };
            }
        };
        const capacity = params.capacity > 0 ? params.capacity : _defaultCapacity;
        this._renderer = renderer;
        this._capacity = capacity;
        this._parentLOD = LOD;
        this._geometry = geometry;
        this.material = material;
        this._allowsEuler = allowsEuler ?? false;
        this._tempInstance = new InstancedEntity(this, -1, allowsEuler);
        this.availabilityArray = LOD?.availabilityArray ?? new Array(capacity * 2);
        this._createEntities = createEntities;
        this.initLastRenderInfo();
        this.initIndexAttribute();
        this.initMatricesTexture();
    }
    onBeforeShadow(renderer, scene, camera, shadowCamera, geometry, depthMaterial, group) {
        this.patchMaterial(renderer, depthMaterial);
        this.updateTextures(renderer, depthMaterial);
        const frame = renderer.info.render.frame;
        if (this.instanceIndex && this.autoUpdate && !this.frustumCullingAlreadyPerformed(frame, camera, shadowCamera)) {
            this.performFrustumCulling(shadowCamera, camera);
        }
        if (this.count === 0)
            return;
        this.instanceIndex.update(this._renderer, this.count);
        this.bindTextures(renderer, depthMaterial);
    }
    onBeforeRender(renderer, scene, camera, geometry, material, group) {
        this.patchMaterial(renderer, material);
        this.updateTextures(renderer, material);
        if (!this.instanceIndex) {
            this._renderer = renderer;
            return;
        }
        const frame = renderer.info.render.frame;
        if (this.autoUpdate && !this.frustumCullingAlreadyPerformed(frame, camera, null)) {
            this.performFrustumCulling(camera);
        }
        if (this.count === 0)
            return;
        this.instanceIndex.update(this._renderer, this.count);
        this.bindTextures(renderer, material);
    }
    onAfterShadow(renderer, scene, camera, shadowCamera, geometry, depthMaterial, group) {
        this.unpatchMaterial(renderer, depthMaterial);
    }
    onAfterRender(renderer, scene, camera, geometry, material, group) {
        this.unpatchMaterial(renderer, material);
        if (this.instanceIndex || (group && !this.isLastGroup(group.materialIndex)))
            return;
        this.initIndexAttribute();
    }
    updateTextures(renderer, material) {
        const materialProperties = renderer.properties.get(material);
        this.matricesTexture.update(renderer, materialProperties, 'matricesTexture');
        this.colorsTexture?.update(renderer, materialProperties, 'colorsTexture');
        this.uniformsTexture?.update(renderer, materialProperties, 'uniformsTexture');
        this.boneTexture?.update(renderer, materialProperties, 'boneTexture');
    }
    bindTextures(renderer, material) {
        const materialProperties = renderer.properties.get(material);
        const materialUniforms = materialProperties.uniforms;
        if (!materialUniforms)
            return;
        const currentProgramProperties = materialProperties.currentProgram;
        const currentProgram = currentProgramProperties?.program;
        if (!currentProgram)
            return;
        const gl = renderer.getContext();
        const programUniforms = currentProgramProperties.getUniforms().map;
        const activeProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        renderer.state.useProgram(currentProgram); // set the program
        this.matricesTexture.bindToProgram(renderer, gl, programUniforms, materialUniforms, 'matricesTexture');
        this.colorsTexture?.bindToProgram(renderer, gl, programUniforms, materialUniforms, 'colorsTexture');
        this.uniformsTexture?.bindToProgram(renderer, gl, programUniforms, materialUniforms, 'uniformsTexture');
        this.boneTexture?.bindToProgram(renderer, gl, programUniforms, materialUniforms, 'boneTexture');
        renderer.state.useProgram(activeProgram); // restore the old program to make three.js update uniforms correctly
    }
    isLastGroup(materialIndex) {
        const materials = this.material;
        for (let i = materials.length - 1; i >= materialIndex; i--) {
            if (materials[i].visible) {
                return i === materialIndex;
            }
        }
    }
    initIndexAttribute() {
        if (!this._renderer) {
            this.count = 0;
            return;
        }
        const gl = this._renderer.getContext();
        const capacity = this._capacity;
        const array = new Uint32Array(capacity);
        for (let i = 0; i < capacity; i++) {
            array[i] = i;
        }
        this.instanceIndex = new GLInstancedBufferAttribute(gl, gl.UNSIGNED_INT, 1, 4, array);
        this._geometry.setAttribute('instanceIndex', this.instanceIndex);
    }
    initLastRenderInfo() {
        if (!this._parentLOD) {
            this._lastRenderInfo = { frame: -1, camera: null, shadowCamera: null };
        }
    }
    initMatricesTexture() {
        if (!this._parentLOD) {
            this.matricesTexture = new SquareDataTexture(Float32Array, 4, 4, this._capacity);
        }
    }
    initColorsTexture() {
        if (!this._parentLOD) {
            this.colorsTexture = new SquareDataTexture(Float32Array, 4, 1, this._capacity);
            this.colorsTexture.colorSpace = ColorManagement.workingColorSpace;
            this.colorsTexture._data.fill(1);
            this.materialsNeedsUpdate();
        }
    }
    materialsNeedsUpdate() {
        if (this.material.isMaterial) {
            this.material.needsUpdate = true;
            return;
        }
        for (const material of this.material) {
            material.needsUpdate = true;
        }
    }
    patchGeometry(geometry) {
        const instanceIndex = geometry.getAttribute('instanceIndex'); // TODO fix d.ts
        if (instanceIndex) {
            if (instanceIndex === this.instanceIndex)
                return;
            console.warn('The geometry has been cloned because it was already used.');
            geometry = geometry.clone();
            geometry.deleteAttribute('instanceIndex'); // TODO rename it it ez_instancedIndex
        }
        if (this.instanceIndex) {
            geometry.setAttribute('instanceIndex', this.instanceIndex); // TODO fix d.ts
        }
    }
    patchMaterial(renderer, material) {
        this._currentMaterial = material;
        this._customProgramCacheKeyBase = material.customProgramCacheKey; // avoid .bind(material); to prevent memory leak
        this._onBeforeCompileBase = material.onBeforeCompile;
        this._definesBase = material.defines;
        material.customProgramCacheKey = this._customProgramCacheKey;
        material.onBeforeCompile = this._onBeforeCompile;
        patchProperties(this, renderer, material);
    }
    unpatchMaterial(renderer, material) {
        this._currentMaterial = null;
        unpatchProperties(renderer);
        material.defines = this._definesBase;
        material.onBeforeCompile = this._onBeforeCompileBase;
        material.customProgramCacheKey = this._customProgramCacheKeyBase;
        this._onBeforeCompileBase = null;
        this._customProgramCacheKeyBase = null;
        this._definesBase = null;
    }
    /**
     * Creates and computes the BVH (Bounding Volume Hierarchy) for the instances.
     * It's recommended to create it when all the instance matrices have been assigned.
     * Once created it will be updated automatically.
     * @param config Optional configuration parameters object. See `BVHParams` for details.
     */
    computeBVH(config = {}) {
        if (!this.bvh)
            this.bvh = new InstancedMeshBVH(this, config.margin, config.getBBoxFromBSphere, config.accurateCulling);
        this.bvh.clear();
        this.bvh.create();
    }
    /**
     * Disposes of the BVH structure.
     */
    disposeBVH() {
        this.bvh = null;
    }
    /**
     * Sets the local transformation matrix for a specific instance.
     * @param id The index of the instance.
     * @param matrix A `Matrix4` representing the local transformation to apply to the instance.
     */
    setMatrixAt(id, matrix) {
        matrix.toArray(this.matricesTexture._data, id * 16);
        if (this.instances) {
            const instance = this.instances[id];
            matrix.decompose(instance.position, instance.quaternion, instance.scale);
        }
        this.matricesTexture.enqueueUpdate(id);
        if (this.bvh && this.autoUpdateBVH) {
            this.bvh.move(id);
        }
    }
    /**
     * Gets the local transformation matrix of a specific instance.
     * @param id The index of the instance.
     * @param matrix Optional `Matrix4` to store the result.
     * @returns The transformation matrix of the instance.
     */
    getMatrixAt(id, matrix = _tempMat4) {
        return matrix.fromArray(this.matricesTexture._data, id * 16);
    }
    /**
     * Retrieves the position of a specific instance.
     * @param index The index of the instance.
     * @param target Optional `Vector3` to store the result.
     * @returns The position of the instance as a `Vector3`.
     */
    getPositionAt(index, target = _position) {
        const offset = index * 16;
        const array = this.matricesTexture._data;
        target.x = array[offset + 12];
        target.y = array[offset + 13];
        target.z = array[offset + 14];
        return target;
    }
    /** @internal */
    getPositionAndMaxScaleOnAxisAt(index, position) {
        const offset = index * 16;
        const array = this.matricesTexture._data;
        const te0 = array[offset + 0];
        const te1 = array[offset + 1];
        const te2 = array[offset + 2];
        const scaleXSq = te0 * te0 + te1 * te1 + te2 * te2;
        const te4 = array[offset + 4];
        const te5 = array[offset + 5];
        const te6 = array[offset + 6];
        const scaleYSq = te4 * te4 + te5 * te5 + te6 * te6;
        const te8 = array[offset + 8];
        const te9 = array[offset + 9];
        const te10 = array[offset + 10];
        const scaleZSq = te8 * te8 + te9 * te9 + te10 * te10;
        position.x = array[offset + 12];
        position.y = array[offset + 13];
        position.z = array[offset + 14];
        return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
    }
    /** @internal */
    applyMatrixAtToSphere(index, sphere, center, radius) {
        const offset = index * 16;
        const array = this.matricesTexture._data;
        const te0 = array[offset + 0];
        const te1 = array[offset + 1];
        const te2 = array[offset + 2];
        const te3 = array[offset + 3];
        const te4 = array[offset + 4];
        const te5 = array[offset + 5];
        const te6 = array[offset + 6];
        const te7 = array[offset + 7];
        const te8 = array[offset + 8];
        const te9 = array[offset + 9];
        const te10 = array[offset + 10];
        const te11 = array[offset + 11];
        const te12 = array[offset + 12];
        const te13 = array[offset + 13];
        const te14 = array[offset + 14];
        const te15 = array[offset + 15];
        const position = sphere.center;
        const x = center.x;
        const y = center.y;
        const z = center.z;
        const w = 1 / (te3 * x + te7 * y + te11 * z + te15);
        position.x = (te0 * x + te4 * y + te8 * z + te12) * w;
        position.y = (te1 * x + te5 * y + te9 * z + te13) * w;
        position.z = (te2 * x + te6 * y + te10 * z + te14) * w;
        const scaleXSq = te0 * te0 + te1 * te1 + te2 * te2;
        const scaleYSq = te4 * te4 + te5 * te5 + te6 * te6;
        const scaleZSq = te8 * te8 + te9 * te9 + te10 * te10;
        sphere.radius = radius * Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
    }
    /**
     * Sets the visibility of a specific instance.
     * @param id The index of the instance.
     * @param visible Whether the instance should be visible.
     */
    setVisibilityAt(id, visible) {
        this.availabilityArray[id * 2] = visible;
        this._indexArrayNeedsUpdate = true;
    }
    /**
     * Gets the visibility of a specific instance.
     * @param id The index of the instance.
     * @returns Whether the instance is visible.
     */
    getVisibilityAt(id) {
        return this.availabilityArray[id * 2];
    }
    /**
     * Sets the availability of a specific instance.
     * @param id The index of the instance.
     * @param active Whether the instance is active (not deleted).
     */
    setActiveAt(id, active) {
        this.availabilityArray[id * 2 + 1] = active;
        this._indexArrayNeedsUpdate = true;
    }
    /**
     * Gets the availability of a specific instance.
     * @param id The index of the instance.
     * @returns Whether the instance is active (not deleted).
     */
    getActiveAt(id) {
        return this.availabilityArray[id * 2 + 1];
    }
    /**
     * Indicates if a specific instance is visible and active.
     * @param id The index of the instance.
     * @returns Whether the instance is visible and active.
     */
    getActiveAndVisibilityAt(id) {
        const offset = id * 2;
        const availabilityArray = this.availabilityArray;
        return availabilityArray[offset] && availabilityArray[offset + 1];
    }
    /**
     * Set if a specific instance is visible and active.
     * @param id The index of the instance.
     * @param value Whether the instance is active and active (not deleted).
     */
    setActiveAndVisibilityAt(id, value) {
        const offset = id * 2;
        const availabilityArray = this.availabilityArray;
        availabilityArray[offset] = value;
        availabilityArray[offset + 1] = value;
        this._indexArrayNeedsUpdate = true;
    }
    /**
     * Sets the color of a specific instance.
     * @param id The index of the instance.
     * @param color The color to assign to the instance.
     */
    setColorAt(id, color) {
        if (this.colorsTexture === null) {
            this.initColorsTexture();
        }
        if (color.isColor) {
            color.toArray(this.colorsTexture._data, id * 4);
        }
        else {
            _tempCol.set(color).toArray(this.colorsTexture._data, id * 4);
        }
        this.colorsTexture.enqueueUpdate(id);
    }
    /**
     * Gets the color of a specific instance.
     * @param id The index of the instance.
     * @param color Optional `Color` to store the result.
     * @returns The color of the instance.
     */
    getColorAt(id, color = _tempCol) {
        return color.fromArray(this.colorsTexture._data, id * 4);
    }
    /**
     * Sets the opacity of a specific instance.
     * @param id The index of the instance.
     * @param value The opacity value to assign.
     */
    setOpacityAt(id, value) {
        if (!this._useOpacity) {
            if (this.colorsTexture === null) {
                this.initColorsTexture();
            }
            else {
                this.materialsNeedsUpdate();
            }
            this._useOpacity = true;
        }
        this.colorsTexture._data[id * 4 + 3] = value;
        this.colorsTexture.enqueueUpdate(id);
    }
    /**
     * Gets the opacity of a specific instance.
     * @param id The index of the instance.
     * @returns The opacity of the instance.
     */
    getOpacityAt(id) {
        if (!this._useOpacity)
            return 1;
        return this.colorsTexture._data[id * 4 + 3];
    }
    /**
     * Copies `position`, `quaternion`, and `scale` of a specific instance to the specified target `Object3D`.
     * @param id The index of the instance.
     * @param target The `Object3D` where to copy transformation data.
     */
    copyTo(id, target) {
        this.getMatrixAt(id, target.matrix).decompose(target.position, target.quaternion, target.scale);
    }
    /**
     * Computes the bounding box that encloses all instances, and updates the `boundingBox` attribute.
     */
    computeBoundingBox() {
        const geometry = this._geometry;
        const count = this._instancesArrayCount;
        this.boundingBox ?? (this.boundingBox = new Box3());
        if (geometry.boundingBox === null)
            geometry.computeBoundingBox();
        const geoBoundingBox = geometry.boundingBox;
        const boundingBox = this.boundingBox;
        boundingBox.makeEmpty();
        for (let i = 0; i < count; i++) {
            if (!this.getActiveAt(i))
                continue;
            _box3.copy(geoBoundingBox).applyMatrix4(this.getMatrixAt(i));
            boundingBox.union(_box3);
        }
    }
    /**
     * Computes the bounding sphere that encloses all instances, and updates the `boundingSphere` attribute.
     */
    computeBoundingSphere() {
        const geometry = this._geometry;
        const count = this._instancesArrayCount;
        this.boundingSphere ?? (this.boundingSphere = new Sphere());
        if (geometry.boundingSphere === null)
            geometry.computeBoundingSphere();
        const geoBoundingSphere = geometry.boundingSphere;
        const boundingSphere = this.boundingSphere;
        boundingSphere.makeEmpty();
        for (let i = 0; i < count; i++) {
            if (!this.getActiveAt(i))
                continue;
            _sphere.copy(geoBoundingSphere).applyMatrix4(this.getMatrixAt(i));
            boundingSphere.union(_sphere);
        }
    }
    clone(recursive) {
        const params = {
            capacity: this._capacity,
            renderer: this._renderer,
            allowsEuler: this._allowsEuler,
            createEntities: this._createEntities
        };
        return new this.constructor(this.geometry, this.material, params).copy(this, recursive);
    }
    copy(source, recursive) {
        super.copy(source, recursive);
        this.count = source._capacity;
        this._instancesCount = source._instancesCount;
        this._instancesArrayCount = source._instancesArrayCount;
        this._capacity = source._capacity;
        if (source.boundingBox !== null)
            this.boundingBox = source.boundingBox.clone();
        if (source.boundingSphere !== null)
            this.boundingSphere = source.boundingSphere.clone();
        this.matricesTexture = source.matricesTexture.clone(); // TODO we can avoid cloning it because it already exists
        this.matricesTexture.image.data = this.matricesTexture.image.data.slice();
        if (source.colorsTexture !== null) {
            this.colorsTexture = source.colorsTexture.clone();
            this.colorsTexture.image.data = this.colorsTexture.image.data.slice();
        }
        if (source.uniformsTexture !== null) {
            this.uniformsTexture = source.uniformsTexture.clone();
            this.uniformsTexture.image.data = this.uniformsTexture.image.data.slice();
        }
        if (source.morphTexture !== null) {
            this.morphTexture = source.morphTexture.clone();
            this.morphTexture.image.data = this.morphTexture.image.data.slice();
        }
        if (source.boneTexture !== null) {
            this.boneTexture = source.boneTexture.clone();
            this.boneTexture.image.data = this.boneTexture.image.data.slice(); // TODO check if they fix d.ts
        }
        // TODO copies and handle LOD?
        return this;
    }
    /**
     * Frees the GPU-related resources allocated.
     */
    dispose() {
        this.dispatchEvent({ type: 'dispose' });
        this.matricesTexture.dispose();
        this.colorsTexture?.dispose();
        this.morphTexture?.dispose();
        this.boneTexture?.dispose();
        this.uniformsTexture?.dispose();
    }
    updateMatrixWorld(force) {
        super.updateMatrixWorld(force);
        if (!this.bindMatrixInverse)
            return;
        if (this.bindMode === AttachedBindMode) {
            this.bindMatrixInverse.copy(this.matrixWorld).invert();
        }
        else if (this.bindMode === DetachedBindMode) {
            this.bindMatrixInverse.copy(this.bindMatrix).invert();
        }
        else {
            console.warn('Unrecognized bindMode: ' + this.bindMode);
        }
    }
}
const _defaultCapacity = 1000;
const _box3 = new Box3();
const _sphere = new Sphere();
const _tempMat4 = new Matrix4();
const _tempCol = new Color();
const _position = new Vector3();
//# sourceMappingURL=InstancedMesh2.js.map