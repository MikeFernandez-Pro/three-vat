// Which level of detail an instance draws: the levels page's choice, by
// distance from the camera. The library leaves the choice to the caller
// (ADR-0043), so this is the example's, shared by its two renderers.

/** The level for an instance `distance` from the camera: 0 nearer than `bands[0]`, 1 nearer than `bands[1]`, and so on. */
export function levelFor(distance: number, bands: readonly number[]): number {
  const level = bands.findIndex((band) => distance < band);
  return level === -1 ? bands.length : level;
}
