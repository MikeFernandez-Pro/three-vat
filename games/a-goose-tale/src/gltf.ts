// The loader for the game's models: they are packed with meshopt
// (EXT_meshopt_compression), their normals, uvs, colours and weights stored as
// normalised integers, so every GLTFLoader here needs the decoder.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/** A GLTFLoader that reads the game's packed models. */
export function modelLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
}
