// The reserved rows, drawn: one cell per row of the playback texture, laid out
// in the same order the field on the ground is (`spawning.ts`), so a cell found
// in one is found in the other.
//
// This is the batched pages' evidence for the thing a crowd that spawns gets
// wrong. A lit cell is a live instance and its colour is the clip that row
// holds; a dim cell is a row whose instance has died, still holding what it was
// playing. Watch a cell go dim and come back a different colour, look at the
// same place on the ground, and the instance standing there is doing the thing
// the cell says — which is what "the recycled row was rewritten" looks like
// from the outside. Were it not rewritten, the cell would come back the colour
// it went dim.
//
// Renderer-free and library-free on purpose: it draws what the page wrote, and
// the crowd shows what the GPU plays. The page is right when the two agree, and
// a visitor can check that by looking — which is the whole design.
import { COLUMNS } from "./spawning.js";
import type { Roster } from "./spawning.js";

/** The clip colours, in clip-table order — the three bands a spawn rotates through. */
const CLIP_COLORS = ["#7fd4ff", "#ffd166", "#ff7b7b"];

/** A dead row keeps its colour and loses its light, so the hole is legible. */
const DEAD_OPACITY = "0.22";
const LIVE_OPACITY = "1";

export interface RowLedger {
  /** The element to put in the HUD column. */
  root: HTMLElement;
  /** Repaint from the roster. Cheap: it writes two style properties per changed cell. */
  update(): void;
}

/**
 * Build the ledger over `capacity` rows.
 *
 * @param roster What the page remembers about its rows.
 * @param clipNames The clip table's names, in order — the colour key.
 */
export function createRowLedger(roster: Roster, clipNames: readonly string[]): RowLedger {
  const root = document.createElement("div");
  root.id = "ledger";
  root.style.cssText =
    `display: grid; grid-template-columns: repeat(${COLUMNS}, 1fr); gap: 2px; ` +
    `width: min(160px, 40vw); margin-top: 4px;`;

  const colorOf = (clip: string) => CLIP_COLORS[Math.max(clipNames.indexOf(clip), 0) % CLIP_COLORS.length]!;

  const cells = roster.rows.map((_, id) => {
    const cell = document.createElement("i");
    cell.style.cssText = "display: block; aspect-ratio: 1; border-radius: 1px; background: #fff; opacity: 0.08;";
    cell.title = `row ${id} · reserved`;
    root.append(cell);
    return cell;
  });

  return {
    root,
    update() {
      for (let id = 0; id < cells.length; id++) {
        const cell = cells[id]!;
        const row = roster.rows[id];
        if (!row) {
          cell.style.background = "#fff";
          cell.style.opacity = "0.08";
          cell.title = `row ${id} · reserved`;
          continue;
        }
        cell.style.background = colorOf(row.clip);
        cell.style.opacity = row.live ? LIVE_OPACITY : DEAD_OPACITY;
        const times = row.spawns === 1 ? "filled once" : `filled ${row.spawns}×`;
        cell.title = `row ${id} · ${row.clip} · ${times}${row.live ? "" : " · empty"}`;
      }
    },
  };
}

/**
 * The colour key, as a line of HTML for the HUD — the clips a spawn rotates
 * through, each in the colour its cells take.
 *
 * Here rather than in the page's markup because the colours are this module's
 * and a key written in the HTML would be a second copy of them, drifting the
 * first time one changes.
 */
export function ledgerKey(clipNames: readonly string[]): string {
  return clipNames
    .map(
      (name, i) =>
        `<span style="color:${CLIP_COLORS[i % CLIP_COLORS.length]}">■</span> ${name}`,
    )
    .join(" · ");
}
