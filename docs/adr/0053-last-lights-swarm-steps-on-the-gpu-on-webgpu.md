# Last Light's swarm steps on the GPU, on WebGPU

*Last Light*'s **swarm** stepped in a worker, a sixtieth of a second at a time
(ADR-0047). Once the rats were culled and drawn on the GPU (ADR-0052) and the
eyes' trails laid there too, the page's frame was no longer the limit on a
fast PC; the step was. At 16,384 rats with the light walking, one step took
about 25 ms, longer than the sixtieth of a second it covers. The worker made
34 states a second, and the swarm moved in slow motion (#169).

This amends ADR-0047: on WebGPU the worker is not started.

## The decision

On WebGPU the swarm steps on the GPU (`games/last-light/src/gpuswarm.ts`,
#172), in TSL compute passes the page runs through three's renderer, on the
device the cull and the draw use. Its state never leaves the GPU.

- **One model.** The CPU step and the GPU step follow one model (#170). Each
  rat reads its neighbours as the last step left them, and draws its chances
  from a hash of the seed, the step's number and its own index. The CPU step's
  tests stay the specification of the rules for both. The kernels read the
  step's tuning constants and its hash from `swarm.ts`, which exports them;
  the flame's three waves and the rules' few literal thresholds are written
  in both files.
- **The kernels**, each a named phase:
  - The neighbour grid, by counting sort. The cells are emptied, then each
    rat is counted into its cell by an atomic add, which also gives it a place
    in that cell. The counts are scanned in blocks of 256, then the blocks'
    sums, and each rat is scattered into cell order. A row of three cells is
    one run of that order, so a rat reads three runs, not nine cells. The grid
    is at most 512 cells a side; past that its cells grow wider than the
    feel, which adds candidates but changes no result.
  - The step of every rat: every rule the CPU step has, the pile included.
    Two differences. The flame's flicker is worked out at each rat's own
    angle, where the CPU reads it from a 512-angle table. And the light
    always burns and fear always spreads: the switches that turn either off
    are kept for the prototype pages, which step on the CPU.
  - Bring-round. Each rat that would be set down takes a ticket by an atomic
    add, and only the tickets under the step's quota move. The tickets
    start at a new place round the swarm each step, so that no run of rats
    is always first. The CPU instead takes up its search where it left off.
    A moved rat is marked, as the worker marks it (#165).
- **The state.** Each rat keeps its place in the cull's two state buffers and
  the rest of its motion in two buffers beside them. A step reads the latest
  pair and writes the next state into the buffer the pair no longer reads. So
  the cull blends the last two steps as it blended the worker's last two
  posts.
- **The clock** is the page's: a fixed sixtieth of a second a step, as many a
  frame as it owes, four at most. Past four it skips ahead, keeping the share
  of a step. Paused, nothing is stepped. The light of each step is stood
  between the last frame's and this one's. The cull stands the rats a step
  behind, as far between the last two steps as the clock has got.
- **What the page still works out** is what is one number for the whole
  swarm: the light's smoothed walk, the step's keys and bring-round's quota.
  The page also spawns rats. When the count grows, the new rats are worked out
  by the swarm's own rule, from a `Swarm` that is never stepped, and only
  those go up. A shrinking count steps and draws fewer.
- **Gaits** come back late and small. A rat whose gait changes is appended,
  once per list round, to one of two lists by an atomic add, and its entry is
  rewritten if it changes again. The page reads one list back while the steps
  write the other, never waiting for it on the frame, and writes those
  playback rows a few frames late.
- **Stop motion.** The step writes the pair between beats, so the pair cannot
  be held as it was for the worker. A third buffer of the cull holds the rats
  instead. A pass copies each rat into it, as the pair has it, when its beat
  turns: every rat on the beat for plain stop motion, each on its own phase
  for the staggered one. The cull then stands the rats there.
- **Readouts.** The line shows the states made a second. Under
  `?timestamps` it shows each step's GPU time where the worker's time stood.
- **The switch.** WebGPU takes the GPU step. `?cpustep` keeps the worker
  there, for measuring. WebGL 2 and `?batch` keep the worker, unchanged.

## Considered

- **Raw WGSL**, as the prototype on `prototype/gpu-step` was written, on a
  device of its own. TSL through three's renderer shares the device and the
  buffers with the cull, and its WGSL is checked without a GPU by the
  library's test utilities.
- **A copy of the step's state into the cull's buffers.** It would let the
  cull keep holding the pair under stop motion. Writing the cull's buffers
  directly costs nothing per frame. The held buffer costs one pass on a beat.
- **Reading positions back** to keep the page's CPU path for everything else.
  The prototype measured a round trip of about 3 ms, so nothing the player
  sees waits on one.
- **Reading back how many rats bring-round moved**, to carry an unspent quota
  as the CPU does. The quota a step owes is spent whether or not enough rats
  qualify. Both steps bring round the same number a second in the comparison
  below, at the rate's cap.

## Consequences

The CPU and GPU swarms compared from one start, by hand with
`games/last-light/tools/compare-steps.mjs`, on 2026-10-09. The CPU's runs come
first, then the GPU's. Each entry is the spread over six seeds at 2,000 rats
and four seeds at 16,384:

| measure | 2,000 CPU | 2,000 GPU | 16,384 CPU | 16,384 GPU |
|---|---|---|---|---|
| rats inside the flame, settled | 0 | 0 | 0 | 0 |
| the front's mean radius, m | 4.145-4.157 | 4.138-4.155 | 4.192-4.205 | 4.188-4.199 |
| Run share | 0.011-0.014 | 0.009-0.013 | 0.001-0.002 | 0.001 |
| Walk share | 0.807-0.829 | 0.811-0.828 | 0.416-0.451 | 0.414-0.454 |
| Idle share | 0.158-0.180 | 0.161-0.179 | 0.547-0.582 | 0.544-0.585 |
| s to run out of an overtaking light | 1.18-2.40 | 1.53-1.95 | 2.27-3.28 | 2.25-2.62 |
| rats brought round a second | 400 | 400 | 3,277 | 3,277 |

The ADR-0047 bench conditions again: interleaved against `?cpustep`, RTX 5080,
1920x1000, smooth play under `?loop`, two rounds each. Medians of the page's
frame and the best GPU frame (render and compute), in ms:

| rats, CPU | states/s, worker | states/s, GPU | page, worker | page, GPU | GPU best, worker | GPU best, GPU |
|---|---|---|---|---|---|---|
| 2,000, 1x | 60 | 60 | 0.5 | 0.5-0.6 | 0.94 | 0.94-0.95 |
| 2,000, 4x | 60 | 60 | 2.3-2.5 | 2.5-2.7 | 0.91-0.92 | 0.91-0.92 |
| 8,192, 1x | 60 | 60 | 0.6 | 0.5 | 1.84-1.86 | 1.67-1.68 |
| 8,192, 4x | 60 | 60 | 2.5-2.6 | 2.2-2.3 | 1.77 | 1.74-1.75 |
| 16,384, 1x | 34 | 60 | 0.7 | 0.5 | 2.44-2.45 | 2.57-2.62 |
| 16,384, 4x | 34 | 60 | 3.0 | 2.1-2.2 | 2.67-2.71 | 2.97-3.04 |

- **16,384 rats move at full speed.** The swarm makes 60 states a second
  where the worker made 34.
- **The page's frame is no higher** at 8,192 and 16,384 rats, and lower
  where the worker's posts cost it most. At 2,000 under the fourfold throttle
  it reads 0.2 ms higher, 2.5-2.7 ms against 2.3-2.5. The worker's
  rounds there spread as wide, so it is within the bench's noise.
- **The GPU's frame rises at 16,384**, by 0.13 to 0.33 ms. A swarm at full
  speed keeps up with the walking light, and the view holds about 9,000 rats
  where the slow worker's held about 6,500. The compute passes together read
  under 0.02 ms a frame.
- **Brought-round rats are never first drawn inside the fog ring**, with the
  light walked at 12 m/s under plain, staggered and no stop motion: the probe
  from #163, on both steps.
- **The first second of a page** compiles the step's pipelines. A hitch of
  more than four steps there is skipped, not caught up.
- **Two steps are kept.** WebGL 2 has no compute passes, and its worker is
  the measure the GPU step is compared against. A change to the rules goes
  into both, and the comparison is run again.
- The step's buffers take about 2 MB at 16,384 rats beside the cull's, and
  the grid's another 3 MB. The page frees them when it leaves.
