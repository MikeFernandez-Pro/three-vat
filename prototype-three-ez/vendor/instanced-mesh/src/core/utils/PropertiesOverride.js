// TODO: Fix if multiple renderers?
/**
 * To prevent three.js from using the same shader between InstancedMesh and InstancedMesh2 if the material is the same
 * (especially with `scene.overrideMaterial`), the `WebGLProperties` object is temporarily patched before each render of an InstancedMesh2.
 */
let propertiesGetBase = null; // this can become const
let propertiesGet = null;
const propertiesGetMap = {};
function propertiesGetCallback(object) {
    return propertiesGet.get(object)?.() ?? propertiesGetBase(object);
}
function addProperties(material) {
    if (propertiesGet.has(material))
        return;
    const materialProperties = {};
    propertiesGet.set(material, () => {
        // Fix pointLight bug. Related: https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgl/WebGLShadowMap.js#L333
        if (material.isMeshDistanceMaterial) {
            const materialPropertiesBase = propertiesGetBase(material);
            materialProperties.light = materialPropertiesBase.light;
        }
        return materialProperties;
    });
}
export function patchProperties(obj, renderer, material) {
    const properties = renderer.properties;
    propertiesGetBase = properties.get;
    const key = `${!!obj.colorsTexture}_${obj._useOpacity}_${!!obj.boneTexture}_${!!obj.uniformsTexture}`;
    propertiesGetMap[key] ?? (propertiesGetMap[key] = new WeakMap());
    propertiesGet = propertiesGetMap[key];
    properties.get = propertiesGetCallback;
    addProperties(material);
}
export function unpatchProperties(renderer) {
    renderer.properties.get = propertiesGetBase;
}
//# sourceMappingURL=PropertiesOverride.js.map