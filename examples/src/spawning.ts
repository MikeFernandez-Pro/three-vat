// A crowd that spawns and dies: where a reserved row stands, what a new
// instance plays, and what the page remembers about a row that has been used
// before.
//
// Kept free of three.js, the DOM *and* three-vat, like `crowd.ts` beside it, so
// the parts a reader has to trust can be imported and tested rather than
// eyeballed in a browser. The batched pages bring the carrier; this file brings
// the bookkeeping the carrier deliberately does not do.
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
export const CAPACITY = 256

/** Cells across the field — and so rows down it, the field being square. */
export const COLUMNS = 16

/** Cells down the field. Stated rather than assumed square by every reader. */
export const ROWS = CAPACITY / COLUMNS

/**
 * Ground spacing as a multiple of an instance's real width, as `CLEARANCE` is.
 *
 * Wider than a crowd packed shoulder to shoulder, because the gaps are the
 * point here: a hole in the field is an instance that has died, and a field
 * with no room between its cells has no visible holes.
 */
export const SPACING = 1.55

/** Where on the ground one reserved row stands. */
export interface Cell {
  x: number
  z: number
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
  const column = id % COLUMNS
  const row = Math.floor(id / COLUMNS)
  return {
    x: (column - (COLUMNS - 1) / 2) * pitch,
    z: (row - (ROWS - 1) / 2) * pitch,
  }
}

/**
 * Which clip the `n`th spawn of the page plays, as an index into the clip
 * table.
 *
 * A rotation rather than a random draw, and that is the page's evidence rather
 * than a tidiness: consecutive spawns never play the same clip, so a row filled
 * twice is a row whose two occupants are visibly doing different things. A
 * random draw would land on the dead instance's clip one time in three and the
 * page would look, for that instance, exactly like the bug it exists to rule
 * out.
 */
export function clipOfSpawn(n: number, clipCount: number): number {
  return ((n % clipCount) + clipCount) % clipCount
}

/**
 * How many churn events a frame owes, and what is left over for the next one.
 *
 * Carried rather than rounded per frame: at four events a second and sixty
 * frames, every frame owes 0.066 of an event, and a page that floored that
 * would spawn nothing at all.
 */
export function churnTicks(carry: number, dt: number, rate: number): { ticks: number; carry: number } {
  if (rate <= 0) return { ticks: 0, carry: 0 }
  const owed = carry + dt * rate
  const ticks = Math.floor(owed)
  return { ticks, carry: owed - ticks }
}

/** What a page knows about one reserved row: who is in it, and who has been. */
export interface RowRecord {
  /** The clip the current — or last — occupant plays. */
  clip: string
  /** Whether an instance is alive in this row right now. */
  live: boolean
  /** Times this row has been filled, the current occupant included. */
  spawns: number
}

/** One spawn, as the HUD reports it. */
export interface SpawnEvent {
  /** The row the carrier handed back — this instance's logical index. */
  id: number
  /** What it plays. */
  clip: string
  /**
   * What the row's previous occupant played, or `null` for a row nobody has
   * used yet. This is **row recycling** made reportable: a non-null value is a
   * row that came back from the dead, and the clip named here is the one the
   * new instance would be playing if the row had not been rewritten.
   */
  previous: string | null
  /** Times this row has now been filled. */
  spawns: number
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
  readonly live: number
  /** Spawns since the page loaded. */
  readonly spawns: number
  /** Of those, the ones that landed on a row a dead instance had left behind. */
  readonly recycled: number
  /** Every row, by index — `null` for one nothing has ever occupied. */
  readonly rows: readonly (RowRecord | null)[]
  /** Record an instance the carrier has just handed row `id` to. */
  fill(id: number, clip: string): SpawnEvent
  /** Record that the instance in row `id` is gone. */
  free(id: number): void
  /** A live row, chosen by a number in `[0, 1)`, or `null` when nothing is alive. */
  pick(pick: number): number | null
}

/**
 * A roster over `capacity` reserved rows, all of them empty.
 *
 * @param capacity Rows the playback texture holds — {@link CAPACITY}.
 */
export function createRoster(capacity: number): Roster {
  const rows: (RowRecord | null)[] = Array.from({ length: capacity }, () => null)
  const liveIds = new Set<number>()
  let spawns = 0
  let recycled = 0

  return {
    get live() {
      return liveIds.size
    },
    get spawns() {
      return spawns
    },
    get recycled() {
      return recycled
    },
    rows,

    fill(id, clip) {
      const before = rows[id] ?? null
      // A row that has been used before is the recycled one, whether or not its
      // last occupant is still warm — `addInstance` reissues the lowest freed
      // id, so this is the common case long before the field is full.
      if (before) recycled++
      spawns++
      const record: RowRecord = { clip, live: true, spawns: (before?.spawns ?? 0) + 1 }
      rows[id] = record
      liveIds.add(id)
      return { id, clip, previous: before ? before.clip : null, spawns: record.spawns }
    },

    free(id) {
      const record = rows[id]
      // Left in place rather than cleared: what the dead instance was playing is
      // exactly what the next occupant of this row must *not* play, so it is the
      // thing worth keeping.
      if (record) record.live = false
      liveIds.delete(id)
    },

    pick(pick) {
      if (liveIds.size === 0) return null
      const ids = [...liveIds]
      return ids[Math.min(Math.floor(pick * ids.length), ids.length - 1)]!
    },
  }
}
