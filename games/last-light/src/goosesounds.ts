// The goose game's sounds (public/sounds/goose/: the ElevenLabs takes cut by _sfx/build.py, the fires and the pond
// cut to 20 s loops by _sfx/ambience.py, the wind and the leaves the justASimpleTree page's): three's AudioListener
// on the camera and plain Web Audio under it, each sound panned and fading from where it is made, so a gosling
// calling out of view is heard from its side. Every sound has a few takes, never the same one twice running, each
// played a little off its own pitch and level. The loops run from a place of their own, or everywhere, as the wind.
// Each sound has a tune the sound panel (soundpanel.ts) sets live: its volume, speed, pitch, if heard from a place how
// far it is heard at full level and where it falls silent, whether it is muted, and the takes left out; the mix starts as goosesounds.json has it, which the panel saves (tools/goosesounds-plugin.ts).
import { AudioListener, AudioLoader, type Camera } from 'three'
import saved from './goosesounds.json'
import builtTakes from './goosetakes.json'

/**
 * Each sound: its file type, its level as mixed and the rate it plays at; the files it plays, if another sound's;
 * where heard from a place, how far off it is heard at full level, m, and where it falls silent, fading in a straight
 * line between (the listener is the camera, ~5.5 m off her); none, heard everywhere. (Each was first `full` and an
 * inverse fade; `silent` was set where that fade's halfway, -6 dB, falls on the line.) Its takes are as _sfx/build.py made them (goosetakes.json), each
 * named by its ElevenLabs take, 'call_3' take #3; a file of its own, one take, ''. Low-passed at `lowpass` Hz, if given.
 * Steady, played as made every time, never a little off its pitch and level; a steady loop from its start.
 */
interface Sound {
  type: 'mp3' | 'wav' | 'ogg'
  gain: number
  rate?: number
  lowpass?: number
  file?: string
  full?: number
  silent?: number
  steady?: boolean
}
// Hers, and what she does at a scene, she always as near as the camera, are heard everywhere: no distance.
const SOUNDS = {
  // A gosling calling her from afar: the same peep as its happy one, its speed and pitch, every time.
  call: { type: 'mp3', gain: 1, rate: 1.15, full: 6, silent: 40, steady: true },
  // The goslings' fright in the opening: their call, higher; cowering at the strike, then quicker as they bolt.
  cower_peep: { type: 'mp3', file: 'call', gain: 0.8, rate: 1.15, full: 6, silent: 18 },
  panic_peep: { type: 'mp3', file: 'call', gain: 0.55, rate: 1.3, full: 6, silent: 18 },
  honk: { type: 'mp3', gain: 1 },
  wings: { type: 'mp3', gain: 0.9 },
  fright: { type: 'mp3', gain: 1 },
  hiss: { type: 'mp3', gain: 0.9 },
  // A gosling seeing her come: its call, higher, quicker and quicker as she comes; one peep, the same every time.
  happy_peep: { type: 'mp3', file: 'call', gain: 0.85, rate: 1.15, full: 6, silent: 26, steady: true },
  mutter: { type: 'mp3', gain: 0.8 },
  query: { type: 'mp3', gain: 0.7 },
  // Her steps, as her torch: heard everywhere, as near as she is.
  step: { type: 'mp3', gain: 0.55 },
  // A gosling's steps: hers, higher and quieter.
  gosling_step: { type: 'mp3', file: 'step', gain: 0.19, rate: 1.75, full: 6, silent: 18 },
  paddle_loop: { type: 'wav', gain: 0.8 },
  fire_crackling: { type: 'ogg', gain: 0.9, full: 6, silent: 14 },
  fire_calm: { type: 'ogg', gain: 0.55, full: 6, silent: 12 },
  // Her torch: a fire's calm burning, heard everywhere, always as near as she is.
  torch: { type: 'ogg', file: 'fire_calm', gain: 0.3 },
  river_calm: { type: 'ogg', gain: 0.5, full: 6, silent: 14 },
  wind: { type: 'ogg', gain: 0.3 },
  leaves: { type: 'ogg', gain: 0.22 },
  // The opening's strike, heard everywhere; her torch catching at a fire; the cage's padlock giving and its door
  // opening; the well's winch turning, a loop, as she winds it and as the bucket drops back.
  thunder: { type: 'mp3', gain: 1 },
  // The ground shaking as the rats rush in: the thunder an octave down, its crack cut, a rumble heard everywhere.
  quake: { type: 'mp3', file: 'thunder', gain: 1.4, rate: 0.5, lowpass: 220 },
  ignite: { type: 'mp3', gain: 0.7 },
  padlock: { type: 'mp3', gain: 0.9 },
  winch: { type: 'wav', gain: 0.8 },
  // A ghost's moan, from where it walks.
  moan: { type: 'mp3', gain: 0.8, full: 6, silent: 26 },
  // The swarm, outdoors, a silent horde made by _sfx/swarm.py: hundreds of rats running through the leaves round her,
  // not one calling, only their thousands of small steps, each from its own place, in three rings, each a stereo loop
  // heard everywhere, at one shared level as made: far, 14 to 32 m off; near, 5 to 15 m; and the edge, the rats at her
  // light's edge, running hardest.
  swarm_far: { type: 'ogg', gain: 1 },
  swarm_near: { type: 'ogg', gain: 1 },
  swarm_edge: { type: 'ogg', gain: 1 },
  // The music under it all, heard everywhere, from its start round and round: its_tigri's "Sword 13" (Pixabay
  // 188707, https://pixabay.com/users/its_tigri-42054041/), a 50 s piece.
  music: { type: 'mp3', gain: 0.4, steady: true },
  // The ending's music, once from its start as the ending starts, the track above faded out under it: Clavier
  // Clavier's "Childhood Memories" (Pixabay 304560, https://pixabay.com/users/clavier-music-16027823/), a 64 s piece,
  // ~5 dB louder than the track, so lower here.
  outro: { type: 'mp3', gain: 0.15, steady: true },
} satisfies Record<string, Sound>
export type GooseSound = keyof typeof SOUNDS
export const GOOSE_SOUNDS = Object.keys(SOUNDS) as GooseSound[]
const spec = (sound: GooseSound): Sound => SOUNDS[sound]

/**
 * How a sound is tuned on top of its mix: its volume and speed as shares, its pitch in semitones, if heard from a
 * place how far off at full level and where silent, m (its `full` and `silent`), muted, the takes never played (by name, '3' take #3), and
 * whether the panel's play loops it.
 */
export interface Tune {
  volume: number
  speed: number
  pitch: number
  full?: number
  silent?: number
  muted: boolean
  discarded: string[]
  loop: boolean
}
/** The mix as saved: its volume, and each sound's tune but the panel's loop. */
export interface SoundMix {
  volume: number
  sounds: Partial<Record<GooseSound, Omit<Tune, 'loop'>>>
}
const SAVED = saved as SoundMix
/** A sound's tune as goosesounds.json has it, else untouched. */
export function savedTune(sound: GooseSound): Tune {
  const kept = SAVED.sounds[sound]
  const { full, silent } = spec(sound)
  const tune = { volume: 1, speed: 1, pitch: 0, full, silent, muted: false, ...kept, discarded: [...(kept?.discarded ?? [])], loop: false }
  // A sound heard everywhere has no distance, whatever a mix saved before it lost one.
  if (full === undefined) {
    delete tune.full
    delete tune.silent
  }
  return tune
}
/** The sound's takes by name, as built. */
export const takesOf = (sound: GooseSound): string[] => (builtTakes as Record<string, string[]>)[spec(sound).file ?? sound] ?? ['']

/** How far off a take plays from its own pitch, either way, as a share; and from its level. */
const PITCH_SPREAD = 0.06
const GAIN_SPREAD = 0.15
/** How far a gosling walks between steps, m. */
const GOSLING_STRIDE = 0.25
/** The least time between two goslings' steps, s: a patter, however many walk with her. */
const PATTER_GAP = 0.15
/** How fast a loop's level follows what it is set to, s; the paddling's, into and out of the water. */
const LOOP_EASE = 0.15
const PADDLE_EASE = 0.25

export interface At {
  x: number
  y: number
  z: number
}

/** A loop, running from when it is first heard: silent until set louder. */
export interface Loop {
  /** Its level, 0 to 1 of its mix's; and where it is heard from, if from a place. */
  set(level: number, at?: At): void
}

export interface GooseSounds {
  /** One of the sound's takes, made at `at` (none, heard everywhere), `gain` its level over the mix's, `after` s from now. */
  play(sound: GooseSound, at?: At, gain?: number, after?: number): void
  /** A loop of the sound, from a time of its own into it and at `rate` its speed, so two of the same never sound as one. */
  loop(sound: GooseSound, rate?: number): Loop
  /**
   * Her feet, `dt` s on, standing at `at`: a step each time a foot comes down in her walk, `footfalls` the count so far
   * (meat.ts); paddling afloat (0 land to 1 afloat).
   */
  walk(at: At, dt: number, afloat: number, footfalls: number): void
  /** Gosling `k`'s feet, `dt` s on, at `at`: a small light step each GOSLING_STRIDE m, none afloat. */
  patter(k: number, at: At, dt: number, afloat: number): void
  /** Each sound's tune, set live. */
  readonly tunes: Record<GooseSound, Tune>
  /** A take of the sound, `take` if given, heard as tuned, from nowhere in particular, even paused; looped if its tune says so, till stopped. */
  preview(sound: GooseSound, take?: string): void
  /** The mix as it now is, to save. */
  mix(): SoundMix
  /** The mix put back as goosesounds.json has it. */
  revert(): void
  /** Every take of the sound now playing stopped: its loops in the game come back on their next frame. */
  stop(sound: GooseSound): void
  /** The whole mix's volume, a share. */
  volume: number
  /** Everything silent while muted, by the player; or hushed, the game paused. */
  muted: boolean
  hushed: boolean
  /** The context, and the bus every sound goes through, muted and hushed with them: the music's way in. */
  readonly context: AudioContext
  readonly out: AudioNode
}

/** The sounds, loading; nothing heard until the page is first clicked or keyed, as browsers ask, nor while it is hidden. */
export function createGooseSounds(camera: Camera, base = `${import.meta.env.BASE_URL}sounds/goose/`): GooseSounds {
  const listener = new AudioListener()
  camera.add(listener)
  const context = listener.context
  const master = new GainNode(context)
  master.connect(listener.getInput())
  // The panel's previews past the hush, so a paused game can still be listened to.
  const previews = new GainNode(context)
  previews.connect(listener.getInput())
  const unlock = () => {
    if (context.state === 'suspended') void context.resume()
  }
  addEventListener('pointerdown', unlock)
  addEventListener('keydown', unlock)
  const heard = () => {
    const on = muted || document.hidden ? 0 : volume
    master.gain.setTargetAtTime(hushed ? 0 : on, context.currentTime, 0.08)
    previews.gain.setTargetAtTime(on, context.currentTime, 0.08)
  }
  document.addEventListener('visibilitychange', heard)

  const tunes = Object.fromEntries(GOOSE_SOUNDS.map((sound) => [sound, savedTune(sound)])) as Record<GooseSound, Tune>
  const loader = new AudioLoader()
  const files = new Map<string, Promise<AudioBuffer[]>>()
  const takes = new Map<GooseSound, AudioBuffer[]>()
  const last = new Map<GooseSound, number>()
  for (const sound of GOOSE_SOUNDS) {
    const { type, file = sound } = spec(sound)
    const name = (take: string) => (take ? `${file}_${take}.${type}` : `${file}.${type}`)
    if (!files.has(file)) files.set(file, Promise.all(takesOf(sound).map((take) => loader.loadAsync(base + name(take)))))
    void files.get(file)!.then((buffers) => takes.set(sound, buffers))
  }
  /** Every take of each sound now playing, to stop. */
  const playing = new Map<GooseSound, Set<AudioBufferSourceNode>>(GOOSE_SOUNDS.map((sound) => [sound, new Set()]))

  /**
   * A level for the sound, `gain`, into `into`: through its low-pass if it has one, and a panner at `at` if it is heard
   * from a place; `unhook` takes them all down.
   */
  const placed = (sound: GooseSound, at: At | undefined, gain: number, into: AudioNode = master) => {
    const { lowpass } = spec(sound)
    const { full, silent } = spec(sound).full === undefined ? {} : tunes[sound]
    const level = new GainNode(context, { gain })
    const filter = lowpass === undefined ? undefined : new BiquadFilterNode(context, { type: 'lowpass', frequency: lowpass })
    const out = filter ? level.connect(filter) : level
    const panner =
      full === undefined || !at
        ? undefined
        : new PannerNode(context, {
            panningModel: 'HRTF',
            distanceModel: 'linear',
            refDistance: full,
            maxDistance: silent,
            rolloffFactor: 1,
            positionX: at.x,
            positionY: at.y,
            positionZ: at.z,
          })
    if (panner) out.connect(panner).connect(into)
    else out.connect(into)
    const unhook = () => [level, filter, panner].forEach((node) => node?.disconnect())
    return { level, panner, unhook }
  }
  const spread = (share: number) => 1 + (Math.random() * 2 - 1) * share
  /** The rate and detune a source of the sound plays at, tuned, `wander` its own share off. */
  const tuned = (source: AudioBufferSourceNode, sound: GooseSound, wander = 1) => {
    source.playbackRate.value = (spec(sound).rate ?? 1) * tunes[sound].speed * wander
    source.detune.value = tunes[sound].pitch * 100
  }
  /**
   * A source of one of the sound's takes, `take` if given, else any not discarded, never the one just played where there
   * is another; none if every take is discarded. Held as playing till it ends.
   */
  const source = (sound: GooseSound, buffers: AudioBuffer[], take?: string) => {
    const names = takesOf(sound)
    let k = take === undefined ? undefined : names.indexOf(take)
    if (k === undefined) {
      const kept = buffers.flatMap((_, j) => (tunes[sound].discarded.includes(names[j]!) ? [] : [j]))
      const fresh = kept.length > 1 ? kept.filter((j) => j !== last.get(sound)) : kept
      k = fresh[Math.floor(Math.random() * fresh.length)]
      if (k === undefined) return undefined
      last.set(sound, k)
    }
    const node = new AudioBufferSourceNode(context, { buffer: buffers[k]! })
    playing.get(sound)!.add(node)
    return node
  }

  const play = (sound: GooseSound, at?: At, gain = 1, after = 0) => {
    const buffers = takes.get(sound)
    if (!buffers || context.state !== 'running' || tunes[sound].muted) return
    const node = source(sound, buffers)
    if (!node) return
    const { steady } = spec(sound)
    tuned(node, sound, steady ? 1 : spread(PITCH_SPREAD))
    const { level, unhook } = placed(sound, at, spec(sound).gain * tunes[sound].volume * gain * (steady ? 1 : spread(GAIN_SPREAD)))
    node.connect(level)
    node.onended = () => {
      playing.get(sound)!.delete(node)
      node.disconnect()
      unhook()
    }
    node.start(context.currentTime + after)
  }

  const loop = (sound: GooseSound, rate = 1): Loop => {
    let running: (ReturnType<typeof placed> & { node: AudioBufferSourceNode }) | undefined
    return {
      set(to, at) {
        const buffers = takes.get(sound)
        if (!running) {
          if (!buffers || context.state !== 'running' || to <= 0) return
          const node = source(sound, buffers)
          if (!node) return
          node.loop = true
          running = { ...placed(sound, at, 0), node }
          node.connect(running.level)
          // Stopped from the panel, it starts again on its next frame.
          node.onended = () => {
            playing.get(sound)!.delete(node)
            node.disconnect()
            running?.unhook()
            running = undefined
          }
          node.start(0, spec(sound).steady ? 0 : Math.random() * buffers[0]!.duration)
        }
        const { muted: off, volume: louder } = tunes[sound]
        tuned(running.node, sound, rate)
        running.level.gain.setTargetAtTime(off ? 0 : spec(sound).gain * louder * to, context.currentTime, LOOP_EASE)
        if (running.panner) {
          running.panner.refDistance = tunes[sound].full!
          running.panner.maxDistance = tunes[sound].silent!
        }
        if (at && running.panner) {
          running.panner.positionX.value = at.x
          running.panner.positionY.value = at.y
          running.panner.positionZ.value = at.z
        }
      },
    }
  }

  /** Feet: how far they moved since last frame, m. */
  const feet = () => {
    let here: At | undefined
    return (at: At) => {
      const moved = here ? Math.hypot(at.x - here.x, at.z - here.z) : 0
      here = { ...at }
      return moved
    }
  }
  const hers = feet()
  let herFootfalls: number | undefined
  const paddle = loop('paddle_loop')
  let paddling = 0
  const goslings: ReturnType<typeof feet>[] = []
  const goslingWalked: number[] = []
  let patterAt = -Infinity

  let volume = SAVED.volume
  let muted = false
  let hushed = false
  heard()
  return {
    tunes,
    context,
    out: master,
    get volume() {
      return volume
    },
    set volume(to) {
      volume = to
      heard()
    },
    get muted() {
      return muted
    },
    set muted(on) {
      muted = on
      heard()
    },
    get hushed() {
      return hushed
    },
    set hushed(on) {
      if (on === hushed) return
      hushed = on
      heard()
    },
    play,
    loop,
    preview(sound, take) {
      unlock()
      const buffers = takes.get(sound)
      if (!buffers) return
      const node = source(sound, buffers, take)
      if (!node) return
      node.loop = tunes[sound].loop
      tuned(node, sound)
      const { level, unhook } = placed(sound, undefined, spec(sound).gain * tunes[sound].volume, previews)
      node.connect(level)
      node.onended = () => {
        playing.get(sound)!.delete(node)
        node.disconnect()
        unhook()
      }
      node.start()
    },
    mix() {
      const sounds = Object.fromEntries(GOOSE_SOUNDS.map((sound) => {
        const { loop: _, ...tune } = tunes[sound]
        return [sound, { ...tune, discarded: [...tune.discarded].sort() }]
      }))
      return { volume, sounds }
    },
    revert() {
      for (const sound of GOOSE_SOUNDS) Object.assign(tunes[sound], savedTune(sound))
      volume = SAVED.volume
      heard()
    },
    stop(sound) {
      for (const node of playing.get(sound)!) node.stop()
    },
    walk(at, dt, afloat, footfalls) {
      if (dt <= 0) return
      const moved = hers(at)
      // One step however many feet came down since, and none set down far off at once.
      if (herFootfalls !== undefined && footfalls > herFootfalls && moved <= 1 && afloat < 0.5) play('step', at)
      herFootfalls = footfalls
      // Afloat, her paddling as she swims, quiet as she floats still.
      const swimming = afloat * Math.min(1, moved / dt / 0.5)
      paddling += (swimming - paddling) * (1 - Math.exp(-dt / PADDLE_EASE))
      paddle.set(paddling, at)
    },
    patter(k, at, dt, afloat) {
      if (dt <= 0) return
      const moved = (goslings[k] ??= feet())(at)
      goslingWalked[k] = moved > 1 ? 0 : (goslingWalked[k] ?? 0) + moved * (1 - afloat)
      if (goslingWalked[k]! < GOSLING_STRIDE) return
      goslingWalked[k]! %= GOSLING_STRIDE
      if (context.currentTime - patterAt < PATTER_GAP) return
      patterAt = context.currentTime
      play('gosling_step', at)
    },
  }
}
