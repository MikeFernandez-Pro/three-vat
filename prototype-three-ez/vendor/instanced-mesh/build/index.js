import { Quaternion as Ot, Vector3 as T, Euler as Ft, Box3 as ot, GLBufferAttribute as Et, DataTexture as at, WebGLUtils as Pt, ColorManagement as Z, NoColorSpace as ft, FloatType as ct, UnsignedIntType as Rt, IntType as Nt, RGBAFormat as zt, RGBAIntegerFormat as jt, RGFormat as $t, RGIntegerFormat as Gt, RedFormat as ht, RedIntegerFormat as qt, Sphere as nt, Matrix4 as z, Color as Vt, Mesh as ut, AttachedBindMode as dt, InstancedBufferAttribute as Wt, DetachedBindMode as kt, Frustum as Kt, ShaderMaterial as Yt, Ray as Ht, ShaderChunk as _ } from "three";
import { BVH as Xt, HybridBuilder as Zt, WebGLCoordinateSystem as Qt, vec3ToArray as pt, box3ToArray as mt } from "bvh.js";
import { radixSort as Jt } from "three/addons/utils/SortUtils.js";
class Lt {
  /**
   * This object is instantiated automatically by setting `createEntities` to `true` in the `InstancedMesh2` constructor parameters.
   * Dont instantiate this manually.
   * @param owner The `InstancedMesh2` that owns this instance.
   * @param id The unique identifier for this instance within the `InstancedMesh2`.
   * @param useEuler Whether to use Euler rotations in addition to quaternion rotations.
   */
  constructor(t, e, n) {
    if (this.isInstanceEntity = !0, this.position = new T(), this.scale = new T(1, 1, 1), this.quaternion = new Ot(), this.id = e, this.owner = t, n) {
      const i = this.quaternion, s = this.rotation = new Ft();
      s._onChange(() => i.setFromEuler(s, !1)), i._onChange(() => s.setFromQuaternion(i, void 0, !1));
    }
  }
  /**
   * The visibility state set and got from `owner.availabilityArray`.
   */
  get visible() {
    return this.owner.getVisibilityAt(this.id);
  }
  set visible(t) {
    this.owner.setVisibilityAt(this.id, t);
  }
  /**
   * The availability set and got from `owner.availabilityArray`.
   */
  get active() {
    return this.owner.getActiveAt(this.id);
  }
  set active(t) {
    this.owner.setActiveAt(this.id, t);
  }
  /**
   * Color set and got from `owner.colorsTexture`.
   */
  get color() {
    return this.owner.getColorAt(this.id);
  }
  set color(t) {
    this.owner.setColorAt(this.id, t);
  }
  /**
   * Opacity set and got from `owner.colorsTexture`.
   */
  get opacity() {
    return this.owner.getOpacityAt(this.id);
  }
  set opacity(t) {
    this.owner.setOpacityAt(this.id, t);
  }
  /**
   * Morph target influences set and got from `owner.morphTexture`.
   */
  get morph() {
    return this.owner.getMorphAt(this.id);
  }
  set morph(t) {
    this.owner.setMorphAt(this.id, t);
  }
  /**
   * The local transform matrix got from `owner.matricesTexture`.
   */
  get matrix() {
    return this.owner.getMatrixAt(this.id);
  }
  /**
   * The world transform matrix got by multiplying the matrix got from `owner.matricesTexture` and `this.owner.matrixWorld`.
   */
  get matrixWorld() {
    return this.matrix.premultiply(this.owner.matrixWorld);
  }
  /**
   * @internal
   */
  setMatrixIdentity() {
    const t = this.owner, e = t.matricesTexture._data, n = this.id, i = n * 16;
    e[i + 0] = 1, e[i + 1] = 0, e[i + 2] = 0, e[i + 3] = 0, e[i + 4] = 0, e[i + 5] = 1, e[i + 6] = 0, e[i + 7] = 0, e[i + 8] = 0, e[i + 9] = 0, e[i + 10] = 1, e[i + 11] = 0, e[i + 12] = 0, e[i + 13] = 0, e[i + 14] = 0, e[i + 15] = 1, t.matricesTexture.enqueueUpdate(n);
  }
  /**
   * Updates the transformation matrix with its current position, quaternion, and scale.
   * The updated matrix is stored in the `owner.matricesTexture`.
   */
  updateMatrix() {
    const t = this.owner, e = this.position, n = this.quaternion, i = this.scale, s = t.matricesTexture._data, o = this.id, a = o * 16, c = n._x, h = n._y, u = n._z, l = n._w, d = c + c, p = h + h, m = u + u, x = c * d, g = c * p, y = c * m, w = h * p, I = h * m, O = u * m, L = l * d, U = l * p, C = l * m, A = i.x, b = i.y, v = i.z;
    s[a + 0] = (1 - (w + O)) * A, s[a + 1] = (g + C) * A, s[a + 2] = (y - U) * A, s[a + 3] = 0, s[a + 4] = (g - C) * b, s[a + 5] = (1 - (x + O)) * b, s[a + 6] = (I + L) * b, s[a + 7] = 0, s[a + 8] = (y + U) * v, s[a + 9] = (I - L) * v, s[a + 10] = (1 - (x + w)) * v, s[a + 11] = 0, s[a + 12] = e.x, s[a + 13] = e.y, s[a + 14] = e.z, s[a + 15] = 1, t.matricesTexture.enqueueUpdate(o), t.bvh && t.autoUpdateBVH && t.bvh.move(o);
  }
  /**
   * Updates only the position component of the transformation matrix.
   * This is useful if only position changes, avoiding recalculating the full matrix.
   * The updated matrix is stored in the `owner.matricesTexture`.
   */
  updateMatrixPosition() {
    const t = this.owner, e = this.position, n = t.matricesTexture._data, i = this.id, s = i * 16;
    n[s + 12] = e.x, n[s + 13] = e.y, n[s + 14] = e.z, t.matricesTexture.enqueueUpdate(i), t.bvh && t.autoUpdateBVH && t.bvh.move(i);
  }
  /**
   * Retrieves the uniform value associated with the given name.
   * @param name The name of the uniform to retrieve.
   * @param target Optional target object where the uniform value will be written.
   * @returns The retrieved uniform value.
   */
  getUniform(t, e) {
    return this.owner.getUniformAt(this.id, t, e);
  }
  /**
   * Updates the bones of the skeleton to the instance.
   * @param updateBonesMatrices Whether to update the matrices of the bones. Default is `true`.
   * @param excludeBonesSet An optional set of bone names to exclude from updates, skipping their local matrix updates.
  */
  updateBones(t = !0, e) {
    this.owner.setBonesAt(this.id, t, e);
  }
  /**
   * Sets the uniform value for the given name
   * @param name The name of the uniform to set.
   * @param value The new value for the uniform.
   */
  setUniform(t, e) {
    this.owner.setUniformAt(this.id, t, e);
  }
  /**
   * Copies the transformation properties (`position`, `scale`, `quaternion`) of this instance to the specified `Object3D`.
   * @param target The `Object3D` where the transformation properties will be copied.
   */
  copyTo(t) {
    t.position.copy(this.position), t.scale.copy(this.scale), t.quaternion.copy(this.quaternion), this.rotation && t.rotation.copy(this.rotation);
  }
  /**
   * Applies the matrix transform to the object and updates the object's position, rotation and scale.
   * @param m The matrix to apply.
   * @returns The instance of the object.
   */
  applyMatrix4(t) {
    return this.matrix.premultiply(t).decompose(this.position, this.quaternion, this.scale), this;
  }
  /**
   * Applies the rotation represented by the quaternion to the object.
   * @param q The quaternion representing the rotation to apply.
   * @returns The instance of the object.
   */
  applyQuaternion(t) {
    return this.quaternion.premultiply(t), this;
  }
  /**
   * Rotate an object along an axis in object space. The axis is assumed to be normalized.
   * @param axis A normalized vector in object space.
   * @param angle The angle in radians.
   * @returns The instance of the object.
   */
  rotateOnAxis(t, e) {
    return X.setFromAxisAngle(t, e), this.quaternion.multiply(X), this;
  }
  /**
   * Rotate an object along an axis in world space. The axis is assumed to be normalized. Method Assumes no rotated parent.
   * @param axis A normalized vector in world space.
   * @param angle The angle in radians.
   * @returns The instance of the object.
   */
  rotateOnWorldAxis(t, e) {
    return X.setFromAxisAngle(t, e), this.quaternion.premultiply(X), this;
  }
  /**
   * Rotates the object around x axis in local space.
   * @param angle The angle to rotate in radians.
   * @returns The instance of the object.
   */
  rotateX(t) {
    return this.rotateOnAxis(_t, t);
  }
  /**
   * Rotates the object around y axis in local space.
   * @param angle The angle to rotate in radians.
   * @returns The instance of the object.
   */
  rotateY(t) {
    return this.rotateOnAxis(gt, t);
  }
  /**
   * Rotates the object around z axis in local space.
   * @param angle The angle to rotate in radians.
   * @returns The instance of the object.
   */
  rotateZ(t) {
    return this.rotateOnAxis(yt, t);
  }
  /**
   * Translate an object by distance along an axis in object space. The axis is assumed to be normalized.
   * @param axis A normalized vector in object space.
   * @param distance The distance to translate.
   * @returns The instance of the object.
   */
  translateOnAxis(t, e) {
    return xt.copy(t).applyQuaternion(this.quaternion), this.position.add(xt.multiplyScalar(e)), this;
  }
  /**
   * Translates object along x axis in object space by distance units.
   * @param distance The distance to translate.
   * @returns The instance of the object.
   */
  translateX(t) {
    return this.translateOnAxis(_t, t);
  }
  /**
   * Translates object along y axis in object space by distance units.
   * @param distance The distance to translate.
   * @returns The instance of the object.
   */
  translateY(t) {
    return this.translateOnAxis(gt, t);
  }
  /**
   * Translates object along z axis in object space by distance units.
   * @param distance The distance to translate.
   * @returns The instance of the object.
   */
  translateZ(t) {
    return this.translateOnAxis(yt, t);
  }
  /**
   * Removes this entity from its owner instance.
   * @returns The instance of the object.
   */
  remove() {
    return this.owner.removeInstances(this.id), this;
  }
}
const X = new Ot(), xt = new T(), _t = new T(1, 0, 0), gt = new T(0, 1, 0), yt = new T(0, 0, 1);
class te {
  /**
   * @param target The target `InstancedMesh2`.
   * @param margin The margin applied for bounding box calculations (default is 0).
   * @param getBBoxFromBSphere Flag to determine if instance bounding boxes should be computed from the geometry bounding sphere. Faster but less precise (default is false).
   * @param accurateCulling Flag to enable accurate frustum culling without considering margin (default is true).
   */
  constructor(t, e = 0, n = !1, i = !0) {
    this.nodesMap = /* @__PURE__ */ new Map(), this.LODsMap = /* @__PURE__ */ new Map(), this._geoBoundingSphere = null, this._sphereTarget = null, this.target = t, this.accurateCulling = i, this._margin = e;
    const s = t._geometry;
    if (s.boundingBox || s.computeBoundingBox(), this.geoBoundingBox = s.boundingBox, n) {
      s.boundingSphere || s.computeBoundingSphere();
      const o = s.boundingSphere.center;
      o.x === 0 && o.y === 0 && o.z === 0 ? (this._geoBoundingSphere = s.boundingSphere, this._sphereTarget = { centerX: 0, centerY: 0, centerZ: 0, maxScale: 0 }) : (console.warn('"getBoxFromSphere" is ignored because geometry is not centered.'), n = !1);
    }
    this.bvh = new Xt(new Zt(), Qt), this._origin = new Float32Array(3), this._dir = new Float32Array(3), this._cameraPos = new Float32Array(3), this._getBoxFromSphere = n;
  }
  /**
   * Builds the BVH from the target mesh's instances using a top-down construction method.
   * This approach is more efficient and accurate compared to incremental methods, which add one instance at a time.
   */
  create() {
    const t = this.target._instancesCount, e = this.target._instancesArrayCount, n = new Array(t), i = new Uint32Array(t);
    let s = 0;
    this.clear();
    for (let o = 0; o < e; o++)
      this.target.getActiveAt(o) && (n[s] = this.getBox(o, new Float32Array(6)), i[s] = o, s++);
    this.bvh.createFromArray(i, n, (o) => {
      this.nodesMap.set(o.object, o);
    }, this._margin);
  }
  /**
   * Inserts an instance into the BVH.
   * @param id The id of the instance to insert.
   */
  insert(t) {
    const e = this.bvh.insert(t, this.getBox(t, new Float32Array(6)), this._margin);
    this.nodesMap.set(t, e);
  }
  /**
   * Inserts a range of instances into the BVH.
   * @param ids An array of ids to insert.
   */
  insertRange(t) {
    const e = t.length, n = new Array(e);
    for (let i = 0; i < e; i++)
      n[i] = this.getBox(t[i], new Float32Array(6));
    this.bvh.insertRange(t, n, this._margin, (i) => {
      this.nodesMap.set(i.object, i);
    });
  }
  /**
   * Moves an instance within the BVH.
   * @param id The id of the instance to move.
   */
  move(t) {
    const e = this.nodesMap.get(t);
    e && (this.getBox(t, e.box), this.bvh.move(e, this._margin));
  }
  /**
   * Deletes an instance from the BVH.
   * @param id The id of the instance to delete.
   */
  delete(t) {
    const e = this.nodesMap.get(t);
    e && (this.bvh.delete(e), this.nodesMap.delete(t));
  }
  /**
   * Clears the BVH.
   */
  clear() {
    this.bvh.clear(), this.nodesMap.clear();
  }
  /**
   * Performs frustum culling to determine which instances are visible based on the provided projection matrix.
   * @param projScreenMatrix The projection screen matrix for frustum culling.
   * @param onFrustumIntersection Callback function invoked when an instance intersects the frustum.
   */
  frustumCulling(t, e) {
    this._margin > 0 && this.accurateCulling ? this.bvh.frustumCulling(t.elements, (n, i, s) => {
      i.isIntersectedMargin(n.box, s, this._margin) && e(n);
    }) : this.bvh.frustumCulling(t.elements, e);
  }
  /**
   * Performs frustum culling with Level of Detail (LOD) consideration.
   * @param projScreenMatrix The projection screen matrix for frustum culling.
   * @param cameraPosition The camera's position used for LOD calculations.
   * @param levels An array of LOD levels.
   * @param onFrustumIntersection Callback function invoked when an instance intersects the frustum.
   */
  frustumCullingLOD(t, e, n, i) {
    this.LODsMap.has(n) || this.LODsMap.set(n, new Float32Array(n.length));
    const s = this.LODsMap.get(n);
    for (let a = 0; a < n.length; a++)
      s[a] = n[a].distance;
    const o = this._cameraPos;
    o[0] = e.x, o[1] = e.y, o[2] = e.z, this._margin > 0 && this.accurateCulling ? this.bvh.frustumCullingLOD(t.elements, o, s, (a, c, h, u) => {
      h.isIntersectedMargin(a.box, u, this._margin) && i(a, c);
    }) : this.bvh.frustumCullingLOD(t.elements, o, s, i);
  }
  /**
   * Performs raycasting to check if a ray intersects any instances.
   * @param raycaster The raycaster used for raycasting.
   * @param onIntersection Callback function invoked when a ray intersects an instance.
   */
  raycast(t, e) {
    const n = t.ray, i = this._origin, s = this._dir;
    pt(n.origin, i), pt(n.direction, s), this.bvh.rayIntersections(s, i, e, t.near, t.far);
  }
  /**
   * Checks if a given box intersects with any instance bounding box.
   * @param target The target bounding box.
   * @param onIntersection Callback function invoked when an intersection occurs.
   * @returns `True` if there is an intersection, otherwise `false`.
   */
  intersectBox(t, e) {
    this._boxArray || (this._boxArray = new Float32Array(6));
    const n = this._boxArray;
    return mt(t, n), this.bvh.intersectsBox(n, e);
  }
  getBox(t, e) {
    if (this._getBoxFromSphere) {
      const n = this.target.matricesTexture._data, { centerX: i, centerY: s, centerZ: o, maxScale: a } = this.getSphereFromMatrix_centeredGeometry(t, n, this._sphereTarget), c = this._geoBoundingSphere.radius * a;
      e[0] = i - c, e[1] = i + c, e[2] = s - c, e[3] = s + c, e[4] = o - c, e[5] = o + c;
    } else
      At.copy(this.geoBoundingBox).applyMatrix4(this.target.getMatrixAt(t)), mt(At, e);
    return e;
  }
  getSphereFromMatrix_centeredGeometry(t, e, n) {
    const i = t * 16, s = e[i + 0], o = e[i + 1], a = e[i + 2], c = e[i + 4], h = e[i + 5], u = e[i + 6], l = e[i + 8], d = e[i + 9], p = e[i + 10], m = s * s + o * o + a * a, x = c * c + h * h + u * u, g = l * l + d * d + p * p;
    return n.maxScale = Math.sqrt(Math.max(m, x, g)), n.centerX = e[i + 12], n.centerY = e[i + 13], n.centerZ = e[i + 14], n;
  }
}
const At = new ot();
class ee extends Et {
  /**
   * @param gl The WebGL2RenderingContext used to create the buffer.
   * @param type The type of data in the attribute.
   * @param itemSize The number of elements per attribute.
   * @param elementSize The size of individual elements in the array.
   * @param array The data array that holds the attribute values.
   * @param meshPerAttribute The number of meshes that share the same attribute data.
   */
  constructor(t, e, n, i, s, o = 1) {
    const a = t.createBuffer();
    super(a, e, n, i, s.length / n), this.isGLInstancedBufferAttribute = !0, this._needsUpdate = !1, this.isInstancedBufferAttribute = !0, this.meshPerAttribute = o, this.array = s, this._cacheArray = s, t.bindBuffer(t.ARRAY_BUFFER, a), t.bufferData(t.ARRAY_BUFFER, s, t.DYNAMIC_DRAW);
  }
  /**
   * Updates the buffer data.
   * This method is designed to be called during the `onBeforeRender` callback.
   * It ensures that the attribute data is updated just before the rendering process begins.
   * @param renderer The WebGLRenderer used to render the scene.
   * @param count The number of elements to update in the buffer.
   */
  update(t, e) {
    if (!this._needsUpdate || e === 0) return;
    const n = t.getContext();
    n.bindBuffer(n.ARRAY_BUFFER, this.buffer), this.array === this._cacheArray ? n.bufferSubData(n.ARRAY_BUFFER, 0, this.array, 0, e) : (n.bufferData(n.ARRAY_BUFFER, this.array, n.DYNAMIC_DRAW), this._cacheArray = this.array), this._needsUpdate = !1;
  }
  /** @internal */
  clone() {
    return this;
  }
}
let it = null, Q = null;
const bt = {};
function ne(r) {
  return Q.get(r)?.() ?? it(r);
}
function ie(r) {
  if (Q.has(r)) return;
  const t = {};
  Q.set(r, () => {
    if (r.isMeshDistanceMaterial) {
      const e = it(r);
      t.light = e.light;
    }
    return t;
  });
}
function se(r, t, e) {
  const n = t.properties;
  it = n.get;
  const i = `${!!r.colorsTexture}_${r._useOpacity}_${!!r.boneTexture}_${!!r.uniformsTexture}`;
  bt[i] ??= /* @__PURE__ */ new WeakMap(), Q = bt[i], n.get = ne, ie(e);
}
function re(r) {
  r.properties.get = it;
}
function Ut(r, t) {
  return Math.max(t, Math.ceil(Math.sqrt(r / t)) * t);
}
function oe(r, t, e, n) {
  t === 3 && (console.warn('"channels" cannot be 3. Set to 4. More info: https://github.com/mrdoob/three.js/pull/23228'), t = 4);
  const i = Ut(n, e), s = new r(i * i * t), o = r.name.includes("Float"), a = r.name.includes("Uint"), c = o ? ct : a ? Rt : Nt;
  let h;
  switch (t) {
    case 1:
      h = o ? ht : qt;
      break;
    case 2:
      h = o ? $t : Gt;
      break;
    case 4:
      h = o ? zt : jt;
      break;
  }
  return { array: s, size: i, type: c, format: h };
}
class J extends at {
  /**
   * @param arrayType The constructor for the TypedArray.
   * @param channels The number of channels in the texture.
   * @param pixelsPerInstance The number of pixels required for each instance.
   * @param capacity The total number of instances.
   * @param uniformMap Optional map for handling uniform values.
   * @param fetchInFragmentShader Optional flag that determines if uniform values should be fetched in the fragment shader instead of the vertex shader.
   */
  constructor(t, e, n, i, s, o) {
    e === 3 && (e = 4);
    const { array: a, format: c, size: h, type: u } = oe(t, e, n, i);
    super(a, h, h, c, u), this.partialUpdate = !0, this.maxUpdateCalls = 1 / 0, this._utils = null, this._needsUpdate = !0, this._lastWidth = -1, this._data = a, this._channels = e, this._pixelsPerInstance = n, this._stride = n * e, this._rowToUpdate = new Array(h), this._uniformMap = s, this._fetchUniformsInFragmentShader = o, this.needsUpdate = !0;
  }
  /**
   * Resizes the texture to accommodate a new number of instances.
   * @param count The new total number of instances.
   */
  resize(t) {
    const e = Ut(t, this._pixelsPerInstance);
    if (e === this.image.width) return;
    const n = this._data, i = this._channels;
    this._rowToUpdate.length = e;
    const s = n.constructor, o = new s(e * e * i), a = Math.min(n.length, o.length);
    o.set(new s(n.buffer, 0, a)), this.dispose(), this.image = { data: o, height: e, width: e }, this._data = o;
  }
  /**
   * Marks a row of the texture for update during the next render cycle.
   * This helps in optimizing texture updates by only modifying the rows that have changed.
   * @param index The index of the instance to update.
   */
  enqueueUpdate(t) {
    if (this._needsUpdate = !0, !this.partialUpdate) return;
    const e = this.image.width / this._pixelsPerInstance, n = Math.floor(t / e);
    this._rowToUpdate[n] = !0;
  }
  bindToProgram(t, e, n, i, s) {
    if (!i[s]) return;
    i[s].value = this;
    const o = this.getSlot(n, s);
    if (o === void 0) return;
    const a = t.properties.get(this);
    t.state.bindTexture(e.TEXTURE_2D, a.__webglTexture, e.TEXTURE0 + o);
  }
  /**
   * Updates the texture data based on the rows that need updating.
   * This method is optimized to only update the rows that have changed, improving performance.
   * @param renderer The WebGLRenderer used for rendering.
   * @param materialProperties The material properties associated with the texture.
   * @param uniformName The name of the uniform in the shader.
   */
  update(t, e, n) {
    const i = t.properties.get(this), s = i.__version !== this.version;
    if (!this._needsUpdate && !s) return;
    const o = this._lastWidth !== this.image.width;
    if (!i.__webglTexture || o)
      t.initTexture(this);
    else {
      const a = this.getSlot(e, n) ?? t.capabilities.maxTextures - 1;
      this.partialUpdate ? this.updatePartial(i, t, a) : this.updateFull(i, t, a), i.__version = this.version;
    }
    this._lastWidth = this.image.width, this._needsUpdate = !1;
  }
  getSlot(t, e) {
    return t[e]?.cache[0];
  }
  updateFull(t, e, n) {
    this.updateRows(t, e, [{ row: 0, count: this.image.height }], n);
  }
  updatePartial(t, e, n) {
    const i = this.getUpdateRowsInfo();
    i.length !== 0 && (i.length > this.maxUpdateCalls ? this.updateFull(t, e, n) : this.updateRows(t, e, i, n), this._rowToUpdate.fill(!1));
  }
  // TODO reuse same objects to prevent memory leak
  getUpdateRowsInfo() {
    const t = this._rowToUpdate, e = [];
    for (let n = 0, i = t.length; n < i; n++)
      if (t[n]) {
        const s = n;
        for (; n < i && t[n]; n++)
          ;
        e.push({ row: s, count: n - s });
      }
    return e;
  }
  updateRows(t, e, n, i) {
    const s = e.getContext();
    this._utils ??= new Pt(s, e.extensions, e.capabilities);
    const o = this._utils.convert(this.format), a = this._utils.convert(this.type), { data: c, width: h } = this.image, u = this._channels;
    e.state.activeTexture(s.TEXTURE0 + i), e.state.bindTexture(s.TEXTURE_2D, t.__webglTexture, s.TEXTURE0 + i);
    const l = Z.getPrimaries(Z.workingColorSpace), d = this.colorSpace === ft ? null : Z.getPrimaries(this.colorSpace), p = this.colorSpace === ft || l === d ? s.NONE : s.BROWSER_DEFAULT_WEBGL, m = s.getParameter(s.UNPACK_FLIP_Y_WEBGL), x = s.getParameter(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL), g = s.getParameter(s.UNPACK_ALIGNMENT), y = s.getParameter(s.UNPACK_COLORSPACE_CONVERSION_WEBGL);
    s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL, this.flipY), s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL, this.premultiplyAlpha), s.pixelStorei(s.UNPACK_ALIGNMENT, this.unpackAlignment), s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL, p);
    for (const { count: w, row: I } of n)
      s.texSubImage2D(s.TEXTURE_2D, 0, 0, I, h, w, o, a, c, I * h * u);
    s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL, m), s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL, x), s.pixelStorei(s.UNPACK_ALIGNMENT, g), s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL, y), this.onUpdate?.(this);
  }
  /**
   * Sets a uniform value at the specified instance ID in the texture.
   * @param id The instance ID to set the uniform for.
   * @param name The name of the uniform.
   * @param value The value to set for the uniform.
   */
  setUniformAt(t, e, n) {
    const { offset: i, size: s } = this._uniformMap.get(e), o = this._stride;
    s === 1 ? this._data[t * o + i] = n : n.toArray(this._data, t * o + i);
  }
  /**
   * Retrieves a uniform value at the specified instance ID from the texture.
   * @param id The instance ID to retrieve the uniform from.
   * @param name The name of the uniform.
   * @param target Optional target object to store the uniform value.
   * @returns The uniform value for the specified instance.
   */
  getUniformAt(t, e, n) {
    const { offset: i, size: s } = this._uniformMap.get(e), o = this._stride;
    return s === 1 ? this._data[t * o + i] : n.fromArray(this._data, t * o + i);
  }
  /**
   * Generates the GLSL code for accessing the uniform data stored in the texture.
   * @param textureName The name of the texture in the GLSL shader.
   * @param indexName The name of the index in the GLSL shader.
   * @param indexType The type of the index in the GLSL shader.
   * @returns An object containing the GLSL code for the vertex and fragment shaders.
   */
  getUniformsGLSL(t, e, n) {
    const i = this.getUniformsVertexGLSL(t, e, n), s = this.getUniformsFragmentGLSL(t, e, n);
    return { vertex: i, fragment: s };
  }
  getUniformsVertexGLSL(t, e, n) {
    if (this._fetchUniformsInFragmentShader)
      return `
        flat varying ${n} ez_v${e}; 
        void main() {
          ez_v${e} = ${e};`;
    const i = this.texelsFetchGLSL(t, e), s = this.getFromTexelsGLSL(), { assignVarying: o, declareVarying: a } = this.getVarying();
    return `
      uniform highp sampler2D ${t};  
      ${a}
      void main() {
        ${i}
        ${s}
        ${o}`;
  }
  getUniformsFragmentGLSL(t, e, n) {
    if (!this._fetchUniformsInFragmentShader) {
      const { declareVarying: o, getVarying: a } = this.getVarying();
      return `
      ${o}
      void main() {
        ${a}`;
    }
    const i = this.texelsFetchGLSL(t, `ez_v${e}`), s = this.getFromTexelsGLSL();
    return `
      uniform highp sampler2D ${t};  
      flat varying ${n} ez_v${e};
      void main() {
        ${i}
        ${s}`;
  }
  texelsFetchGLSL(t, e) {
    const n = this._pixelsPerInstance;
    let i = `
      int size = textureSize(${t}, 0).x;
      int j = int(${e}) * ${n};
      int x = j % size;
      int y = j / size;
    `;
    for (let s = 0; s < n; s++)
      i += `vec4 ez_texel${s} = texelFetch(${t}, ivec2(x + ${s}, y), 0);
`;
    return i;
  }
  getFromTexelsGLSL() {
    const t = this._uniformMap;
    let e = "";
    for (const [n, { type: i, offset: s, size: o }] of t) {
      const a = Math.floor(s / this._channels);
      if (i === "mat3")
        e += `mat3 ${n} = mat3(ez_texel${a}.rgb, vec3(ez_texel${a}.a, ez_texel${a + 1}.rg), vec3(ez_texel${a + 1}.ba, ez_texel${a + 2}.r));
`;
      else if (i === "mat4")
        e += `mat4 ${n} = mat4(ez_texel${a}, ez_texel${a + 1}, ez_texel${a + 2}, ez_texel${a + 3});
`;
      else {
        const c = this.getUniformComponents(s, o);
        e += `${i} ${n} = ez_texel${a}.${c};
`;
      }
    }
    return e;
  }
  getVarying() {
    const t = this._uniformMap;
    let e = "", n = "", i = "";
    for (const [s, { type: o }] of t)
      e += `flat varying ${o} ez_v${s};
`, n += `ez_v${s} = ${s};
`, i += `${o} ${s} = ez_v${s};
`;
    return { declareVarying: e, assignVarying: n, getVarying: i };
  }
  getUniformComponents(t, e) {
    const n = t % this._channels;
    let i = "";
    for (let s = 0; s < e; s++)
      i += ae[n + s];
    return i;
  }
  copy(t) {
    return super.copy(t), this.partialUpdate = t.partialUpdate, this.maxUpdateCalls = t.maxUpdateCalls, this._channels = t._channels, this._pixelsPerInstance = t._pixelsPerInstance, this._stride = t._stride, this._rowToUpdate = t._rowToUpdate, this._uniformMap = t._uniformMap, this._fetchUniformsInFragmentShader = t._fetchUniformsInFragmentShader, this;
  }
}
const ae = ["r", "g", "b", "a"];
class f extends ut {
  /**
   * @remarks Geometry cannot be shared. If reused, it will be cloned.
   * @param geometry An instance of `BufferGeometry`.
   * @param material A single or an array of `Material`.
   * @param params Optional configuration parameters object. See `InstancedMesh2Params` for details.
   */
  constructor(t, e, n = {}, i) {
    if (!t) throw new Error('"geometry" is mandatory.');
    if (!e) throw new Error('"material" is mandatory.');
    const { allowsEuler: s, renderer: o, createEntities: a } = n;
    super(t, null), this.type = "InstancedMesh2", this.isInstancedMesh2 = !0, this.instances = null, this.instanceIndex = null, this.colorsTexture = null, this.morphTexture = null, this.boneTexture = null, this.uniformsTexture = null, this.boundingBox = null, this.boundingSphere = null, this.bvh = null, this.customSort = null, this.raycastOnlyFrustum = !1, this.LODinfo = null, this.autoUpdate = !0, this.bindMode = dt, this.bindMatrix = null, this.bindMatrixInverse = null, this.skeleton = null, this.autoUpdateBVH = !0, this.onFrustumEnter = null, this._renderer = null, this._instancesCount = 0, this._instancesArrayCount = 0, this._perObjectFrustumCulled = !0, this._sortObjects = !1, this._indexArrayNeedsUpdate = !1, this._useOpacity = !1, this._currentMaterial = null, this._customProgramCacheKeyBase = null, this._onBeforeCompileBase = null, this._definesBase = null, this._freeIds = [], this.isInstancedMesh = !0, this.instanceMatrix = new Wt(new Float32Array(0), 16), this.instanceColor = null, this._customProgramCacheKey = () => `ez_${!!this.colorsTexture}_${this._useOpacity}_${!!this.boneTexture}_${!!this.uniformsTexture}_${this._customProgramCacheKeyBase.call(this._currentMaterial)}`, this._onBeforeCompile = (h, u) => {
      if (this._onBeforeCompileBase && this._onBeforeCompileBase.call(this._currentMaterial, h, u), h.defines = { ...h.defines }, h.defines.USE_INSTANCING_INDIRECT = "", h.uniforms.matricesTexture = { value: this.matricesTexture }, this.uniformsTexture) {
        h.uniforms.uniformsTexture = { value: this.uniformsTexture };
        const { vertex: l, fragment: d } = this.uniformsTexture.getUniformsGLSL("uniformsTexture", "instanceIndex", "uint");
        h.vertexShader = h.vertexShader.replace("void main() {", l), h.fragmentShader = h.fragmentShader.replace("void main() {", d);
      }
      this.colorsTexture && h.fragmentShader.includes("#include <color_pars_fragment>") && (h.defines.USE_INSTANCING_COLOR_INDIRECT = "", h.uniforms.colorsTexture = { value: this.colorsTexture }, h.vertexShader = h.vertexShader.replace("<color_vertex>", "<instanced_color_vertex>"), h.vertexColors && (h.defines.USE_VERTEX_COLOR = ""), h.defines.USE_COLOR_ALPHA = ""), this.boneTexture && (h.defines.USE_SKINNING = "", h.defines.USE_INSTANCING_SKINNING = "", h.uniforms.bindMatrix = { value: this.bindMatrix }, h.uniforms.bindMatrixInverse = { value: this.bindMatrixInverse }, h.uniforms.bonesPerInstance = { value: this.skeleton.bones.length }, h.uniforms.boneTexture = { value: this.boneTexture });
    };
    const c = n.capacity > 0 ? n.capacity : ce;
    this._renderer = o, this._capacity = c, this._parentLOD = i, this._geometry = t, this.material = e, this._allowsEuler = s ?? !1, this._tempInstance = new Lt(this, -1, s), this.availabilityArray = i?.availabilityArray ?? new Array(c * 2), this._createEntities = a, this.initLastRenderInfo(), this.initIndexAttribute(), this.initMatricesTexture();
  }
  // must be null to avoid exception
  /**
   * The capacity of the instance buffers.
   */
  get capacity() {
    return this._capacity;
  }
  /**
   * The number of active instances.
   */
  get instancesCount() {
    return this._instancesCount;
  }
  /**
   * Determines if per-instance frustum culling is enabled.
   * @default true
   */
  get perObjectFrustumCulled() {
    return this._perObjectFrustumCulled;
  }
  set perObjectFrustumCulled(t) {
    this._perObjectFrustumCulled = t, this._indexArrayNeedsUpdate = !0;
  }
  /**
   * Determines if objects should be sorted before rendering.
   * @default false
   */
  get sortObjects() {
    return this._sortObjects;
  }
  set sortObjects(t) {
    this._sortObjects = t, this._indexArrayNeedsUpdate = !0;
  }
  /**
   * An instance of `BufferGeometry` (or derived classes), defining the object's structure.
   */
  // @ts-expect-error It's defined as a property, but is overridden as an accessor.
  get geometry() {
    return this._geometry;
  }
  set geometry(t) {
    this._geometry = t, this.patchGeometry(t);
  }
  onBeforeShadow(t, e, n, i, s, o, a) {
    this.patchMaterial(t, o), this.updateTextures(t, o);
    const c = t.info.render.frame;
    this.instanceIndex && this.autoUpdate && !this.frustumCullingAlreadyPerformed(c, n, i) && this.performFrustumCulling(i, n), this.count !== 0 && (this.instanceIndex.update(this._renderer, this.count), this.bindTextures(t, o));
  }
  onBeforeRender(t, e, n, i, s, o) {
    if (this.patchMaterial(t, s), this.updateTextures(t, s), !this.instanceIndex) {
      this._renderer = t;
      return;
    }
    const a = t.info.render.frame;
    this.autoUpdate && !this.frustumCullingAlreadyPerformed(a, n, null) && this.performFrustumCulling(n), this.count !== 0 && (this.instanceIndex.update(this._renderer, this.count), this.bindTextures(t, s));
  }
  onAfterShadow(t, e, n, i, s, o, a) {
    this.unpatchMaterial(t, o);
  }
  onAfterRender(t, e, n, i, s, o) {
    this.unpatchMaterial(t, s), !(this.instanceIndex || o && !this.isLastGroup(o.materialIndex)) && this.initIndexAttribute();
  }
  updateTextures(t, e) {
    const n = t.properties.get(e);
    this.matricesTexture.update(t, n, "matricesTexture"), this.colorsTexture?.update(t, n, "colorsTexture"), this.uniformsTexture?.update(t, n, "uniformsTexture"), this.boneTexture?.update(t, n, "boneTexture");
  }
  bindTextures(t, e) {
    const n = t.properties.get(e), i = n.uniforms;
    if (!i) return;
    const s = n.currentProgram, o = s?.program;
    if (!o) return;
    const a = t.getContext(), c = s.getUniforms().map, h = a.getParameter(a.CURRENT_PROGRAM);
    t.state.useProgram(o), this.matricesTexture.bindToProgram(t, a, c, i, "matricesTexture"), this.colorsTexture?.bindToProgram(t, a, c, i, "colorsTexture"), this.uniformsTexture?.bindToProgram(t, a, c, i, "uniformsTexture"), this.boneTexture?.bindToProgram(t, a, c, i, "boneTexture"), t.state.useProgram(h);
  }
  isLastGroup(t) {
    const e = this.material;
    for (let n = e.length - 1; n >= t; n--)
      if (e[n].visible)
        return n === t;
  }
  initIndexAttribute() {
    if (!this._renderer) {
      this.count = 0;
      return;
    }
    const t = this._renderer.getContext(), e = this._capacity, n = new Uint32Array(e);
    for (let i = 0; i < e; i++)
      n[i] = i;
    this.instanceIndex = new ee(t, t.UNSIGNED_INT, 1, 4, n), this._geometry.setAttribute("instanceIndex", this.instanceIndex);
  }
  initLastRenderInfo() {
    this._parentLOD || (this._lastRenderInfo = { frame: -1, camera: null, shadowCamera: null });
  }
  initMatricesTexture() {
    this._parentLOD || (this.matricesTexture = new J(Float32Array, 4, 4, this._capacity));
  }
  initColorsTexture() {
    this._parentLOD || (this.colorsTexture = new J(Float32Array, 4, 1, this._capacity), this.colorsTexture.colorSpace = Z.workingColorSpace, this.colorsTexture._data.fill(1), this.materialsNeedsUpdate());
  }
  materialsNeedsUpdate() {
    if (this.material.isMaterial) {
      this.material.needsUpdate = !0;
      return;
    }
    for (const t of this.material)
      t.needsUpdate = !0;
  }
  patchGeometry(t) {
    const e = t.getAttribute("instanceIndex");
    if (e) {
      if (e === this.instanceIndex) return;
      console.warn("The geometry has been cloned because it was already used."), t = t.clone(), t.deleteAttribute("instanceIndex");
    }
    this.instanceIndex && t.setAttribute("instanceIndex", this.instanceIndex);
  }
  patchMaterial(t, e) {
    this._currentMaterial = e, this._customProgramCacheKeyBase = e.customProgramCacheKey, this._onBeforeCompileBase = e.onBeforeCompile, this._definesBase = e.defines, e.customProgramCacheKey = this._customProgramCacheKey, e.onBeforeCompile = this._onBeforeCompile, se(this, t, e);
  }
  unpatchMaterial(t, e) {
    this._currentMaterial = null, re(t), e.defines = this._definesBase, e.onBeforeCompile = this._onBeforeCompileBase, e.customProgramCacheKey = this._customProgramCacheKeyBase, this._onBeforeCompileBase = null, this._customProgramCacheKeyBase = null, this._definesBase = null;
  }
  /**
   * Creates and computes the BVH (Bounding Volume Hierarchy) for the instances.
   * It's recommended to create it when all the instance matrices have been assigned.
   * Once created it will be updated automatically.
   * @param config Optional configuration parameters object. See `BVHParams` for details.
   */
  computeBVH(t = {}) {
    this.bvh || (this.bvh = new te(this, t.margin, t.getBBoxFromBSphere, t.accurateCulling)), this.bvh.clear(), this.bvh.create();
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
  setMatrixAt(t, e) {
    if (e.toArray(this.matricesTexture._data, t * 16), this.instances) {
      const n = this.instances[t];
      e.decompose(n.position, n.quaternion, n.scale);
    }
    this.matricesTexture.enqueueUpdate(t), this.bvh && this.autoUpdateBVH && this.bvh.move(t);
  }
  /**
   * Gets the local transformation matrix of a specific instance.
   * @param id The index of the instance.
   * @param matrix Optional `Matrix4` to store the result.
   * @returns The transformation matrix of the instance.
   */
  getMatrixAt(t, e = he) {
    return e.fromArray(this.matricesTexture._data, t * 16);
  }
  /**
   * Retrieves the position of a specific instance.
   * @param index The index of the instance.
   * @param target Optional `Vector3` to store the result.
   * @returns The position of the instance as a `Vector3`.
   */
  getPositionAt(t, e = ue) {
    const n = t * 16, i = this.matricesTexture._data;
    return e.x = i[n + 12], e.y = i[n + 13], e.z = i[n + 14], e;
  }
  /** @internal */
  getPositionAndMaxScaleOnAxisAt(t, e) {
    const n = t * 16, i = this.matricesTexture._data, s = i[n + 0], o = i[n + 1], a = i[n + 2], c = s * s + o * o + a * a, h = i[n + 4], u = i[n + 5], l = i[n + 6], d = h * h + u * u + l * l, p = i[n + 8], m = i[n + 9], x = i[n + 10], g = p * p + m * m + x * x;
    return e.x = i[n + 12], e.y = i[n + 13], e.z = i[n + 14], Math.sqrt(Math.max(c, d, g));
  }
  /** @internal */
  applyMatrixAtToSphere(t, e, n, i) {
    const s = t * 16, o = this.matricesTexture._data, a = o[s + 0], c = o[s + 1], h = o[s + 2], u = o[s + 3], l = o[s + 4], d = o[s + 5], p = o[s + 6], m = o[s + 7], x = o[s + 8], g = o[s + 9], y = o[s + 10], w = o[s + 11], I = o[s + 12], O = o[s + 13], L = o[s + 14], U = o[s + 15], C = e.center, A = n.x, b = n.y, v = n.z, B = 1 / (u * A + m * b + w * v + U);
    C.x = (a * A + l * b + x * v + I) * B, C.y = (c * A + d * b + g * v + O) * B, C.z = (h * A + p * b + y * v + L) * B;
    const F = a * a + c * c + h * h, E = l * l + d * d + p * p, P = x * x + g * g + y * y;
    e.radius = i * Math.sqrt(Math.max(F, E, P));
  }
  /**
   * Sets the visibility of a specific instance.
   * @param id The index of the instance.
   * @param visible Whether the instance should be visible.
   */
  setVisibilityAt(t, e) {
    this.availabilityArray[t * 2] = e, this._indexArrayNeedsUpdate = !0;
  }
  /**
   * Gets the visibility of a specific instance.
   * @param id The index of the instance.
   * @returns Whether the instance is visible.
   */
  getVisibilityAt(t) {
    return this.availabilityArray[t * 2];
  }
  /**
   * Sets the availability of a specific instance.
   * @param id The index of the instance.
   * @param active Whether the instance is active (not deleted).
   */
  setActiveAt(t, e) {
    this.availabilityArray[t * 2 + 1] = e, this._indexArrayNeedsUpdate = !0;
  }
  /**
   * Gets the availability of a specific instance.
   * @param id The index of the instance.
   * @returns Whether the instance is active (not deleted).
   */
  getActiveAt(t) {
    return this.availabilityArray[t * 2 + 1];
  }
  /**
   * Indicates if a specific instance is visible and active.
   * @param id The index of the instance.
   * @returns Whether the instance is visible and active.
   */
  getActiveAndVisibilityAt(t) {
    const e = t * 2, n = this.availabilityArray;
    return n[e] && n[e + 1];
  }
  /**
   * Set if a specific instance is visible and active.
   * @param id The index of the instance.
   * @param value Whether the instance is active and active (not deleted).
   */
  setActiveAndVisibilityAt(t, e) {
    const n = t * 2, i = this.availabilityArray;
    i[n] = e, i[n + 1] = e, this._indexArrayNeedsUpdate = !0;
  }
  /**
   * Sets the color of a specific instance.
   * @param id The index of the instance.
   * @param color The color to assign to the instance.
   */
  setColorAt(t, e) {
    this.colorsTexture === null && this.initColorsTexture(), e.isColor ? e.toArray(this.colorsTexture._data, t * 4) : It.set(e).toArray(this.colorsTexture._data, t * 4), this.colorsTexture.enqueueUpdate(t);
  }
  /**
   * Gets the color of a specific instance.
   * @param id The index of the instance.
   * @param color Optional `Color` to store the result.
   * @returns The color of the instance.
   */
  getColorAt(t, e = It) {
    return e.fromArray(this.colorsTexture._data, t * 4);
  }
  /**
   * Sets the opacity of a specific instance.
   * @param id The index of the instance.
   * @param value The opacity value to assign.
   */
  setOpacityAt(t, e) {
    this._useOpacity || (this.colorsTexture === null ? this.initColorsTexture() : this.materialsNeedsUpdate(), this._useOpacity = !0), this.colorsTexture._data[t * 4 + 3] = e, this.colorsTexture.enqueueUpdate(t);
  }
  /**
   * Gets the opacity of a specific instance.
   * @param id The index of the instance.
   * @returns The opacity of the instance.
   */
  getOpacityAt(t) {
    return this._useOpacity ? this.colorsTexture._data[t * 4 + 3] : 1;
  }
  /**
   * Copies `position`, `quaternion`, and `scale` of a specific instance to the specified target `Object3D`.
   * @param id The index of the instance.
   * @param target The `Object3D` where to copy transformation data.
   */
  copyTo(t, e) {
    this.getMatrixAt(t, e.matrix).decompose(e.position, e.quaternion, e.scale);
  }
  /**
   * Computes the bounding box that encloses all instances, and updates the `boundingBox` attribute.
   */
  computeBoundingBox() {
    const t = this._geometry, e = this._instancesArrayCount;
    this.boundingBox ??= new ot(), t.boundingBox === null && t.computeBoundingBox();
    const n = t.boundingBox, i = this.boundingBox;
    i.makeEmpty();
    for (let s = 0; s < e; s++)
      this.getActiveAt(s) && (vt.copy(n).applyMatrix4(this.getMatrixAt(s)), i.union(vt));
  }
  /**
   * Computes the bounding sphere that encloses all instances, and updates the `boundingSphere` attribute.
   */
  computeBoundingSphere() {
    const t = this._geometry, e = this._instancesArrayCount;
    this.boundingSphere ??= new nt(), t.boundingSphere === null && t.computeBoundingSphere();
    const n = t.boundingSphere, i = this.boundingSphere;
    i.makeEmpty();
    for (let s = 0; s < e; s++)
      this.getActiveAt(s) && (Tt.copy(n).applyMatrix4(this.getMatrixAt(s)), i.union(Tt));
  }
  clone(t) {
    const e = {
      capacity: this._capacity,
      renderer: this._renderer,
      allowsEuler: this._allowsEuler,
      createEntities: this._createEntities
    };
    return new this.constructor(this.geometry, this.material, e).copy(this, t);
  }
  copy(t, e) {
    return super.copy(t, e), this.count = t._capacity, this._instancesCount = t._instancesCount, this._instancesArrayCount = t._instancesArrayCount, this._capacity = t._capacity, t.boundingBox !== null && (this.boundingBox = t.boundingBox.clone()), t.boundingSphere !== null && (this.boundingSphere = t.boundingSphere.clone()), this.matricesTexture = t.matricesTexture.clone(), this.matricesTexture.image.data = this.matricesTexture.image.data.slice(), t.colorsTexture !== null && (this.colorsTexture = t.colorsTexture.clone(), this.colorsTexture.image.data = this.colorsTexture.image.data.slice()), t.uniformsTexture !== null && (this.uniformsTexture = t.uniformsTexture.clone(), this.uniformsTexture.image.data = this.uniformsTexture.image.data.slice()), t.morphTexture !== null && (this.morphTexture = t.morphTexture.clone(), this.morphTexture.image.data = this.morphTexture.image.data.slice()), t.boneTexture !== null && (this.boneTexture = t.boneTexture.clone(), this.boneTexture.image.data = this.boneTexture.image.data.slice()), this;
  }
  /**
   * Frees the GPU-related resources allocated.
   */
  dispose() {
    this.dispatchEvent({ type: "dispose" }), this.matricesTexture.dispose(), this.colorsTexture?.dispose(), this.morphTexture?.dispose(), this.boneTexture?.dispose(), this.uniformsTexture?.dispose();
  }
  updateMatrixWorld(t) {
    super.updateMatrixWorld(t), this.bindMatrixInverse && (this.bindMode === dt ? this.bindMatrixInverse.copy(this.matrixWorld).invert() : this.bindMode === kt ? this.bindMatrixInverse.copy(this.bindMatrix).invert() : console.warn("Unrecognized bindMode: " + this.bindMode));
  }
}
const ce = 1e3, vt = new ot(), Tt = new nt(), he = new z(), It = new Vt(), ue = new T();
f.prototype.resizeBuffers = function(r) {
  const t = this._capacity;
  this._capacity = r;
  const e = Math.min(r, t);
  if (this.instanceIndex) {
    const n = new Uint32Array(r);
    n.set(new Uint32Array(this.instanceIndex.array.buffer, 0, e)), this.instanceIndex.array = n;
  }
  if (this.LODinfo) {
    for (const n of this.LODinfo.objects)
      if (n._capacity = r, n.instanceIndex) {
        const i = new Uint32Array(r);
        i.set(new Uint32Array(n.instanceIndex.array.buffer, 0, e)), n.instanceIndex.array = i;
      }
  }
  if (this.availabilityArray.length = r * 2, this.matricesTexture.resize(r), this.colorsTexture && (this.colorsTexture.resize(r), r > t && this.colorsTexture._data.fill(1, t * 4)), this.morphTexture) {
    const n = this.morphTexture.image.data, i = n.length / t;
    this.morphTexture.dispose(), this.morphTexture = new at(new Float32Array(i * r), i, r, ht, ct), this.morphTexture.image.data.set(n);
  }
  return this.uniformsTexture?.resize(r), this;
};
f.prototype.setInstancesArrayCount = function(r) {
  if (r < this._instancesArrayCount) {
    const e = this.bvh;
    if (e)
      for (let n = this._instancesArrayCount - 1; n >= r; n--)
        this.getActiveAt(n) && e.delete(n);
    this._instancesArrayCount = r;
    return;
  }
  if (r > this._capacity) {
    let e = this._capacity + (this._capacity >> 1) + 512;
    for (; e < r; )
      e += (e >> 1) + 512;
    this.resizeBuffers(e);
  }
  const t = this._instancesArrayCount;
  this._instancesArrayCount = r, this._createEntities && this.createEntities(t);
};
function Te(r) {
  const t = {
    get: (e) => e.depthSort,
    aux: new Array(r._capacity),
    reversed: !1
  };
  return function(n) {
    t.reversed = !!r.material?.transparent, r._capacity > t.aux.length && (t.aux.length = r._capacity);
    let i = 1 / 0, s = -1 / 0;
    for (const { depth: c } of n)
      c > s && (s = c), c < i && (i = c);
    const o = s - i, a = (2 ** 32 - 1) / o;
    for (const c of n)
      c.depthSort = (c.depth - i) * a;
    Jt(n, t);
  };
}
function Bt(r, t) {
  return r.depth - t.depth;
}
function Dt(r, t) {
  return t.depth - r.depth;
}
class le {
  constructor() {
    this.array = [], this.pool = [];
  }
  /**
   * Adds a new render item to the list.
   * @param depth The depth value used for sorting or determining the rendering order.
   * @param index The unique instance id of the render item.
   */
  push(t, e) {
    const n = this.pool, i = this.array, s = i.length;
    s >= n.length && n.push({ depth: null, index: null, depthSort: null });
    const o = n[s];
    o.depth = t, o.index = e, i.push(o);
  }
  /**
   * Resets the render list by clearing the array.
   */
  reset() {
    this.array.length = 0;
  }
}
const tt = new Kt(), M = new le(), D = new z(), R = new z(), st = new T(), j = new T(), N = new T(), fe = new T(), S = new nt();
f.prototype.performFrustumCulling = function(r, t = r) {
  const e = this._parentLOD ?? this, n = e.LODinfo;
  let i;
  if (n) {
    i = r !== t ? n.shadowRender ?? n.render : n.render;
    for (const o of n.objects)
      o.count = 0;
  } else (e._perObjectFrustumCulled || e._sortObjects) && (e.count = 0);
  e._instancesArrayCount !== 0 && (i?.levels.length > 0 ? e.frustumCullingLOD(i, r, t) : e.frustumCulling(r));
};
f.prototype.updateLastRenderInfo = function(r, t, e) {
  const n = this._lastRenderInfo;
  n.frame = r, n.camera = t, n.shadowCamera = e;
};
f.prototype.frustumCullingAlreadyPerformed = function(r, t, e) {
  const n = this._lastRenderInfo;
  return n.frame === r && n.camera === t && n.shadowCamera === e ? !0 : (this.updateLastRenderInfo(r, t, e), !1);
};
f.prototype.frustumCulling = function(r) {
  const t = this._sortObjects, e = this._perObjectFrustumCulled, n = this.instanceIndex.array;
  if (this.instanceIndex._needsUpdate = !0, !e && !t) {
    this.updateIndexArray();
    return;
  }
  if (t && (R.copy(this.matrixWorld).invert(), j.setFromMatrixPosition(r.matrixWorld).applyMatrix4(R), st.set(0, 0, -1).transformDirection(r.matrixWorld).transformDirection(R)), e ? (D.multiplyMatrices(r.projectionMatrix, r.matrixWorldInverse).multiply(this.matrixWorld), this.bvh ? this.BVHCulling(r) : this.linearCulling(r)) : this.updateRenderList(), t) {
    const i = this.customSort;
    i === null ? M.array.sort(this.material?.transparent ? Dt : Bt) : i(M.array);
    const s = M.array, o = s.length;
    for (let a = 0; a < o; a++)
      n[a] = s[a].index;
    this.count = o, M.reset();
  }
};
f.prototype.updateIndexArray = function() {
  if (!this._indexArrayNeedsUpdate) return;
  const r = this.instanceIndex.array, t = this._instancesArrayCount;
  let e = 0;
  for (let n = 0; n < t; n++)
    this.getActiveAndVisibilityAt(n) && (r[e++] = n);
  this.count = e, this._indexArrayNeedsUpdate = !1;
};
f.prototype.updateRenderList = function() {
  const r = this._instancesArrayCount;
  for (let t = 0; t < r; t++)
    if (this.getActiveAndVisibilityAt(t)) {
      const e = this.getPositionAt(t).sub(j).dot(st);
      M.push(e, t);
    }
};
f.prototype.BVHCulling = function(r) {
  const t = this.instanceIndex.array, e = this._instancesArrayCount, n = this._sortObjects, i = this.onFrustumEnter;
  let s = 0;
  this.bvh.frustumCulling(D, (o) => {
    const a = o.object;
    if (a < e && this.getVisibilityAt(a) && (!i || i(a, r)))
      if (n) {
        const c = this.getPositionAt(a).sub(j).dot(st);
        M.push(c, a);
      } else
        t[s++] = a;
  }), this.count = s;
};
f.prototype.linearCulling = function(r) {
  const t = this.instanceIndex.array;
  this.geometry.boundingSphere || this.geometry.computeBoundingSphere();
  const e = this._geometry.boundingSphere, n = e.radius, i = e.center, s = this._instancesArrayCount, o = i.x === 0 && i.y === 0 && i.z === 0, a = this._sortObjects, c = this.onFrustumEnter;
  let h = 0;
  tt.setFromProjectionMatrix(D);
  for (let u = 0; u < s; u++)
    if (this.getActiveAndVisibilityAt(u)) {
      if (o) {
        const l = this.getPositionAndMaxScaleOnAxisAt(u, S.center);
        S.radius = n * l;
      } else
        this.applyMatrixAtToSphere(u, S, i, n);
      if (tt.intersectsSphere(S) && (!c || c(u, r)))
        if (a) {
          const l = fe.subVectors(S.center, j).dot(st);
          M.push(l, u);
        } else
          t[h++] = u;
    }
  this.count = h;
};
f.prototype.frustumCullingLOD = function(r, t, e) {
  const { count: n, levels: i } = r;
  for (let c = 0; c < i.length; c++) {
    if (!i[c].object.instanceIndex) return;
    n[c] = 0, i[c].object.instanceIndex._needsUpdate = !0;
  }
  const o = !(t !== e) && this._sortObjects;
  D.multiplyMatrices(t.projectionMatrix, t.matrixWorldInverse).multiply(this.matrixWorld), R.copy(this.matrixWorld).invert(), j.setFromMatrixPosition(t.matrixWorld).applyMatrix4(R), N.setFromMatrixPosition(e.matrixWorld).applyMatrix4(R);
  const a = r.levels.map((c) => c.object.instanceIndex.array);
  if (this.bvh ? this.BVHCullingLOD(r, a, o, t, e) : this.linearCullingLOD(r, a, o, t, e), o) {
    const c = this.customSort, h = M.array;
    let u = 0, l = i[1].distance;
    c === null ? h.sort(i[0].object.material?.transparent ? Dt : Bt) : c(h);
    for (let d = 0, p = h.length; d < p; d++) {
      const m = h[d];
      m.depth > l && (u++, l = i[u + 1]?.distance ?? 1 / 0), a[u][n[u]++] = m.index;
    }
    M.reset();
  }
  for (let c = 0; c < i.length; c++) {
    const h = i[c].object;
    h.count = n[c];
  }
};
f.prototype.BVHCullingLOD = function(r, t, e, n, i) {
  const { count: s, levels: o } = r, a = this._instancesArrayCount, c = this.onFrustumEnter;
  e ? this.bvh.frustumCulling(D, (h) => {
    const u = h.object;
    if (u < a && this.getVisibilityAt(u) && (!c || c(u, n, i))) {
      const l = this.getPositionAt(u).distanceToSquared(N);
      M.push(l, u);
    }
  }) : this.bvh.frustumCullingLOD(D, N, o, (h, u) => {
    const l = h.object;
    if (l < a && this.getVisibilityAt(l)) {
      if (u === null) {
        const d = this.getPositionAt(l).distanceToSquared(N);
        u = this.getObjectLODIndexForDistance(o, d);
      }
      (!c || c(l, n, i, u)) && (t[u][s[u]++] = l);
    }
  });
};
f.prototype.linearCullingLOD = function(r, t, e, n, i) {
  const { count: s, levels: o } = r;
  this.geometry.boundingSphere || this.geometry.computeBoundingSphere();
  const a = this._geometry.boundingSphere, c = a.radius, h = a.center, u = this._instancesArrayCount, l = h.x === 0 && h.y === 0 && h.z === 0, d = this.onFrustumEnter;
  tt.setFromProjectionMatrix(D);
  for (let p = 0; p < u; p++)
    if (this.getActiveAndVisibilityAt(p)) {
      if (l) {
        const m = this.getPositionAndMaxScaleOnAxisAt(p, S.center);
        S.radius = c * m;
      } else
        this.applyMatrixAtToSphere(p, S, h, c);
      if (tt.intersectsSphere(S))
        if (e) {
          if (!d || d(p, n, i)) {
            const m = S.center.distanceToSquared(N);
            M.push(m, p);
          }
        } else {
          const m = S.center.distanceToSquared(N), x = this.getObjectLODIndexForDistance(o, m);
          (!d || d(p, n, i, x)) && (t[x][s[x]++] = p);
        }
    }
};
f.prototype.clearTempInstance = function(r) {
  const t = this._tempInstance;
  return t.id = r, this.clearInstance(t);
};
f.prototype.clearTempInstancePosition = function(r) {
  const t = this._tempInstance;
  return t.id = r, t.position.set(0, 0, 0), t;
};
f.prototype.clearInstance = function(r) {
  return r.position.set(0, 0, 0), r.scale.set(1, 1, 1), r.quaternion.identity(), r;
};
f.prototype.updateInstances = function(r) {
  const t = this._instancesArrayCount, e = this.instances;
  for (let n = 0; n < t; n++) {
    if (!this.getActiveAt(n)) continue;
    const i = e ? e[n] : this.clearTempInstance(n);
    r(i, n), i.updateMatrix();
  }
  return this;
};
f.prototype.updateInstancesPosition = function(r) {
  const t = this._instancesArrayCount, e = this.instances;
  for (let n = 0; n < t; n++) {
    if (!this.getActiveAt(n)) continue;
    const i = e ? e[n] : this.clearTempInstancePosition(n);
    r(i, n), i.updateMatrixPosition();
  }
  return this;
};
f.prototype.createEntities = function(r) {
  const t = this._instancesArrayCount;
  if (!this.instances)
    this.instances = new Array(t);
  else if (this.instances.length < t)
    this.instances.length = t;
  else
    return this;
  const e = this.instances;
  for (let n = r; n < t; n++)
    e[n] || (e[n] = new Lt(this, n, this._allowsEuler));
  return this;
};
f.prototype.addInstances = function(r, t) {
  !t && this.bvh && console.warn("InstancedMesh2: if `computeBVH()` has already been called, it is better to valorize the instances in the `onCreation` callback for better performance.");
  const e = this._freeIds;
  if (e.length > 0) {
    let s = -1;
    const o = Math.min(e.length, r), a = e.length - o;
    for (let c = e.length - 1; c >= a; c--) {
      const h = e[c];
      h > s && (s = h), this.addInstance(h, t);
    }
    e.length -= o, r -= o, this._instancesArrayCount = Math.max(s + 1, this._instancesArrayCount);
  }
  const n = this._instancesArrayCount, i = n + r;
  this.setInstancesArrayCount(i);
  for (let s = n; s < i; s++)
    this.addInstance(s, t);
  return this;
};
f.prototype.addInstance = function(r, t) {
  this._instancesCount++, this.setActiveAndVisibilityAt(r, !0);
  const e = this.instances ? this.clearInstance(this.instances[r]) : this.clearTempInstance(r);
  t ? (t(e, r), e.updateMatrix()) : e.setMatrixIdentity(), this.bvh?.insert(r);
};
f.prototype.removeInstances = function(...r) {
  const t = this._freeIds, e = this.bvh;
  for (const n of r)
    n < this._instancesArrayCount && this.getActiveAt(n) && (this.setActiveAt(n, !1), t.push(n), e?.delete(n), this._instancesCount--);
  for (let n = this._instancesArrayCount - 1; n >= 0 && !this.getActiveAt(n); n--)
    this._instancesArrayCount--;
  return this;
};
f.prototype.clearInstances = function() {
  if (this._instancesCount = 0, this._instancesArrayCount = 0, this._freeIds.length = 0, this.bvh?.clear(), this.LODinfo)
    for (const r of this.LODinfo.objects)
      r.count = 0;
  return this;
};
f.prototype.getObjectLODIndexForDistance = function(r, t) {
  for (let e = r.length - 1; e > 0; e--) {
    const n = r[e], i = n.distance - n.distance * n.hysteresis;
    if (t >= i) return e;
  }
  return 0;
};
f.prototype.setFirstLODDistance = function(r) {
  if (this._parentLOD)
    throw new Error("Cannot create LOD for this InstancedMesh2.");
  return this.LODinfo || (this.LODinfo = { render: null, shadowRender: null, objects: [this] }), this.LODinfo.render || (this.LODinfo.render = {
    levels: [{ distance: r, hysteresis: 0, object: this }],
    // hysteresis is always 0 at first level
    count: [0]
  }), this;
};
f.prototype.addLOD = function(r, t, e = 0, n = 0) {
  if (this._parentLOD)
    throw new Error("Cannot create LOD for this InstancedMesh2.");
  if (!this.LODinfo?.render && e === 0)
    throw new Error('Cannot set distance to 0 for the first LOD. Call "setFirstLODDistance" method before use "addLOD".');
  return this.setFirstLODDistance(0), this.addLevel(this.LODinfo.render, r, t, e, n), this;
};
f.prototype.addShadowLOD = function(r, t = 0, e = 0) {
  if (this._parentLOD)
    throw new Error("Cannot create LOD for this InstancedMesh2.");
  this.LODinfo || (this.LODinfo = { render: null, shadowRender: null, objects: [this] }), this.LODinfo.shadowRender || (this.LODinfo.shadowRender = { levels: [], count: [] });
  const n = this.addLevel(this.LODinfo.shadowRender, r, null, t, e);
  return n.castShadow = !0, this.castShadow = !0, this;
};
f.prototype.addLevel = function(r, t, e, n, i) {
  const s = this.LODinfo.objects, o = r.levels;
  let a, c;
  n = n ** 2;
  const h = s.findIndex((u) => u.geometry === t);
  if (h === -1) {
    const u = { capacity: this._capacity, renderer: this._renderer };
    c = new f(t, e ?? new Yt(), u, this), c.frustumCulled = !1, this.patchLevel(c), s.push(c), this.add(c);
  } else
    c = s[h], e && (c.material = e);
  for (a = 0; a < o.length && !(n < o[a].distance); a++)
    ;
  return o.splice(a, 0, { distance: n, hysteresis: i, object: c }), r.count.push(0), c;
};
f.prototype.updateLevel = function(r, t, e, n) {
  if (!r) throw new Error("Render list is invalid.");
  const i = r.levels[t];
  if (!i) throw new Error("Cannot update an empty LOD.");
  if (e != null && !Number.isNaN(e)) {
    const s = e ** 2;
    i.distance = s;
  }
  return n != null && !Number.isNaN(n) && (i.hysteresis = n), this;
};
f.prototype.updateLOD = function(r, t, e) {
  const n = this?.LODinfo?.render;
  if (r === 0) throw new Error("Cannot change distance for LOD0. It is the main mesh and must stay at 0.");
  return this.updateLevel(n, r, t, e);
};
f.prototype.updateShadowLOD = function(r, t, e) {
  return this.updateLevel(this.LODinfo?.shadowRender, r, t, e);
};
f.prototype.updateAllLevels = function(r, t, e) {
  if (!r?.levels) throw new Error("Invalid LOD list.");
  const n = r.levels, i = this.LODinfo?.render === r, s = i ? 1 : 0;
  i && (n[0].distance = 0);
  const o = t?.length > 0;
  let a = [];
  o && (a = i && t[0] === 0 ? t.slice(1, Math.min(n.length, t.length)) : t.slice(0, Math.min(n.length - s, t.length)), a.every((h, u) => {
    if (u > 0 && h <= a[u - 1]) throw new Error(`LOD distances must be strictly increasing: d[${u - 1}]=${a[u - 1]} < d[${u}]=${h}`);
    return !0;
  }));
  const c = o ? a.length : n.length - s;
  for (let h = 0; h < c; h++) {
    const u = o ? a[h] : void 0, l = Array.isArray(e) ? e[h] : e;
    this.updateLevel(r, s + h, u, l);
  }
  return this;
};
f.prototype.updateAllLOD = function(r, t) {
  return this.updateAllLevels(this.LODinfo?.render, r, t);
};
f.prototype.updateAllShadowLOD = function(r, t) {
  return this.updateAllLevels(this.LODinfo?.shadowRender, r, t);
};
f.prototype.disposeLOD = function(r) {
  r.geometry.dispose();
  const t = r.material;
  if (Array.isArray(t)) for (const e of t) e.dispose();
  else t.dispose();
};
f.prototype.removeLOD = function(r, t = !0) {
  const e = this.LODinfo, n = e?.render;
  if (!n?.levels) throw new Error("Invalid LOD list.");
  const i = n.levels.length;
  if (r < 0 || r >= i) throw new Error("Level index OOB");
  if (i > 1 && r === 0) throw new Error("Cannot remove LOD0 while others exist");
  const [s] = n.levels.splice(r, 1);
  n.count?.splice?.(r, 1), n.levels.length <= 1 && (e.render = null);
  const o = s.object, a = this.LODinfo?.shadowRender;
  if (a?.levels && r < a.levels.length && (a.levels.splice(r, 1), a.count?.splice?.(r, 1), a.levels.length === 0 && (this.LODinfo.shadowRender = null)), t && o !== this)
    try {
      this.remove(o);
      const c = e.objects?.indexOf(o) ?? -1;
      c !== -1 && e.objects.splice(c, 1), this.disposeLOD(o);
    } catch (c) {
      console.error(c);
    }
  return this;
};
f.prototype.patchLevel = function(r) {
  Object.defineProperty(r, "renderOrder", {
    get() {
      return this._parentLOD.renderOrder;
    }
  }), Object.defineProperty(r, "_lastRenderInfo", {
    get() {
      return this._parentLOD._lastRenderInfo;
    }
  }), Object.defineProperty(r, "matricesTexture", {
    get() {
      return this._parentLOD.matricesTexture;
    }
  }), Object.defineProperty(r, "colorsTexture", {
    get() {
      return this._parentLOD.colorsTexture;
    }
  }), Object.defineProperty(r, "uniformsTexture", {
    get() {
      return this._parentLOD.uniformsTexture;
    }
  }), Object.defineProperty(r, "morphTexture", {
    // TODO check if it's correct
    get() {
      return this._parentLOD.morphTexture;
    }
  }), Object.defineProperty(r, "boneTexture", {
    get() {
      return this._parentLOD.boneTexture;
    }
  }), Object.defineProperty(r, "skeleton", {
    get() {
      return this._parentLOD.skeleton;
    }
  }), Object.defineProperty(r, "bindMatrixInverse", {
    get() {
      return this._parentLOD.bindMatrixInverse;
    }
  }), Object.defineProperty(r, "bindMatrix", {
    get() {
      return this._parentLOD.bindMatrix;
    }
  });
};
const de = new ut();
f.prototype.getMorphAt = function(r, t = de) {
  const e = t.morphTargetInfluences, n = this.morphTexture.source.data.data, i = e.length + 1, s = r * i + 1;
  for (let o = 0; o < e.length; o++)
    e[o] = n[s + o];
  return t;
};
f.prototype.setMorphAt = function(r, t) {
  const e = t.morphTargetInfluences, n = e.length + 1;
  this.morphTexture === null && !this._parentLOD && (this.morphTexture = new at(new Float32Array(n * this._capacity), n, this._capacity, ht, ct));
  const i = this.morphTexture.source.data.data;
  let s = 0;
  for (const c of e)
    s += c;
  const o = this._geometry.morphTargetsRelative ? 1 : 1 - s, a = n * r;
  i[a] = o, i.set(e, a + 1), this.morphTexture.needsUpdate = !0;
};
const rt = [], et = new ut(), pe = new Ht(), wt = new T(), Ct = new T(), St = new z(), Mt = new nt();
f.prototype.raycast = function(r, t) {
  if (this._parentLOD || !this.material || this._instancesArrayCount === 0 || !this.instanceIndex) return;
  et.geometry = this._geometry, et.material = this.material;
  const e = r.ray, n = r.near, i = r.far;
  St.copy(this.matrixWorld).invert(), Ct.setFromMatrixScale(this.matrixWorld), wt.copy(r.ray.direction).multiply(Ct);
  const s = wt.length();
  r.ray = pe.copy(r.ray).applyMatrix4(St), r.near /= s, r.far /= s, this.raycastInstances(r, t), r.ray = e, r.near = n, r.far = i;
};
f.prototype.raycastInstances = function(r, t) {
  if (this.bvh)
    this.bvh.raycast(r, (e) => this.checkObjectIntersection(r, e, t));
  else {
    if (this.boundingSphere === null && this.computeBoundingSphere(), Mt.copy(this.boundingSphere), !r.ray.intersectsSphere(Mt)) return;
    const e = this.instanceIndex.array, i = this.raycastOnlyFrustum && this._perObjectFrustumCulled ? this.count : this._instancesArrayCount;
    for (let s = 0; s < i; s++)
      this.checkObjectIntersection(r, e[s], t);
  }
};
f.prototype.checkObjectIntersection = function(r, t, e) {
  if (!(t > this._instancesArrayCount || !this.getActiveAndVisibilityAt(t))) {
    this.getMatrixAt(t, et.matrixWorld), et.raycast(r, rt);
    for (const n of rt)
      n.instanceId = t, n.object = this, e.push(n);
    rt.length = 0;
  }
};
f.prototype.initSkeleton = function(r, t = !0) {
  if (r && this.skeleton !== r && !this._parentLOD) {
    const e = r.bones;
    if (this.skeleton = r, this.bindMatrix = new z(), this.bindMatrixInverse = new z(), this.boneTexture = new J(Float32Array, 4, 4 * e.length, this._capacity), t)
      for (const n of e)
        n.matrixAutoUpdate = !1, n.matrixWorldAutoUpdate = !1;
    this.materialsNeedsUpdate();
  }
};
f.prototype.setBonesAt = function(r, t = !0, e) {
  const n = this.skeleton;
  if (!n)
    throw new Error('"setBonesAt" cannot be called before "initSkeleton"');
  const i = n.bones, s = n.boneInverses;
  for (let o = 0, a = i.length; o < a; o++) {
    const c = i[o];
    t && (e?.has(c.name) || c.updateMatrix(), c.matrixWorld.multiplyMatrices(c.parent.matrixWorld, c.matrix)), this.multiplyBoneMatricesAt(r, o, c.matrixWorld, s[o]);
  }
  this.boneTexture.enqueueUpdate(r);
};
f.prototype.multiplyBoneMatricesAt = function(r, t, e, n) {
  const i = (r * this.skeleton.bones.length + t) * 16, s = e.elements, o = n.elements, a = this.boneTexture._data, c = s[0], h = s[4], u = s[8], l = s[12], d = s[1], p = s[5], m = s[9], x = s[13], g = s[2], y = s[6], w = s[10], I = s[14], O = s[3], L = s[7], U = s[11], C = s[15], A = o[0], b = o[4], v = o[8], B = o[12], F = o[1], E = o[5], P = o[9], $ = o[13], G = o[2], q = o[6], V = o[10], W = o[14], k = o[3], K = o[7], Y = o[11], H = o[15];
  a[i + 0] = c * A + h * F + u * G + l * k, a[i + 4] = c * b + h * E + u * q + l * K, a[i + 8] = c * v + h * P + u * V + l * Y, a[i + 12] = c * B + h * $ + u * W + l * H, a[i + 1] = d * A + p * F + m * G + x * k, a[i + 5] = d * b + p * E + m * q + x * K, a[i + 9] = d * v + p * P + m * V + x * Y, a[i + 13] = d * B + p * $ + m * W + x * H, a[i + 2] = g * A + y * F + w * G + I * k, a[i + 6] = g * b + y * E + w * q + I * K, a[i + 10] = g * v + y * P + w * V + I * Y, a[i + 14] = g * B + y * $ + w * W + I * H, a[i + 3] = O * A + L * F + U * G + C * k, a[i + 7] = O * b + L * E + U * q + C * K, a[i + 11] = O * v + L * P + U * V + C * Y, a[i + 15] = O * B + L * $ + U * W + C * H;
};
f.prototype.getUniformAt = function(r, t, e) {
  if (!this.uniformsTexture)
    throw new Error(`Before get/set uniform, it's necessary to use "initUniformsPerInstance".`);
  return this.uniformsTexture.getUniformAt(r, t, e);
};
f.prototype.setUniformAt = function(r, t, e) {
  if (!this.uniformsTexture)
    throw new Error(`Before get/set uniform, it's necessary to use "initUniformsPerInstance".`);
  this.uniformsTexture.setUniformAt(r, t, e), this.uniformsTexture.enqueueUpdate(r);
};
f.prototype.initUniformsPerInstance = function(r) {
  if (!this._parentLOD) {
    const { channels: t, pixelsPerInstance: e, uniformMap: n, fetchInFragmentShader: i } = this.getUniformSchemaResult(r);
    this.uniformsTexture = new J(Float32Array, t, e, this._capacity, n, i), this.materialsNeedsUpdate();
  }
};
f.prototype.getUniformSchemaResult = function(r) {
  let t = 0;
  const e = /* @__PURE__ */ new Map(), n = [], i = r.vertex ?? {}, s = r.fragment ?? {};
  let o = !0;
  for (const u in i) {
    const l = i[u], d = this.getUniformSize(l);
    t += d, n.push({ name: u, type: l, size: d }), o = !1;
  }
  for (const u in s)
    if (!i[u]) {
      const l = s[u], d = this.getUniformSize(l);
      t += d, n.push({ name: u, type: l, size: d });
    }
  n.sort((u, l) => l.size - u.size);
  const a = [];
  for (const { name: u, size: l, type: d } of n) {
    const p = this.getUniformOffset(l, a);
    e.set(u, { offset: p, size: l, type: d });
  }
  const c = Math.ceil(t / 4);
  return { channels: Math.min(t, 4), pixelsPerInstance: c, uniformMap: e, fetchInFragmentShader: o };
};
f.prototype.getUniformOffset = function(r, t) {
  if (r < 4) {
    for (let n = 0; n < t.length; n++)
      if (t[n] + r <= 4) {
        const i = n * 4 + t[n];
        return t[n] += r, i;
      }
  }
  const e = t.length * 4;
  for (; r > 0; r -= 4)
    t.push(r);
  return e;
};
f.prototype.getUniformSize = function(r) {
  switch (r) {
    case "float":
      return 1;
    case "vec2":
      return 2;
    case "vec3":
      return 3;
    case "vec4":
      return 4;
    case "mat3":
      return 9;
    case "mat4":
      return 16;
    default:
      throw new Error(`Invalid uniform type: ${r}`);
  }
};
var me = `#ifdef USE_INSTANCING_INDIRECT\r
  attribute uint instanceIndex;\r
  uniform highp sampler2D matricesTexture;  

  mat4 getInstancedMatrix() {\r
    int size = textureSize( matricesTexture, 0 ).x;\r
    int j = int( instanceIndex ) * 4;\r
    int x = j % size;\r
    int y = j / size;\r
    vec4 v1 = texelFetch( matricesTexture, ivec2( x, y ), 0 );\r
    vec4 v2 = texelFetch( matricesTexture, ivec2( x + 1, y ), 0 );\r
    vec4 v3 = texelFetch( matricesTexture, ivec2( x + 2, y ), 0 );\r
    vec4 v4 = texelFetch( matricesTexture, ivec2( x + 3, y ), 0 );\r
    return mat4( v1, v2, v3, v4 );\r
  }\r
#endif`, xe = `#ifdef USE_INSTANCING_COLOR_INDIRECT\r
  uniform highp sampler2D colorsTexture;

  vec4 getColorTexture() {\r
    int size = textureSize( colorsTexture, 0 ).x;\r
    int j = int( instanceIndex );\r
    int x = j % size;\r
    int y = j / size;\r
    return texelFetch( colorsTexture, ivec2( x, y ), 0 );\r
  }\r
#endif`, _e = `#ifdef USE_INSTANCING_INDIRECT\r
  mat4 instanceMatrix = getInstancedMatrix();

  #ifdef USE_INSTANCING_COLOR_INDIRECT\r
    vColor *= getColorTexture();\r
  #endif\r
#endif`, ge = `#ifdef USE_INSTANCING_COLOR_INDIRECT\r
  #ifdef USE_VERTEX_COLOR\r
    vColor = vec4( color );\r
  #else\r
    vColor = vec4( 1.0 );\r
  #endif\r
#endif`, ye = `#ifdef USE_SKINNING\r
  uniform mat4 bindMatrix;\r
  uniform mat4 bindMatrixInverse;\r
  uniform highp sampler2D boneTexture;

  #ifdef USE_INSTANCING_SKINNING\r
    uniform int bonesPerInstance;\r
  #endif

  mat4 getBoneMatrix( const in float i ) {\r
    int size = textureSize( boneTexture, 0 ).x;

    #ifdef USE_INSTANCING_SKINNING\r
      int j = ( bonesPerInstance * int( instanceIndex ) + int( i ) ) * 4;\r
    #else\r
      int j = int( i ) * 4;\r
    #endif

    int x = j % size;\r
    int y = j / size;\r
    vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );\r
    vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );\r
    vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );\r
    vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );\r
    return mat4( v1, v2, v3, v4 );\r
  }\r
#endif`;
_.instanced_pars_vertex = me;
_.instanced_color_pars_vertex = xe;
_.instanced_vertex = _e;
_.instanced_color_vertex = ge;
function lt(r) {
  return r.replace("#ifdef USE_INSTANCING", "#if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT");
}
_.project_vertex = lt(_.project_vertex);
_.worldpos_vertex = lt(_.worldpos_vertex);
_.defaultnormal_vertex = lt(_.defaultnormal_vertex);
_.batching_pars_vertex = _.batching_pars_vertex.concat(`
#include <instanced_pars_vertex>`);
_.color_pars_vertex = _.color_pars_vertex.concat(`
#include <instanced_color_pars_vertex>`);
_.batching_vertex = _.batching_vertex.concat(`
#include <instanced_vertex>`);
_.skinning_pars_vertex = ye;
_.morphinstance_vertex && (_.morphinstance_vertex = _.morphinstance_vertex.replaceAll("gl_InstanceID", "instanceIndex"));
function Ie(r, t = {}) {
  if (r.isSkinnedMesh) return e(r);
  if (r.isInstancedMesh) return n(r);
  return new f(r.geometry, r.material, t);
  function e(i) {
    const s = new f(i.geometry.clone(), i.material, t);
    return s.initSkeleton(i.skeleton), s;
  }
  function n(i) {
    t.capacity = Math.max(i.count, t.capacity);
    const s = i.geometry.clone();
    s.deleteAttribute("instanceIndex"), u();
    const o = new f(s, i.material, t);
    return o.position.copy(i.position), o.quaternion.copy(i.quaternion), o.scale.copy(i.scale), a(), c(), h(), o;
    function a() {
      o.setInstancesArrayCount(i.count), o._instancesCount = i.count, o.availabilityArray.fill(!0, 0, i.count * 2);
    }
    function c() {
      o.matricesTexture.image.data.set(i.instanceMatrix.array);
    }
    function h() {
      if (i.instanceColor) {
        o.initColorsTexture();
        const l = i.instanceColor.array, d = o.colorsTexture.image.data;
        for (let p = 0, m = 0; p < l.length; p += 3, m += 4)
          d[m] = l[p], d[m + 1] = l[p + 1], d[m + 2] = l[p + 2], d[m + 3] = 1;
      }
    }
    function u() {
      const l = s.attributes;
      for (const d in l)
        l[d].isInstancedBufferAttribute && console.warn(`InstancedBufferAttribute "${d}" is not supported. It will be ignored.`);
    }
  }
}
export {
  ee as GLInstancedBufferAttribute,
  Lt as InstancedEntity,
  f as InstancedMesh2,
  te as InstancedMeshBVH,
  le as InstancedRenderList,
  J as SquareDataTexture,
  Ie as createInstancedMesh2From,
  Te as createRadixSort,
  oe as getSquareTextureInfo,
  Ut as getSquareTextureSize,
  se as patchProperties,
  lt as patchShader,
  Bt as sortOpaque,
  Dt as sortTransparent,
  re as unpatchProperties
};
//# sourceMappingURL=index.js.map
