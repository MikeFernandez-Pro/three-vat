// Which level of detail an instance draws: the levels page's choice, by
// distance from the camera. The library leaves the choice to the caller
// (ADR-0043), so this is the example's, shared by its two renderers.
//
// With hysteresis: an instance keeps the level it is on until it is a slack
// past the band, outward or inward, so one standing on a boundary — or a
// camera drifting across one — does not flip it every frame. The slack is a
// fraction of the band, so it is as wide relative to the distance far away
// as near. @three.ez/instanced-mesh shifts a threshold without remembering
// the level it left (docs/research/instanced-mesh2.md); this remembers it.

/**
 * The level for an instance `distance` from the camera: 0 nearer than
 * `bands[0]`, 1 nearer than `bands[1]`, and so on. Given the level it is on
 * now, it moves off it only once `slack × band` past the band it crosses.
 */
export function levelFor(distance: number, bands: readonly number[], current?: number, slack = 0): number {
  if (current === undefined) {
    const level = bands.findIndex((band) => distance < band);
    return level === -1 ? bands.length : level;
  }
  let level = current;
  while (level < bands.length && distance >= bands[level]! * (1 + slack)) level++;
  while (level > 0 && distance < bands[level - 1]! * (1 - slack)) level--;
  return level;
}
