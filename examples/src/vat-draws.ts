// The draw calls a crowd costs, and only the crowd's: the HUD's "VAT draw
// calls", beside the frame strip's DRAWS, which is every draw in the frame.
//
// `renderer.info` counts the floor, the marks and whatever else the studio
// holds, and a reader told "3 draw calls" for one soldier on a floor cannot
// tell which of them the crowd is. So the count is taken where the renderer
// takes its own, one draw at a time, and kept only for the objects the page
// names — split by pass, because the shadow map draws every caster again
// and that second draw is the crowd's cost too.
//
// Shared by both renderers' pages, like the frame strip: the one asymmetry is
// where each renderer can be caught drawing.
//
// - WebGL: `renderBufferDirect` is every draw, and the shadow map calls it
//   with no scene. The count is the renderer's own, before and after, so a
//   multi-draw is what three says it is.
// - WebGPU: `info.update` is handed each draw's object — and the shadow pass
//   is rendered *inside* the main pass, so a before-and-after would take the
//   floor's shadow draw for the crowd's. The pass is read off the scene: the
//   shadow map draws it under a shadow-pass override material.

/** A frame's VAT draws, by pass. */
export interface VATDraws {
  main: number;
  shadow: number;
}

interface WebGLRendererLike {
  isWebGLRenderer: true;
  info: { render: { calls: number } };
  renderBufferDirect(...args: unknown[]): void;
}

interface WebGPURendererLike {
  info: { update(object: unknown, ...rest: unknown[]): void };
}

interface SceneLike {
  overrideMaterial: unknown;
}

/**
 * Start counting the draws of every object `isVAT` says is the crowd's, on
 * this renderer and scene. Returns the frame's count so far, and starts the
 * next: call it once a frame, after `render`.
 */
export function countVATDraws(
  renderer: WebGLRendererLike | WebGPURendererLike,
  scene: SceneLike,
  isVAT: (object: unknown) => boolean,
): () => VATDraws {
  let main = 0;
  let shadow = 0;

  if ("isWebGLRenderer" in renderer && renderer.isWebGLRenderer) {
    const direct = renderer.renderBufferDirect;
    const { render } = renderer.info;
    renderer.renderBufferDirect = function (this: unknown, ...args: unknown[]) {
      // ( camera, scene, geometry, material, object, group )
      if (!isVAT(args[4])) return direct.apply(this, args);
      const before = render.calls;
      direct.apply(this, args);
      if (args[1] === null) shadow += render.calls - before;
      else main += render.calls - before;
    };
  } else {
    const { info } = renderer as WebGPURendererLike;
    const update = info.update;
    info.update = function (this: unknown, object: unknown, ...rest: unknown[]) {
      if (isVAT(object)) {
        const override = scene.overrideMaterial as { isShadowPassMaterial?: boolean } | null;
        if (override?.isShadowPassMaterial === true) shadow++;
        else main++;
      }
      return update.call(this, object, ...rest);
    };
  }

  return () => {
    const frame = { main, shadow };
    main = shadow = 0;
    return frame;
  };
}

/** `1 (+1 shadow)`, or `1` for a crowd that casts none. */
export function formatVATDraws({ main, shadow }: VATDraws): string {
  return shadow > 0 ? `${main} (+${shadow} shadow)` : `${main}`;
}
