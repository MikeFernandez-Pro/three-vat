// A texture set's maps: its colour map fetched only once some of it shows.
import { describe, expect, it } from 'vitest'
import { DataTexture, type Texture } from 'three/webgpu'
import { NO_COLOUR, NO_NORMALS, setLayer, type SetNodes } from './texturesets'

/** A layer on fresh nodes, its loader answering at once with a texture named by its url, and the urls asked for. */
function layer() {
  const fetched: string[] = []
  const load = (url: string) => {
    fetched.push(url)
    const map = new DataTexture(new Uint8Array(4), 1, 1)
    map.name = url
    return Promise.resolve<Texture>(map)
  }
  const nodes: SetNodes = { colours: [{ value: NO_COLOUR }], normals: [{ value: NO_NORMALS }], textured: { value: 0 }, plain: { value: 0 } }
  return { lay: setLayer<'none' | 'bark_05'>('./textures/bark', nodes, load), nodes, fetched }
}
const settled = () => new Promise((done) => setTimeout(done))

describe('a texture set', () => {
  it('laid all plain, fetches its normal map alone', async () => {
    const { lay, nodes, fetched } = layer()
    lay('bark_05', 1)
    await settled()
    expect(fetched).toEqual(['./textures/bark/bark_05/normal.webp'])
    expect(nodes.normals[0]!.value.name).toBe('./textures/bark/bark_05/normal.webp')
    expect(nodes.colours[0]!.value).toBe(NO_COLOUR)
    expect(nodes.textured.value).toBe(1)
    expect(nodes.plain.value).toBe(1)
  })

  it('fetches its colour map once some of it shows, the plain colour all until it is in', async () => {
    const { lay, nodes, fetched } = layer()
    lay('bark_05', 1)
    await settled()
    lay('bark_05', 0.4)
    expect(nodes.plain.value).toBe(1)
    await settled()
    expect(fetched).toEqual(['./textures/bark/bark_05/normal.webp', './textures/bark/bark_05/color.webp'])
    expect(nodes.colours[0]!.value.name).toBe('./textures/bark/bark_05/color.webp')
    expect(nodes.plain.value).toBe(0.4)
    lay('bark_05', 0.7)
    expect(nodes.plain.value).toBe(0.7)
  })

  it('takes the share last asked for when its colour map comes in', async () => {
    const { lay, nodes } = layer()
    lay('bark_05', 0.2)
    lay('bark_05', 0.6)
    await settled()
    expect(nodes.plain.value).toBe(0.6)
  })

  it('with none, fetches nothing and lays no relief', async () => {
    const { lay, nodes, fetched } = layer()
    lay('bark_05', 0)
    await settled()
    lay('none', 0)
    await settled()
    expect(fetched).toHaveLength(2)
    expect(nodes.normals[0]!.value).toBe(NO_NORMALS)
    expect(nodes.textured.value).toBe(0)
  })
})
