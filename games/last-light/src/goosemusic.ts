// The goose game's music, made as it plays in Web Audio, no files: a slow lullaby in D, a cosy night rather than a
// haunted one: a warm pad, a soft felt piano, a plucked guitar, a low cello; no music box, choir or drone. It grows with
// her goslings: alone she has only the pad; each gosling found brings in the next layer (the bass and a low piano, the
// piano's arpeggio, the tune, the guitar, the cello), every layer by the time all of them are with her. A layer comes in
// and goes over a few seconds, never at once. The tune is made once a load and goes round again with a few notes
// changed, a song rather than a loop. It plays through the sounds' bus (goosesounds.ts), muted, hushed and turned down
// with them.
import type { GooseSounds } from './goosesounds'

/** A beat, s: 62 to the minute, a slow walk; the music moves in eighths. */
const BEAT = 60 / 62
const EIGHTH = BEAT / 2
/** Eighths to a bar; bars to a chord. */
const BAR = 8
const CHORD_BARS = 2

interface Chord {
  /** The bass's note, MIDI. */
  bass: number
  /** The pad's notes. */
  pad: number[]
  /** The arpeggio's notes, low to high. */
  arp: number[]
  /** The cello's note in each of the chord's bars. */
  cello: [number, number]
}
/** Round and round: IV I vi V, then ii iii IV V, the minor chords the bittersweet in it, the sus4 left hanging. */
const CHORDS: Chord[] = [
  { bass: 43, pad: [55, 59, 62, 66], arp: [55, 59, 62, 66, 67, 71], cello: [59, 57] }, // Gmaj7
  { bass: 50, pad: [54, 57, 61, 64], arp: [57, 61, 62, 64, 66, 69], cello: [54, 57] }, // Dmaj9
  { bass: 47, pad: [54, 57, 59, 62], arp: [54, 59, 62, 66, 69, 71], cello: [62, 57] }, // Bm7
  { bass: 45, pad: [52, 57, 62, 64], arp: [57, 59, 62, 64, 69, 71], cello: [62, 64] }, // Asus4
  { bass: 40, pad: [55, 59, 62, 66], arp: [55, 59, 62, 64, 66, 71], cello: [59, 62] }, // Em9
  { bass: 42, pad: [52, 57, 61, 64], arp: [54, 57, 61, 64, 66, 69], cello: [61, 57] }, // F#m7
  { bass: 43, pad: [55, 59, 62, 66], arp: [55, 59, 62, 66, 67, 71], cello: [59, 62] }, // Gmaj7
  { bass: 45, pad: [52, 57, 61, 64], arp: [57, 61, 64, 69, 71, 73], cello: [64, 61] }, // A
]
const TUNE_BARS = CHORDS.length * CHORD_BARS

/**
 * The layers, in the order the goslings bring them in: each one's place left to right, its level, and its share sent
 * into the room.
 */
const LAYERS = [
  { name: 'pad', pan: 0, gain: 0.55, send: 0.6 },
  { name: 'bass', pan: 0, gain: 0.6, send: 0.25 },
  { name: 'arpeggio', pan: 0.25, gain: 0.45, send: 0.5 },
  { name: 'tune', pan: 0.05, gain: 0.55, send: 0.55 },
  { name: 'guitar', pan: -0.35, gain: 0.4, send: 0.4 },
  { name: 'cello', pan: -0.15, gain: 0.45, send: 0.5 },
] as const
export const MUSIC_LAYERS: readonly string[] = LAYERS.map((layer) => layer.name)
/** The top layer, every one heard. */
export const ALL_LAYERS = LAYERS.length - 1

/** The top layer heard with `found` of `of` goslings with her: the pad alone with none, every layer with all. */
export function layersFor(found: number, of: number): number {
  if (of <= 0) return 0
  return Math.round((Math.min(found, of) / of) * ALL_LAYERS)
}

/** How long a layer takes to come in or go, s, near enough; the whole at its start. */
const LAYER_FADE = 4
const START_FADE = 6
/** The room's share, and how long it rings, s. */
const WET = 0.5
const ROOM_SECONDS = 3.2
/** The music's level, a share of the sounds' mix. */
const VOLUME = 0.6
/** How far the notes are laid ahead of the clock, s. */
const AHEAD = 0.4
/** How far off the beat a hand plays, s, either way. */
const LOOSE = 0.015

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)]!

/** The tune's range, MIDI, and the notes of D major, by pitch class; its pentatonic for passing notes. */
const TUNE_LOW = 64
const TUNE_HIGH = 81
const TUNE_MIDDLE = 71
const MAJOR = [2, 4, 6, 7, 9, 11, 1]
const PENTATONIC = [2, 4, 6, 9, 11]
/** Where a bar's notes start, in eighths: a chord's first bar moves, its second rests on a note or two. */
const MOVING = [[0, 4], [0, 3, 4], [0, 6], [2, 4], [0, 2, 4], [0, 4, 6], [0, 3, 6]]
const RESTING = [[0], [0], [0, 4], [], [0, 2]]
/** The arpeggio's turns through its six notes, a bar each. */
const ARPEGGIOS = [
  [0, 2, 3, 4, 5, 4, 3, 2],
  [0, 3, 4, 2, 5, 3, 4, 2],
  [0, 2, 4, 5, 4, 2, 3, 1],
]
/** The share of the arpeggio's eighths left out, its first never. */
const ARP_REST = 0.3
/** The guitar's eighths in a bar, and the share of them left out. */
const GUITAR_AT = [1, 3, 4, 6]
const GUITAR_REST = 0.25

interface Note {
  at: number
  midi: number
}

/** The tune: a bar of notes for each bar round the chords, stepping near the last, a chord's note on its strong beats. */
export function makeTune(random: () => number): Note[][] {
  const tones = (pcs: number[]) => {
    const out: number[] = []
    for (let m = TUNE_LOW; m <= TUNE_HIGH; m++) if (pcs.includes(m % 12)) out.push(m)
    return out
  }
  const near = (from: number, choices: number[]) => {
    const weights = choices.map((m) => Math.exp(-Math.abs(m - from) / 2.5) * Math.exp(-Math.abs(m - TUNE_MIDDLE) / 8) * (m === from ? 0.4 : 1))
    let left = random() * weights.reduce((a, b) => a + b, 0)
    for (let k = 0; k < choices.length; k++) if ((left -= weights[k]!) <= 0) return choices[k]!
    return choices[choices.length - 1]!
  }
  const passing = tones(PENTATONIC)
  let pitch = 69
  const bars: Note[][] = []
  for (let bar = 0; bar < TUNE_BARS; bar++) {
    const chord = CHORDS[Math.floor(bar / CHORD_BARS)]!
    const held = tones([...new Set(chord.arp.map((m) => m % 12))])
    const rhythm = pick(bar % CHORD_BARS === 0 ? MOVING : RESTING, random)
    bars.push(
      rhythm.map((at) => {
        pitch = near(pitch, at === 0 ? held : passing)
        return { at, midi: pitch }
      }),
    )
  }
  return bars
}

/** The tune's bar on its `pass` time round: the first as made, then now and then a note moved a step or left out. */
function varied(notes: Note[], pass: number, random: () => number): Note[] {
  if (pass === 0) return notes
  return notes.flatMap((note, k) => {
    if (k > 0 && random() < 0.08) return []
    if (random() > 0.14) return [note]
    const scale = (m: number) => MAJOR.includes(((m % 12) + 12) % 12)
    let midi = note.midi + (random() < 0.5 ? -1 : 1)
    while (!scale(midi)) midi += midi > note.midi ? 1 : -1
    return [{ at: note.at, midi: Math.min(TUNE_HIGH, Math.max(TUNE_LOW, midi)) }]
  })
}

/** How long a piano note rings, s; its partials' spread above true harmonics. */
const PIANO_SECONDS = 5
const INHARMONIC = 0.0004

/**
 * A soft felt piano's note, made offline: a few partials, the higher dying the sooner, the fundamental two strings
 * a little apart so it beats, all through a felt's low-pass; a quick fall off the hammer, then the long ring.
 */
async function pianoNote(midi: number, rate: number): Promise<AudioBuffer> {
  const f = hz(midi)
  const offline = new OfflineAudioContext(1, Math.ceil(PIANO_SECONDS * rate), rate)
  const felt = new BiquadFilterNode(offline, { type: 'lowpass', frequency: Math.min(3000, f * 5), Q: 0.3 })
  felt.connect(offline.destination)
  const ring = Math.min(1.6, Math.max(0.5, Math.sqrt(220 / f)))
  for (let n = 1; n <= 10; n++) {
    const fn = f * n * Math.sqrt(1 + INHARMONIC * n * n)
    if (fn > rate * 0.45) break
    const peak = 0.5 / n ** 1.4
    for (const cents of n === 1 ? [-1.5, 1.5] : [0]) {
      const osc = new OscillatorNode(offline, { frequency: fn, detune: cents })
      const env = new GainNode(offline, { gain: 0 })
      const level = n === 1 ? peak / 2 : peak
      env.gain.setValueAtTime(0, 0)
      env.gain.linearRampToValueAtTime(level, 0.008)
      env.gain.setTargetAtTime(level * 0.4, 0.008, 0.15)
      env.gain.setTargetAtTime(0, 0.35, (2.4 * ring) / (1 + 0.5 * (n - 1)))
      osc.connect(env).connect(felt)
      osc.start(0)
    }
  }
  const buffer = await offline.startRendering()
  // Its last tenth of a second faded, so its end never clicks.
  const data = buffer.getChannelData(0)
  const tail = Math.floor(rate * 0.1)
  for (let i = 0; i < tail; i++) data[data.length - 1 - i]! *= i / tail
  return buffer
}

/** A plucked nylon string, Karplus-Strong: a soft burst round a loop the string's length, smoothed each time round. */
function guitarNote(context: BaseAudioContext, midi: number): AudioBuffer {
  const rate = context.sampleRate
  const f = hz(midi)
  const period = Math.max(2, Math.round(rate / f))
  const ring = new Float32Array(period)
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1
  // A thumb, not a pick: the burst smoothed twice before it rings.
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < period; i++) ring[i] = (ring[i]! + ring[(i + 1) % period]!) / 2
  const buffer = context.createBuffer(1, Math.ceil(rate * 2.5), rate)
  const data = buffer.getChannelData(0)
  // Down to 0.25 of its level each second, whatever its pitch.
  const keep = 0.25 ** (1 / f)
  let peak = 0
  for (let i = 0, k = 0; i < data.length; i++, k = (k + 1) % period) {
    const now = ring[k]!
    data[i] = now
    ring[k] = keep * 0.5 * (now + ring[(k + 1) % period]!)
    peak = Math.max(peak, Math.abs(now))
  }
  const tail = Math.floor(rate * 0.1)
  for (let i = 0; i < data.length; i++) data[i]! *= (i >= data.length - tail ? (data.length - i) / tail : 1) / (peak || 1)
  return buffer
}

/** A night's room: stereo noise, darkened, dying over ROOM_SECONDS. */
function roomOf(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate
  const buffer = context.createBuffer(2, Math.ceil(ROOM_SECONDS * rate), rate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    let low = 0
    for (let i = 0; i < data.length; i++) {
      low += (Math.random() * 2 - 1 - low) * 0.3
      data[i] = low * Math.exp((-i / rate) * (6.9 / ROOM_SECONDS)) * Math.min(1, i / (0.01 * rate))
    }
  }
  return buffer
}

/** The music on a context of its own: laid by its clock, so a page plays it live and an offline context renders it. */
export interface Music {
  /** Resolves once its piano is made: it starts no sooner. */
  readonly ready: Promise<void>
  /** Starts at `at` s of the context, fading in. */
  start(at: number): void
  /** Layers 0 to `top` heard from `at` s of the context, each coming in or going over LAYER_FADE s. */
  layers(top: number, at: number): void
  /** Every note up to `until` s of the context laid; any before `from` skipped, as after a hidden tab. */
  lay(until: number, from?: number): void
  /** Its level. */
  volume: number
}

export function createMusic(context: BaseAudioContext, out: AudioNode, random: () => number = Math.random): Music {
  const whole = new GainNode(context, { gain: 0 })
  const tone = new BiquadFilterNode(context, { type: 'lowpass', frequency: 4500, Q: 0.4 })
  whole.connect(tone).connect(out)
  const room = new ConvolverNode(context, { buffer: roomOf(context) })
  room.connect(new GainNode(context, { gain: WET })).connect(whole)
  const voices = LAYERS.map(({ pan, gain, send }) => {
    const level = new GainNode(context, { gain: 0 })
    const placed = level.connect(new StereoPannerNode(context, { pan }))
    placed.connect(new GainNode(context, { gain })).connect(whole)
    placed.connect(new GainNode(context, { gain: gain * send })).connect(room)
    return level
  })
  const [padIn, bassIn, arpIn, tuneIn, guitarIn, celloIn] = voices as [GainNode, GainNode, GainNode, GainNode, GainNode, GainNode]

  const piano = new Map<number, AudioBuffer>()
  const guitar = new Map<number, AudioBuffer>()
  const wanted = new Set<number>()
  for (const chord of CHORDS) {
    for (const m of chord.arp) wanted.add(m)
    wanted.add(chord.bass + 12)
    wanted.add(chord.pad[1]!)
  }
  for (let m = TUNE_LOW; m <= TUNE_HIGH; m++) wanted.add(m)
  const ready = Promise.all([...wanted].map(async (m) => void piano.set(m, await pianoNote(m, context.sampleRate)))).then(() => {})

  /** A note of a buffer at `at`, `velocity` its level, into `into`. */
  const struck = (buffer: AudioBuffer | undefined, at: number, velocity: number, into: AudioNode) => {
    if (!buffer) return
    const source = new AudioBufferSourceNode(context, { buffer })
    const level = new GainNode(context, { gain: velocity })
    source.connect(level).connect(into)
    source.onended = () => level.disconnect()
    source.start(Math.max(0, at))
  }
  const loose = () => (random() * 2 - 1) * LOOSE
  const pianoAt = (midi: number, at: number, velocity: number, into: AudioNode) => struck(piano.get(midi), at + loose(), velocity, into)
  const pluck = (midi: number, at: number, velocity: number) =>
    struck(guitar.get(midi) ?? guitar.set(midi, guitarNote(context, midi)).get(midi), at + loose(), velocity, guitarIn)

  /** A sound of oscillators held from `at` for `length` s, `rise` s in and `fall` s out, through a low-pass at `cutoff` Hz. */
  const held = (at: number, length: number, rise: number, fall: number, cutoff: number, peak: number, into: AudioNode) => {
    const filter = new BiquadFilterNode(context, { type: 'lowpass', frequency: cutoff, Q: 0.6 })
    const env = new GainNode(context, { gain: 0 })
    env.gain.setValueAtTime(0, at)
    env.gain.linearRampToValueAtTime(peak, at + rise)
    env.gain.setValueAtTime(peak, at + length)
    env.gain.linearRampToValueAtTime(0, at + length + fall)
    filter.connect(env).connect(into)
    const end = at + length + fall + 0.05
    const osc = (type: OscillatorType, midi: number, cents: number, level = 1) => {
      const node = new OscillatorNode(context, { type, frequency: hz(midi), detune: cents })
      if (level === 1) node.connect(filter)
      else node.connect(new GainNode(context, { gain: level })).connect(filter)
      node.start(at)
      node.stop(end)
      return node
    }
    return { osc, env, end, done: () => (filter.disconnect(), env.disconnect()) }
  }

  /** The pad: the chord's notes, two saws each a little apart, soft and dark, each chord crossfading into the next. */
  const pad = (chord: Chord, at: number, length: number) => {
    const sound = held(at, length, 2, 2.5, 700, 0.06, padIn)
    const oscs = chord.pad.flatMap((m) => [sound.osc('sawtooth', m, -7), sound.osc('sawtooth', m, 7)])
    oscs[0]!.onended = sound.done
  }
  /** The bass: a round low note, its octave a little over it so a small speaker hears it, falling off as it holds. */
  const bass = (midi: number, at: number, length: number, velocity: number) => {
    const sound = held(at, length - 0.3, 0.05, 0.6, 600, 0.3 * velocity, bassIn)
    sound.env.gain.setTargetAtTime(0.15 * velocity, at + 0.05, 0.8)
    const low = sound.osc('sine', midi, 0)
    sound.osc('sine', midi + 12, 0, 0.3)
    low.onended = sound.done
  }
  /** The cello: two saws bowed in slowly, a vibrato coming in once the note has settled. */
  const cello = (midi: number, at: number, length: number) => {
    const sound = held(at, length, 0.9, 1.2, 1100, 0.1, celloIn)
    const vibrato = new OscillatorNode(context, { frequency: 4.8 })
    const depth = new GainNode(context, { gain: 0 })
    depth.gain.setValueAtTime(0, at + 0.5)
    depth.gain.linearRampToValueAtTime(7, at + 1.5)
    vibrato.connect(depth)
    const strings = [sound.osc('sawtooth', midi, -5), sound.osc('sawtooth', midi, 5)]
    for (const s of strings) depth.connect(s.detune)
    vibrato.start(at)
    vibrato.stop(sound.end)
    strings[0]!.onended = () => (sound.done(), depth.disconnect())
  }

  let step = 0
  let stepAt = Number.NaN
  let arpeggio = ARPEGGIOS[0]!
  let tune = makeTune(random)
  let bar: Note[] = []
  let volume = VOLUME
  const on: boolean[] = LAYERS.map(() => false)

  /** The eighth `n` of the music, at `at`. */
  const eighth = (n: number, at: number) => {
    const e = n % BAR
    const b = Math.floor(n / BAR)
    const chordBar = b % CHORD_BARS
    const chord = CHORDS[Math.floor(b / CHORD_BARS) % CHORDS.length]!
    if (e === 0) {
      const pass = Math.floor(b / TUNE_BARS)
      arpeggio = pick(ARPEGGIOS, random)
      bar = varied(tune[b % TUNE_BARS]!, pass, random)
      if (chordBar === 0) pad(chord, at, CHORD_BARS * BAR * EIGHTH)
      bass(chord.bass, at, BAR * EIGHTH, chordBar === 0 ? 1 : 0.7)
      pianoAt(chord.bass + 12, at, 0.5, bassIn)
      pianoAt(chord.pad[1]!, at + 0.04, 0.32, bassIn)
      cello(chord.cello[chordBar]!, at, BAR * EIGHTH)
    }
    if (e === 0 || random() > ARP_REST) pianoAt(chord.arp[arpeggio[e]!]!, at, 0.26 + 0.1 * random(), arpIn)
    for (const note of bar) if (note.at === e) pianoAt(note.midi, at, (e === 0 ? 0.6 : 0.5) + 0.1 * random(), tuneIn)
    const g = GUITAR_AT.indexOf(e)
    if (g >= 0 && random() > GUITAR_REST) pluck(chord.pad[(g + b) % chord.pad.length]! - 12, at, 0.22 + 0.08 * random())
  }

  return {
    ready,
    start(at) {
      step = 0
      stepAt = at
      tune = makeTune(random)
      whole.gain.setValueAtTime(0, at)
      whole.gain.linearRampToValueAtTime(volume, at + START_FADE)
    },
    layers(top, at) {
      LAYERS.forEach((_, k) => {
        const now = k <= top
        if (now === on[k]) return
        on[k] = now
        voices[k]!.gain.setTargetAtTime(now ? 1 : 0, at, LAYER_FADE / 3)
      })
    },
    lay(until, from = -Infinity) {
      if (Number.isNaN(stepAt)) return
      while (stepAt < from) {
        step++
        stepAt += EIGHTH
      }
      for (; stepAt < until; step++, stepAt += EIGHTH) eighth(step, stepAt)
    },
    get volume() {
      return volume
    },
    set volume(to) {
      volume = to
      if (!Number.isNaN(stepAt)) whole.gain.setTargetAtTime(to, Math.max(context.currentTime, stepAt), 0.1)
    },
  }
}

export interface GooseMusic {
  /** Each frame: playing once `on`, with as many layers as `found` of `of` goslings bring in. */
  frame(on: boolean, found: number, of: number): void
  /** Its level, a share of the sounds' mix. */
  volume: number
  /** The top layer heard whatever the goslings, for the panel; undefined, as they bring it. */
  layers: number | undefined
}

/** The music on the sounds' context and through their bus, starting the first frame it is on once its piano is made. */
export function createGooseMusic(sounds: GooseSounds): GooseMusic {
  const { context } = sounds
  const music = createMusic(context, sounds.out)
  let made = false
  void music.ready.then(() => (made = true))
  let started = false
  return {
    layers: undefined,
    frame(on, found, of) {
      if (!made || context.state !== 'running' || (!started && !on)) return
      const now = context.currentTime
      if (!started) music.start(now + 0.1)
      started = true
      music.layers(this.layers ?? layersFor(found, of), now)
      music.lay(now + AHEAD, now)
    },
    get volume() {
      return music.volume
    },
    set volume(to) {
      music.volume = to
    },
  }
}
