// The frame timings every page keeps on screen: FPS, CPU, GPU and draw calls,
// top-left, as three's own examples keep theirs (ADR-0024).
//
// stats-gl — Renaud Rohlinger's vanilla counterpart of r3f-perf — on both
// renderers: it times the GPU through `EXT_disjoint_timer_query_webgl2` on
// WebGL and through timestamp queries on WebGPU, and reads whichever renderer
// it is handed. The draw-call panel is this file's, because stats-gl has none
// and the count is the number every crowd page's argument rests on: it is on
// screen at rest beside the timings, and not only where the HUD spells it out.
//
// Shared by both renderers' pages rather than written twice, like the crowd
// layout and the bookkeeping beside it (ADR-0011's exception is the wiring of
// the decode, and this touches none of it).
import Stats from "stats-gl";

/**
 * What both renderers report a frame's draw count as — `calls` on WebGL,
 * `drawCalls` on WebGPU. The one asymmetry in `renderer.info` the pages meet.
 */
export interface FrameStatsRenderer {
  info: { render: { calls?: number; drawCalls?: number } };
}

export interface FrameStats {
  /** First thing in the frame. */
  begin(): void;
  /** Once the frame is rendered: closes the timings and reads the draw count. */
  end(): void;
}

/** The frame just drawn's draw calls, under whichever name this renderer keeps them. */
export function drawCallsOf(renderer: FrameStatsRenderer): number {
  const { render } = renderer.info;
  return render.drawCalls ?? render.calls ?? 0;
}

/**
 * Build the strip and put it on screen, top-left. Awaited because stats-gl's
 * GPU timing needs the renderer's context — on WebGPU, its device — and asks
 * for it asynchronously.
 */
export async function createFrameStats(renderer: FrameStatsRenderer): Promise<FrameStats> {
  const stats = new Stats({ trackGPU: true });
  stats.dom.style.cssText = "position:fixed;top:0;left:0"; // where three's examples put Stats
  // Named, like every other thing on the HUD (#hud, #info, #draw-count,
  // #texture-panel), so something outside the page can address it. The hero
  // capture is the one caller: it photographs this page through a software
  // rasteriser, and a strip reading 11 FPS is a measurement of SwiftShader
  // advertising the library (release/hero/capture.mjs).
  stats.dom.id = "frame-stats";
  document.body.appendChild(stats.dom);
  await stats.init(renderer);

  // The panel's graph is scaled to the most draw calls seen, so a crowd that
  // grows draws a rising bar rather than one clipped at whatever the first
  // frame cost.
  const draws = new Stats.Panel("DRAWS", "#f8f", "#202");
  stats.addPanel(draws);
  let most = 1;

  return {
    begin: () => stats.begin(),
    end() {
      stats.end();
      stats.update();
      const calls = drawCallsOf(renderer);
      most = Math.max(most, calls);
      draws.update(calls, most, 0);
    },
  };
}
