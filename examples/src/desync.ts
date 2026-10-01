// The playback policy line's instance desync: how far into its clip each
// soldier already is when the line plays.
//
// Kept free of three.js and the DOM so it runs in Node, where desync.test.ts
// asks the library's own frame resolution what the line shows.
//
// Each soldier gets a head start: it began that far into the clip before the
// line played, so the moment it plays every soldier is already walking, at its
// own point of one clip. Spaced evenly over the clip, the head starts would
// still read as a wave, each soldier one step behind its neighbour. So they
// are dealt in a stride of about half the line, and neighbours sit about half
// a clip apart. The stride shares no factor with the line's length, or two
// soldiers would land on the same point: four a half apart are two pairs.

/** Seconds into a clip `duration` long that soldier `i`, on a line `count` long, has already played when the line plays. */
export function headStartOf(i: number, count: number, duration: number): number {
  let stride = Math.ceil(count / 2);
  while (gcd(stride, count) !== 1) stride++;
  return (((i * stride) % count) / count) * duration;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
