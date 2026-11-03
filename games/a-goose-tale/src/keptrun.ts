// A run kept for a page that goes and comes back, in this tab's own storage: a reload finds it, a new tab starts anew.
import type { PlaySave } from './gooseplay'

const KEY = 'a-goose-tale.run'

const isPoint = (p: unknown): boolean => typeof p === 'object' && p !== null && Number.isFinite((p as { x: unknown }).x) && Number.isFinite((p as { z: unknown }).z)
const isNumbers = (list: unknown): boolean => Array.isArray(list) && list.every(Number.isInteger)

/** Whether `run` has a kept run's shape: storage is no place to trust. */
export function isPlaySave(run: unknown): run is PlaySave {
  if (typeof run !== 'object' || run === null) return false
  const { found, keys, armed, restAt } = run as Record<string, unknown>
  return isNumbers(found) && isNumbers(keys) && typeof armed === 'boolean' && isPoint(restAt)
}

/** The run kept, if there is one that can be read. */
export function keptRun(storage: Pick<Storage, 'getItem'> = sessionStorage): PlaySave | undefined {
  try {
    const run: unknown = JSON.parse(storage.getItem(KEY) ?? 'null')
    return isPlaySave(run) ? run : undefined
  } catch {
    return undefined
  }
}

/** Keep `run`, if the storage will have it: a private window's may not. */
export function keepRun(run: PlaySave, storage: Pick<Storage, 'setItem'> = sessionStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(run))
  } catch {
    // Nothing kept: a reload starts anew, as it would have.
  }
}

/** The run over: the next load starts anew. */
export function dropKeptRun(storage: Pick<Storage, 'removeItem'> = sessionStorage): void {
  try {
    storage.removeItem(KEY)
  } catch {
    // Nothing to drop.
  }
}
