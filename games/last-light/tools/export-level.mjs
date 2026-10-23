// `pnpm export-level [out.glb]`: the woods as a GLB for Blender, default
// `exports/woods.glb`. Vite loads export-level.ts and the game's modules as
// they are, in Node; the exporter reads its blobs through a stand-in
// FileReader, which Node lacks.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer
      this.onloadend?.()
    })
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`
      this.onloadend?.()
    })
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, process.argv[2] ?? 'exports/woods.glb')
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  resolve: { dedupe: ['three'] },
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
})
try {
  const { buildWoods } = await server.ssrLoadModule('/tools/export-level.ts')
  const scene = buildWoods()
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true })
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, Buffer.from(glb))
  let meshes = 0
  scene.traverse((o) => (meshes += o.isMesh ? 1 : 0))
  console.log(`${out}: ${meshes} meshes, ${(glb.byteLength / 1e6).toFixed(1)} MB`)
} finally {
  await server.close()
}
