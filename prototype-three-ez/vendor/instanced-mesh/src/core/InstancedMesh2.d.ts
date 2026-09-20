import { BindMode, Box3, BufferGeometry, Camera, Color, ColorRepresentation, DataTexture, Material, Matrix4, Mesh, Object3D, Object3DEventMap, Scene, Skeleton, Sphere, Vector3, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { CustomSortCallback, OnFrustumEnterCallback } from './feature/FrustumCulling.js';
import { Entity } from './feature/Instances.js';
import { LODInfo } from './feature/LOD.js';
import { InstancedEntity } from './InstancedEntity.js';
import { BVHParams, InstancedMeshBVH } from './InstancedMeshBVH.js';
import { GLInstancedBufferAttribute } from './utils/GLInstancedBufferAttribute.js';
import { SquareDataTexture } from './utils/SquareDataTexture.js';
/**
 * Parameters for configuring an `InstancedMesh2` instance.
 */
export interface InstancedMesh2Params {
    /**
     * Determines the maximum number of instances that buffers can hold.
     * The buffers will be expanded automatically if necessary.
     * @default 1000
     */
    capacity?: number;
    /**
     * Determines whether to create an array of `InstancedEntity` to easily manipulate instances at the cost of more memory.
     * @default false
     */
    createEntities?: boolean;
    /**
     * Determines whether `InstancedEntity` can use the `rotation` property.
     * If `true` `quaternion` and `rotation` will be synchronized, affecting performance.
     * @default false
     */
    allowsEuler?: boolean;
    /**
     * WebGL renderer instance.
     * If not provided, buffers will be initialized during the first render, resulting in no instances being rendered initially.
     * @default null
     */
    renderer?: WebGLRenderer;
}
/**
 * Alternative `InstancedMesh` class to support additional features like frustum culling, fast raycasting, LOD and more.
 * @template TData Type for additional instance data.
 * @template TGeometry Type extending `BufferGeometry`.
 * @template TMaterial Type extending `Material` or an array of `Material`.
 * @template TEventMap Type extending `Object3DEventMap`.
 */
export declare class InstancedMesh2<TData = {}, TGeometry extends BufferGeometry = BufferGeometry, TMaterial extends Material | Material[] = Material | Material[], TEventMap extends Object3DEventMap = Object3DEventMap> extends Mesh<TGeometry, TMaterial, TEventMap> {
    /**
     * The number of instances rendered in the last frame.
     */
    count: number;
    /**
     * @defaultValue `InstancedMesh2`
     */
    readonly type = "InstancedMesh2";
    /**
     * Indicates if this is an `InstancedMesh2`.
     */
    readonly isInstancedMesh2 = true;
    /**
     * An array of `Entity` representing individual instances.
     * This array is only initialized if `createEntities` is set to `true` in the constructor parameters.
     */
    instances: Entity<TData>[];
    /**
     * Attribute storing indices of the instances to be rendered.
     */
    instanceIndex: GLInstancedBufferAttribute;
    /**
     * Texture storing matrices for instances.
     */
    matricesTexture: SquareDataTexture;
    /**
     * Texture storing colors for instances.
     */
    colorsTexture: SquareDataTexture;
    /**
     * Texture storing morph target influences for instances.
     */
    morphTexture: DataTexture;
    /**
     * Texture storing bones for instances.
     */
    boneTexture: SquareDataTexture;
    /**
     * Texture storing custom uniforms per instance.
     */
    uniformsTexture: SquareDataTexture;
    /**
     * This bounding box encloses all instances, which can be calculated with `computeBoundingBox` method.
     * Bounding box isn't computed by default. It needs to be explicitly computed, otherwise it's `null`.
     */
    boundingBox: Box3;
    /**
     * This bounding sphere encloses all instances, which can be calculated with `computeBoundingSphere` method.
     * Bounding sphere is computed during its first render. You may need to recompute it if an instance is transformed.
     */
    boundingSphere: Sphere;
    /**
     * BVH structure for optimized culling and intersection testing.
     * It's possible to create the BVH using the `computeBVH` method. Once created it will be updated automatically.
     */
    bvh: InstancedMeshBVH;
    /**
     * Custom sort function for instances.
     * It's possible to create the radix sort using the `createRadixSort` method.
     * @default null
    */
    customSort: CustomSortCallback;
    /**
     * Flag indicating if raycasting should only consider the last frame frustum culled instances.
     * This is ignored if the bvh has been created.
     * @default false
     */
    raycastOnlyFrustum: boolean;
    /**
     * Array storing visibility and availability for instances.
     * [visible0, active0, visible1, active1, ...]
     */
    readonly availabilityArray: boolean[];
    /**
     * Contains data for managing LOD, allowing different levels of detail for rendering and shadow casting.
     */
    LODinfo: LODInfo<TData>;
    /**
     * Flag indicating whether to automatically perform frustum culling before rendering.
     * @default true
     */
    autoUpdate: boolean;
    /**
     * Either `AttachedBindMode` or `DetachedBindMode`. `AttachedBindMode` means the skinned mesh shares the same world space as the skeleton.
     * This is not true when using `DetachedBindMode` which is useful when sharing a skeleton across multiple skinned meshes.
     * @default `AttachedBindMode`
     */
    bindMode: BindMode;
    /**
     * The base matrix that is used for the bound bone transforms.
     */
    bindMatrix: Matrix4;
    /**
     * The base matrix that is used for resetting the bound bone transforms.
     */
    bindMatrixInverse: Matrix4;
    /**
     * Skeleton representing the bone hierarchy of the skinned mesh.
     */
    skeleton: Skeleton;
    /**
     * Flag indicating whether to automatically update the BVH structure (if present).
     * @default true
     */
    autoUpdateBVH: boolean;
    /**
     * Callback function called if an instance is inside the frustum.
     */
    onFrustumEnter: OnFrustumEnterCallback;
    protected readonly _allowsEuler: boolean;
    protected readonly _tempInstance: InstancedEntity;
    protected _currentMaterial: Material;
    protected _customProgramCacheKeyBase: () => string;
    protected _onBeforeCompileBase: (parameters: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;
    protected _definesBase: {
        [key: string]: any;
    };
    protected _freeIds: number[];
    protected _createEntities: boolean;
    /**
     * The capacity of the instance buffers.
     */
    get capacity(): number;
    /**
     * The number of active instances.
     */
    get instancesCount(): number;
    /**
     * Determines if per-instance frustum culling is enabled.
     * @default true
     */
    get perObjectFrustumCulled(): boolean;
    set perObjectFrustumCulled(value: boolean);
    /**
     * Determines if objects should be sorted before rendering.
     * @default false
     */
    get sortObjects(): boolean;
    set sortObjects(value: boolean);
    /**
     * An instance of `BufferGeometry` (or derived classes), defining the object's structure.
     */
    get geometry(): TGeometry;
    set geometry(value: TGeometry);
    constructor(geometry: TGeometry, material: TMaterial, params?: InstancedMesh2Params);
    onBeforeShadow(renderer: WebGLRenderer, scene: Scene, camera: Camera, shadowCamera: Camera, geometry: BufferGeometry, depthMaterial: Material, group: any): void;
    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, material: Material, group: any): void;
    onAfterShadow(renderer: WebGLRenderer, scene: Scene, camera: Camera, shadowCamera: Camera, geometry: BufferGeometry, depthMaterial: Material, group: any): void;
    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, material: Material, group: any): void;
    protected updateTextures(renderer: WebGLRenderer, material: Material): void;
    protected bindTextures(renderer: WebGLRenderer, material: Material): void;
    protected isLastGroup(materialIndex: number): boolean;
    protected initIndexAttribute(): void;
    protected initLastRenderInfo(): void;
    protected initMatricesTexture(): void;
    protected initColorsTexture(): void;
    protected materialsNeedsUpdate(): void;
    protected patchGeometry(geometry: TGeometry): void;
    protected _customProgramCacheKey: () => string;
    protected _onBeforeCompile: (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;
    protected patchMaterial(renderer: WebGLRenderer, material: Material): void;
    protected unpatchMaterial(renderer: WebGLRenderer, material: Material): void;
    /**
     * Creates and computes the BVH (Bounding Volume Hierarchy) for the instances.
     * It's recommended to create it when all the instance matrices have been assigned.
     * Once created it will be updated automatically.
     * @param config Optional configuration parameters object. See `BVHParams` for details.
     */
    computeBVH(config?: BVHParams): void;
    /**
     * Disposes of the BVH structure.
     */
    disposeBVH(): void;
    /**
     * Sets the local transformation matrix for a specific instance.
     * @param id The index of the instance.
     * @param matrix A `Matrix4` representing the local transformation to apply to the instance.
     */
    setMatrixAt(id: number, matrix: Matrix4): void;
    /**
     * Gets the local transformation matrix of a specific instance.
     * @param id The index of the instance.
     * @param matrix Optional `Matrix4` to store the result.
     * @returns The transformation matrix of the instance.
     */
    getMatrixAt(id: number, matrix?: Matrix4): Matrix4;
    /**
     * Retrieves the position of a specific instance.
     * @param index The index of the instance.
     * @param target Optional `Vector3` to store the result.
     * @returns The position of the instance as a `Vector3`.
     */
    getPositionAt(index: number, target?: Vector3): Vector3;
    /**
     * Sets the visibility of a specific instance.
     * @param id The index of the instance.
     * @param visible Whether the instance should be visible.
     */
    setVisibilityAt(id: number, visible: boolean): void;
    /**
     * Gets the visibility of a specific instance.
     * @param id The index of the instance.
     * @returns Whether the instance is visible.
     */
    getVisibilityAt(id: number): boolean;
    /**
     * Sets the availability of a specific instance.
     * @param id The index of the instance.
     * @param active Whether the instance is active (not deleted).
     */
    setActiveAt(id: number, active: boolean): void;
    /**
     * Gets the availability of a specific instance.
     * @param id The index of the instance.
     * @returns Whether the instance is active (not deleted).
     */
    getActiveAt(id: number): boolean;
    /**
     * Indicates if a specific instance is visible and active.
     * @param id The index of the instance.
     * @returns Whether the instance is visible and active.
     */
    getActiveAndVisibilityAt(id: number): boolean;
    /**
     * Set if a specific instance is visible and active.
     * @param id The index of the instance.
     * @param value Whether the instance is active and active (not deleted).
     */
    setActiveAndVisibilityAt(id: number, value: boolean): void;
    /**
     * Sets the color of a specific instance.
     * @param id The index of the instance.
     * @param color The color to assign to the instance.
     */
    setColorAt(id: number, color: ColorRepresentation): void;
    /**
     * Gets the color of a specific instance.
     * @param id The index of the instance.
     * @param color Optional `Color` to store the result.
     * @returns The color of the instance.
     */
    getColorAt(id: number, color?: Color): Color;
    /**
     * Sets the opacity of a specific instance.
     * @param id The index of the instance.
     * @param value The opacity value to assign.
     */
    setOpacityAt(id: number, value: number): void;
    /**
     * Gets the opacity of a specific instance.
     * @param id The index of the instance.
     * @returns The opacity of the instance.
     */
    getOpacityAt(id: number): number;
    /**
     * Copies `position`, `quaternion`, and `scale` of a specific instance to the specified target `Object3D`.
     * @param id The index of the instance.
     * @param target The `Object3D` where to copy transformation data.
     */
    copyTo(id: number, target: Object3D): void;
    /**
     * Computes the bounding box that encloses all instances, and updates the `boundingBox` attribute.
     */
    computeBoundingBox(): void;
    /**
     * Computes the bounding sphere that encloses all instances, and updates the `boundingSphere` attribute.
     */
    computeBoundingSphere(): void;
    clone(recursive?: boolean): this;
    copy(source: InstancedMesh2, recursive?: boolean): this;
    /**
     * Frees the GPU-related resources allocated.
     */
    dispose(): void;
    updateMatrixWorld(force?: boolean): void;
}
//# sourceMappingURL=InstancedMesh2.d.ts.map