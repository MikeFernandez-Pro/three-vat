// Append animation clips to a .glb, keeping every byte of it that was there:
// the new keyframes go on the end of its binary chunk, and the JSON gains the
// accessors, buffer views and animations that point at them. A clip of the
// same name is replaced. Used by the script that authors clips for the
// examples' characters (author-samba.mjs).

/**
 * A clip to append: keyframe `times`, in seconds, and the channels keyed at
 * them, each a node index, the path it drives (`rotation`, `translation`,
 * `scale`, `weights`) and its values, one entry per time (per morph target
 * per time, for `weights`), flattened.
 *
 * @typedef {{ name: string, times: number[], channels: { node: number, path: string, values: number[] }[] }} Clip
 */

const TYPES = { rotation: "VEC4", translation: "VEC3", scale: "VEC3", weights: "SCALAR" };
const WIDTH = { VEC4: 4, VEC3: 3, SCALAR: 1 };

/** The JSON of a .glb, parsed. */
export function readJson(bytes) {
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
}

/**
 * Parse a .glb in Node to pose it, its textures left out: GLTFLoader decodes
 * images through the browser, and a pose needs none. The bytes that are
 * written back are always the original's, never these.
 *
 * @param {Buffer} bytes
 */
export async function loadForPosing(bytes) {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const json = readJson(bytes);
  delete json.images;
  delete json.textures;
  delete json.samplers;
  // A material is kept by name alone: its textures hide in extensions too.
  json.materials = (json.materials ?? []).map(({ name }) => ({ name }));
  const binAt = 20 + bytes.readUInt32LE(12);
  const glb = rewrap(json, bytes.subarray(binAt + 8, binAt + 8 + bytes.readUInt32LE(binAt)));
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "");
}

/** A .glb of `json` and `bin`, `bin` already padded. */
function rewrap(json, bin) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.write("glTF", 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + jsonPadded.length + 8 + bin.length, 8);
  head.writeUInt32LE(jsonPadded.length, 12);
  head.write("JSON", 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.write("BIN\0", 4);
  return Buffer.concat([head, jsonPadded, binHead, bin]);
}

/**
 * The .glb `bytes` with `clips` appended, as a new Buffer.
 *
 * @param {Buffer} bytes
 * @param {Clip[]} clips
 */
export function appendClips(bytes, clips) {
  const json = readJson(bytes);
  const binAt = 20 + bytes.readUInt32LE(12);
  const binLength = json.buffers[0].byteLength;
  const chunks = [bytes.subarray(binAt + 8, binAt + 8 + binLength)];
  let offset = binLength;

  function accessor(values, type, withRange = false) {
    const data = new Float32Array(values);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) chunks.push(Buffer.alloc(pad));
    offset += pad;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength });
    chunks.push(Buffer.from(data.buffer));
    offset += data.byteLength;
    const entry = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: values.length / WIDTH[type], type };
    if (withRange) Object.assign(entry, { min: [Math.min(...values)], max: [Math.max(...values)] });
    json.accessors.push(entry);
    return json.accessors.length - 1;
  }

  for (const clip of clips) {
    json.animations = (json.animations ?? []).filter((a) => a.name !== clip.name);
    const input = accessor(clip.times, "SCALAR", true);
    const animation = { name: clip.name, channels: [], samplers: [] };
    for (const { node, path, values } of clip.channels) {
      animation.samplers.push({ input, output: accessor(values, TYPES[path]), interpolation: "LINEAR" });
      animation.channels.push({ sampler: animation.samplers.length - 1, target: { node, path } });
    }
    json.animations.push(animation);
  }

  const bin = Buffer.concat(chunks);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  json.buffers[0].byteLength = binPadded.length;
  const text = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(body.length, 0);
    head.write(type, 4);
    return Buffer.concat([head, body]);
  };
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
  return Buffer.concat([header, chunk("JSON", jsonPadded), chunk("BIN\0", binPadded)]);
}

/**
 * Sample a clip off a posed scene: `frame(i)` poses it for frame `i` of
 * `frames`, at `fps`, and each of `nodes` (node index to object) is keyed
 * from its local rotation and translation.
 */
export function sampleClip(name, frames, fps, nodes, frame) {
  const times = [];
  const channels = [...nodes].flatMap(([node, object]) => [
    { node, path: "rotation", values: [], read: () => object.quaternion.toArray() },
    { node, path: "translation", values: [], read: () => object.position.toArray() },
  ]);
  for (let i = 0; i < frames; i++) {
    times.push(i / fps);
    frame(i);
    for (const channel of channels) channel.values.push(...channel.read());
  }
  return { name, times, channels: channels.map(({ node, path, values }) => ({ node, path, values })) };
}
