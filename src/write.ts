// Writing a baked file (ADR-0035): the `.vat.glb` the bake command writes
// (ADR-0034), from a VAT baked anywhere — on the page, in a worker, or from a
// subtree no file ever held. A subpath of its own because the writer reaches
// three's `GLTFExporter`, which no page that only bakes or loads should pay
// for; the core entry point reads a baked file and never writes one.
//
// The images a baked file carries are the source file's own bytes, copied
// through (ADR-0034): `readSourceImages` reads them out of the glTF load the
// VAT was baked from, and `writeBakedFile` takes what it read. A VAT with no
// textures needs neither.

export { writeBakedFile } from './write-vat.js'
export { readSourceImages } from './write-materials.js'
export type { ReadImageFile, SourceImage, SourceImages, SourceTexture } from './write-materials.js'
