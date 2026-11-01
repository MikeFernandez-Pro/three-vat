// PROTOTYPE: the 2D pages' rats drawn all at once (2026-10-16), instanced on a
// WebGL 2 canvas laid under the page's own: one quad a rat, an ellipse cut out
// of it in the fragment shader, set from the swarm's positions and headings
// as they stand each frame. Drawing each rat as its own canvas path cost too
// much once the sewers held 8000.

const VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec3 rat;
uniform vec2 view;
uniform float scale;
uniform vec2 size;
uniform vec2 extent;
out vec2 v;
void main() {
  v = corner;
  float c = cos(rat.z);
  float s = sin(rat.z);
  vec2 local = corner * extent;
  vec2 world = rat.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 px = (world - view) * scale + size * 0.5;
  gl_Position = vec4(px.x / size.x * 2.0 - 1.0, 1.0 - px.y / size.y * 2.0, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v;
uniform vec4 color;
out vec4 outColor;
void main() {
  if (dot(v, v) > 1.0) discard;
  outColor = color;
}`

/** Where the page looks: the point of the plan at the canvas's middle, m, and how many CSS pixels a metre. */
export interface PlanView {
  x: number
  z: number
  scale: number
}

/** What the layer reads of a swarm: how many rats, and each one's x, z and heading, x east and z south. */
export interface RatsToDraw {
  count: number
  x: ArrayLike<number>
  z: ArrayLike<number>
  heading: ArrayLike<number>
}

export class RatLayer {
  private readonly gl: WebGL2RenderingContext
  private readonly data: Float32Array
  private readonly buffer: WebGLBuffer
  private readonly u: Record<'view' | 'scale' | 'size' | 'extent' | 'color', WebGLUniformLocation | null>

  constructor(
    readonly canvas: HTMLCanvasElement,
    capacity: number,
  ) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: true })
    if (!gl) throw new Error('WebGL 2 is needed to draw the rats')
    this.gl = gl
    const program = gl.createProgram()!
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'rat shader')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'rat program')
    gl.useProgram(program)
    this.u = {
      view: gl.getUniformLocation(program, 'view'),
      scale: gl.getUniformLocation(program, 'scale'),
      size: gl.getUniformLocation(program, 'size'),
      extent: gl.getUniformLocation(program, 'extent'),
      color: gl.getUniformLocation(program, 'color'),
    }
    gl.bindVertexArray(gl.createVertexArray())
    // The quad's corners, shared by every rat.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    // Each rat's x, z and heading, one a quad.
    this.data = new Float32Array(capacity * 3)
    this.buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(1, 1)
  }

  /**
   * The rats drawn over a clear canvas, `width` CSS pixels by `height` at `dpr`: each an ellipse `length` m long and
   * `width` m across, of `color` (r, g, b, 0 to 1). Below `least` pixels long, none are drawn.
   */
  draw(rats: RatsToDraw, view: PlanView, size: { width: number; height: number; dpr: number }, rat: { length: number; width: number; least: number }, color: [number, number, number]): void {
    const { gl, canvas, data, u } = this
    const w = Math.round(size.width * size.dpr)
    const h = Math.round(size.height * size.dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (rat.length * view.scale < rat.least || rats.count === 0) return
    const n = Math.min(rats.count, data.length / 3)
    for (let i = 0; i < n; i++) {
      data[3 * i] = rats.x[i]!
      data[3 * i + 1] = rats.z[i]!
      data[3 * i + 2] = rats.heading[i]!
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 3)
    gl.uniform2f(u.view, view.x, view.z)
    gl.uniform1f(u.scale, view.scale)
    gl.uniform2f(u.size, size.width, size.height)
    gl.uniform2f(u.extent, rat.length / 2, rat.width / 2)
    gl.uniform4f(u.color, color[0], color[1], color[2], 1)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
  }
}
