export function vec3ToArray(vector, target) {
    target[0] = vector.x;
    target[1] = vector.y;
    target[2] = vector.z;
    return target;
}
export function box3ToArray(box, target) {
    const min = box.min;
    const max = box.max;
    target[0] = min.x;
    target[1] = max.x;
    target[2] = min.y;
    target[3] = max.y;
    target[4] = min.z;
    target[5] = max.z;
    return target;
}
//# sourceMappingURL=conversionUtils.js.map