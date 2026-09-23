// A crowd that spawns and dies: where a reserved row stands, what a new
// instance plays, and what the page remembers about a row that has been used
// before.
//
// Kept free of three.js, the DOM *and* three-vat, like `crowd.ts` beside it, so
// the parts a reader has to trust can be imported and tested rather than
// eyeballed in a browser. The batched pages bring the carrier; this file brings
// the bookkeeping the carrier deliberately does not do — and the two HUD lines
// that report it, which are prose the pair has to agree on word for word.
//
// The one idea the whole thing hangs on: **the ground is the playback texture**.
// A reserved row is a cell of a square field, and the row's index is the cell's
// place in it — so an instance that dies leaves a visible hole, and the one
// that lands on that row lands in that hole, which is what
// `BatchedMesh.addInstance` reissuing the lowest freed id looks like from the
// outside.

/**
 * Rows the playback texture reserves — the crowd's ceiling, and the carrier's
 * `maxInstanceCount`. Fixed once the texture is made (ADR-0022), which is why
 * it is a constant here and not a slider.
 *
 * A square of {@link COLUMNS}, because the field is the texture drawn on the
 * ground and a square reads as one.
 */
export const CAPACITY = 256;

/** Cells across the field. */
export const COLUMNS = 16;

/**
 * Cells deep into the field. Not `ROWS`: a **row** is a row of the playback
 * texture everywhere else in this codebase (CONTEXT.md, **Capacity**), and this
 * module talks about those constantly.
 */
export const FIELD_DEPTH = CAPACITY / COLUMNS;

/**
 * Ground spacing as a multiple of an instance's real width, as `CLEARANCE` is.
 *
 * Wider than a crowd packed shoulder to shoulder, because the gaps are the
 * point here: a hole in the field is an instance that has died, and a field
 * with no room between its cells has no visible holes.
 */
export const SPACING = 1.55;

/** Where on the ground one reserved row stands. */
export interface Cell {
  x: number;
  z: number;
}

/**
 * The cell row `id` owns, centred on the origin — the field's only layout rule.
 *
 * Row-major, so the ids run left to right and back to front exactly as the
 * ledger draws them: a visitor who finds a cell in one has found it in the
 * other. Nothing about this moves over time; an instance stands where its row
 * is, and only spawning and dying change what is on screen.
 *
 * @param id    The instance's logical index — its playback row, and the id the
 *              carrier handed out.
 * @param pitch Ground units between neighbouring cells.
 */
export function cellOf(id: number, pitch: number): Cell {
  const column = id % COLUMNS;
  const depth = Math.floor(id / COLUMNS);
  return {
    x: (column - (COLUMNS - 1) / 2) * pitch,
    z: (depth - (FIELD_DEPTH - 1) / 2) * pitch,
  };
}

/**
 * Which way the instance in row `id` faces — a fixed spread either side of the
 * camera, keyed by the row rather than by the occupant.
 *
 * Deliberately a property of the *row*: where an instance stands and which way
 * it looks belong to the cell, so the only thing that changes when a row is
 * recycled is the one thing the page is about — what it plays.
 */
export function yawOf(id: number): number {
  return ((id * 2.399963) % 1) * 0.5 - 0.25;
}

/**
 * Which clip a spawn plays, as an index into the clip table.
 *
 * `previous` is the clip index the row's *last* occupant played, or `null` for
 * a row nobody has used. That argument is the page's whole evidence and not a
 * nicety: a recycled row takes the clip **after** its last occupant's, so the
 * two are never the same and a cell that comes back the colour it went dim is
 * always a bug rather than a coincidence. Keyed off the spawn counter instead,
 * the two spawns that fill one row would collide whenever the gap between them
 * was a multiple of the clip count — one time in three, which is exactly the
 * case a visitor must be able to read as wrong.
 *
 * A fresh row has no occupant to differ from, so it takes the rotation's next
 * clip and the field fills with all three from the start.
 */
export function clipOfSpawn(n: number, clipCount: number, previous: number | null = null): number {
  const from = previous === null ? n : previous + 1;
  return ((from % clipCount) + clipCount) % clipCount;
}

/**
 * How many churn events a frame owes, and what is left over for the next one.
 *
 * Carried rather than rounded per frame: at four events a second and sixty
 * frames, every frame owes 0.066 of an event, and a page that floored that
 * would spawn nothing at all.
 */
export function churnTicks(carry: number, dt: number, rate: number): { ticks: number; carry: number } {
  if (rate <= 0) return { ticks: 0, carry: 0 };
  const owed = carry + dt * rate;
  const ticks = Math.floor(owed);
  return { ticks, carry: owed - ticks };
}

/** What a page knows about one reserved row: who is in it, and who has been. */
export interface RowRecord {
  /** The clip the current — or last — occupant plays. */
  clip: string;
  /** Whether an instance is alive in this row right now. */
  live: boolean;
  /** Times this row has been filled, the current occupant included. */
  spawns: number;
}

/** One spawn, as the HUD reports it. */
export interface SpawnEvent {
  /** The row the carrier handed back — this instance's logical index. */
  id: number;
  /** What it plays. */
  clip: string;
  /**
   * What the row's previous occupant played, or `null` for a row nobody has
   * used yet. This is **row recycling** made reportable: a non-null value is a
   * row that came back from the dead, and the clip named here is the one the
   * new instance would be playing if the row had not been rewritten.
   */
  previous: string | null;
  /** Times this row has now been filled. */
  spawns: number;
}

/**
 * What the page remembers about its rows.
 *
 * It exists because the library deliberately remembers none of it (ADR-0022):
 * the playback texture holds a row per instance and has no notion of a live
 * population, and the carrier owns the numbering. Someone has to know which of
 * its own instances are alive in order to kill one, and that someone is the
 * caller — so this is what "the caller owns the index" costs, written out.
 */
export interface Roster {
  /** Instances alive right now. */
  readonly live: number;
  /** Spawns since the page loaded. */
  readonly spawns: number;
  /** Of those, the ones that landed on a row a dead instance had left behind. */
  readonly recycled: number;
  /** Every row, by index — `null` for one nothing has ever occupied. */
  readonly rows: readonly (RowRecord | null)[];
  /** Record an instance the carrier has just handed row `id` to. */
  fill(id: number, clip: string): SpawnEvent;
  /** Record that the instance in row `id` is gone. */
  free(id: number): void;
  /** A live row, chosen by a number in `[0, 1]`, or `null` when nothing is alive. */
  pick(at: number): number | null;
}

/**
 * A roster over `capacity` reserved rows, all of them empty.
 *
 * @param capacity Rows the playback texture holds — {@link CAPACITY}.
 */
export function createRoster(capacity: number): Roster {
  const rows: (RowRecord | null)[] = Array.from({ length: capacity }, () => null);
  const liveIds = new Set<number>();
  let spawns = 0;
  let recycled = 0;

  return {
    get live() {
      return liveIds.size;
    },
    get spawns() {
      return spawns;
    },
    get recycled() {
      return recycled;
    },
    rows,

    fill(id, clip) {
      const before = rows[id] ?? null;
      // A row that has been used before is the recycled one, whether or not its
      // last occupant is still warm — `addInstance` reissues the lowest freed
      // id, so this is the common case long before the field is full.
      if (before) recycled++;
      spawns++;
      const record: RowRecord = { clip, live: true, spawns: (before?.spawns ?? 0) + 1 };
      rows[id] = record;
      liveIds.add(id);
      return { id, clip, previous: before ? before.clip : null, spawns: record.spawns };
    },

    free(id) {
      const record = rows[id];
      // Left in place rather than cleared: what the dead instance was playing is
      // exactly what the next occupant of this row must *not* play, so it is the
      // thing worth keeping.
      if (record) record.live = false;
      liveIds.delete(id);
    },

    pick(at) {
      if (liveIds.size === 0) return null;
      const ids = [...liveIds];
      return ids[Math.min(Math.floor(at * ids.length), ids.length - 1)]!;
    },
  };
}

// ------------------------------------------------------------- the readouts
// The two HUD lines the batched pages carry. Here, and not written out on each
// page, for the reason `bundles.test.ts` collects this module at all: they are
// renderer-free, and the release suite holds the two pages of a pair to the
// same readouts (ADR-0011) — a sentence copied twice is a sentence that drifts
// on one page and not the other. What each page still says in its own words is
// the draw-call note, because that is the one figure the two renderers really
// do disagree about.

/** `2` → `2nd`, the eleven-to-thirteen exception included. */
function ordinal(n: number): string {
  const teens = n % 100;
  const suffix = teens >= 11 && teens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** How many instances are alive, in how many reserved rows, and how often a row has come back. */
export function populationLine(roster: Roster): string {
  return (
    `${roster.live} alive in ${roster.rows.length} reserved rows — ${roster.spawns} spawned, ` +
    `${roster.recycled} of them onto a row that had been used before`
  );
}

/**
 * One spawn, and what the row was holding when it arrived.
 *
 * The page's whole point in one line: the row named here came back from the
 * dead still holding the previous clip, and the instance standing in that cell
 * is playing the new one because `setVATInstance` was called before it was
 * drawn. Without that write it would be playing the clip named as the previous
 * occupant's — from wherever that animation had got to, which for a one-shot is
 * a corpse clamped on its last frame.
 */
export function spawnLine(event: SpawnEvent): string {
  return event.previous === null
    ? `row ${event.id} was fresh — ${event.clip} spawned into it`
    : `row ${event.id} held ${event.previous} — ${event.clip} spawned into it, its ${ordinal(event.spawns)} occupant`;
}
