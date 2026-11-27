import { parseSettings, type Settings } from "./settings.ts";
import { PlaybackSession } from "./ios-audio.ts";

type Effect = "tap" | "coin" | "win" | "dig" | "step" | "door" | "heartbeat" | "noise" | "breath" | RunnerEffect;
/** Sounds made for the runner, each a few tone and filtered-noise sweeps. */
export type RunnerEffect = "jump" | "jump2" | "slide" | "land" | "swish" | "whoosh" | "bump" | "crash" | "splash" | "power" | "chest" | "step-stone" | "step-wood" | "step-snow" | "step-gravel";
/** Sounds that keep going while something lasts: the zipline pulley, rain on the road, wind at speed. */
export type RunnerLoop = "zip" | "rain" | "wind";
/** One layer of a synthesized sound: a tone or a band of noise sweeping from one frequency to another. */
type Sweep = { kind: "tone" | "noise"; from: number; to: number; volume: number; time: number; delay?: number; type?: OscillatorType; filter?: BiquadFilterType; q?: number };
const arpeggio = (notes: number[], gap: number, volume: number, time: number, type: OscillatorType = "triangle"): Sweep[] =>
  notes.map((note, index) => ({ kind: "tone", type, from: note, to: note, volume, time, delay: index * gap }));
const runnerSounds: Record<RunnerEffect, Sweep[]> = {
  jump: [{ kind: "noise", filter: "bandpass", q: 1.1, from: 700, to: 2600, volume: .07, time: .2 }, { kind: "tone", type: "sine", from: 360, to: 720, volume: .045, time: .13 }],
  jump2: [{ kind: "noise", filter: "bandpass", q: 1.3, from: 1000, to: 3600, volume: .07, time: .2 }, { kind: "tone", type: "sine", from: 540, to: 1260, volume: .05, time: .15 }],
  slide: [{ kind: "noise", filter: "bandpass", q: .9, from: 2400, to: 450, volume: .08, time: .3 }, { kind: "tone", type: "sine", from: 240, to: 140, volume: .035, time: .18 }],
  land: [{ kind: "tone", type: "sine", from: 160, to: 52, volume: .1, time: .13 }, { kind: "noise", filter: "lowpass", from: 600, to: 200, volume: .04, time: .08 }],
  swish: [{ kind: "noise", filter: "bandpass", q: 2.2, from: 1900, to: 1100, volume: .032, time: .09 }],
  whoosh: [{ kind: "noise", filter: "bandpass", q: 1.6, from: 3200, to: 700, volume: .075, time: .26 }, { kind: "tone", type: "sine", from: 1400, to: 700, volume: .02, time: .2 }],
  bump: [{ kind: "noise", filter: "lowpass", q: .7, from: 900, to: 160, volume: .13, time: .2 }, { kind: "tone", type: "sine", from: 120, to: 44, volume: .13, time: .2 }],
  crash: [{ kind: "noise", filter: "lowpass", q: .8, from: 1500, to: 110, volume: .17, time: .34 }, { kind: "tone", type: "triangle", from: 96, to: 36, volume: .14, time: .32 }],
  splash: [
    { kind: "noise", filter: "lowpass", q: .6, from: 2800, to: 360, volume: .17, time: .6 },
    { kind: "tone", type: "sine", from: 700, to: 1300, volume: .03, time: .06, delay: .13 },
    { kind: "tone", type: "sine", from: 900, to: 1600, volume: .025, time: .05, delay: .26 },
    { kind: "tone", type: "sine", from: 600, to: 1100, volume: .02, time: .05, delay: .38 },
  ],
  power: [...arpeggio([523, 659, 784, 1047], .055, .07, .13), { kind: "tone", type: "sine", from: 2093, to: 2637, volume: .025, time: .3, delay: .15 }],
  chest: arpeggio([1047, 1319, 1568, 2093, 2637], .05, .055, .11, "sine"),
  // Paws on the ground: a click on stone, a hollow knock on wood, a crunch in snow, a scuff on gravel.
  "step-stone": [{ kind: "noise", filter: "bandpass", q: 1.4, from: 2400, to: 1300, volume: .028, time: .035 }, { kind: "tone", type: "sine", from: 190, to: 120, volume: .02, time: .03 }],
  "step-wood": [{ kind: "tone", type: "triangle", from: 240, to: 165, volume: .032, time: .055 }, { kind: "noise", filter: "bandpass", q: 2, from: 750, to: 600, volume: .02, time: .04 }],
  "step-snow": [{ kind: "noise", filter: "lowpass", q: .8, from: 2200, to: 800, volume: .042, time: .075 }],
  "step-gravel": [{ kind: "noise", filter: "bandpass", q: .7, from: 1600, to: 1000, volume: .034, time: .05 }],
};
/** How each loop sounds: band of noise (centre frequency, sharpness) and its loudness at level 1. */
const LOOPS: Record<RunnerLoop, { frequency: number; q: number; volume: number; type: BiquadFilterType }> = {
  zip: { frequency: 700, q: 5, volume: .05, type: "bandpass" },
  rain: { frequency: 1500, q: .45, volume: .07, type: "bandpass" },
  wind: { frequency: 420, q: .9, volume: .06, type: "bandpass" },
};
const isRunnerEffect = (effect: Effect): effect is RunnerEffect => effect in runnerSounds;
/** Rising notes for a run of coins, so a long trail climbs up the scale. */
const CHIME_SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
type Voice = { oscillator: OscillatorNode; gain: GainNode };
type Recording = "normal" | "horror" | "escape" | "laugh" | "whimper";
const recordingPaths: Record<Recording, string> = {
  normal: "/assets/audio/bubble-day-soft-v1.mp3",
  horror: "/assets/audio/haunted-bath-v1.mp3",
  escape: "/assets/audio/sewer-escape-v1.mp3",
  laugh: "/assets/audio/haunted-laugh-v1.mp3",
  // “Puppy (8)” by johnnypanic, CC0 (https://freesound.org/s/728029/).
  whimper: "/assets/audio/runner-puppy-whimper-v1.mp3",
};
const unlockEvents = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
const effectNotes: Record<Exclude<Effect, RunnerEffect>, { frequencies: number[]; step: number; type: OscillatorType }> = {
  tap: { frequencies: [520], step: .07, type: "sine" },
  coin: { frequencies: [660, 990], step: .09, type: "sine" },
  win: { frequencies: [523, 659, 784, 1047], step: .12, type: "triangle" },
  dig: { frequencies: [185], step: .09, type: "sine" },
  step: { frequencies: [82, 55], step: .045, type: "triangle" },
  door: { frequencies: [94, 72, 48], step: .09, type: "triangle" },
  heartbeat: { frequencies: [52, 36], step: .10, type: "sine" },
  noise: { frequencies: [240, 90, 170, 55], step: .07, type: "triangle" },
  breath: { frequencies: [120], step: .38, type: "triangle" },
};

export class AudioManager {
  private settings: Settings;
  private context?: AudioContext;
  private playback = new PlaybackSession();
  private playing = false;
  private disposed = false;
  private lastDigAt = -Infinity;
  private musicSource?: AudioBufferSourceNode;
  private musicGain?: GainNode;
  private mode: "normal" | "horror" | "escape" = "normal";
  private buffers: Partial<Record<Recording, AudioBuffer>> = {};
  private loading: Partial<Record<Recording, Promise<AudioBuffer | undefined>>> = {};
  private get musicBuffer() { return this.buffers[this.mode]; }
  private get scaryMode() { return this.mode !== "normal"; }
  private effectGeneration = 0;
  private sampledVoices = new Map<AudioBufferSourceNode, GainNode>();
  private musicOffset = 0;
  private musicStartedAt = 0;
  private previewTimer?: number;
  private previewingMusic = false;
  private preparingPreview = false;
  private previewGeneration = 0;
  private voices = new Set<Voice>();
  private readonly onGesture = (event: Event) => {
    if (event.isTrusted && (this.settings.sound || this.settings.music))
      void this.unlock().then(() => this.releasePlaybackIfIdle());
  };
  private readonly onVisibilityChange = () => {
    if (document.hidden) {
      this.stopPreview();
      this.stopVoices();
      this.syncMusic();
      this.playback.release();
    } else this.resume();
  };

  constructor(settings: Settings) {
    this.settings = parseSettings(settings);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    for (const event of unlockEvents) document.addEventListener(event, this.onGesture, true);
  }
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.settings.sound || this.settings.music || this.preparingPreview) this.playback.activate();
    if (!this.context || this.context.state === "closed") {
      const Constructor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) { this.playback.release(); return false; }
      try { this.context = new Constructor(); } catch { this.playback.release(); return false; }
    }
    const context = this.context;
    if (context.state === "running") {
      this.syncMusic();
      return true;
    }
    let timer: number | undefined;
    let ready = false;
    try {
      // Retry in THIS gesture: a pending pointerdown resume must not swallow
      // the later touchend/click that WebKit accepts as activation.
      const attempt = context.resume().then(() => {
        if (this.disposed || this.context !== context || context.state !== "running") return false;
        this.syncMusic();
        return true;
      }).catch(() => false);
      ready = await Promise.race([
        attempt,
        new Promise<boolean>(resolve => { timer = window.setTimeout(() => resolve(false), 2000); }),
      ]);
      return ready;
    } catch { return false; }
    finally {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!ready) this.releasePlaybackIfIdle();
    }
  }
  recover(): Promise<boolean> {
    this.stopPreview(); this.stopMusic(); this.stopVoices();
    if (this.disposed) return Promise.resolve(false);
    this.playback.activate(true);
    return this.preview("sound");
  }
  resume(): void { if (this.context && (this.settings.music || this.settings.sound)) void this.unlock(); }
  suspend(): void {
    this.stopPreview();
    this.stopMusic();
    this.stopVoices();
    this.playback.release();
    if (this.context?.state === "running") void this.context.suspend().catch(() => {});
  }
  setSettings(settings: Settings): void {
    this.settings = parseSettings(settings);
    if (!this.settings.sound) this.stopVoices();
    if (!this.settings.music) this.stopPreview();
    this.syncMusic();
    if (!this.settings.music && !this.settings.sound) this.playback.release();
  }
  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (!playing) this.stopSamples();
    this.syncMusic();
    if (!playing) this.playback.release();
  }
  setMode(requested: "normal" | "horror" | "escape" | "halloween" | "infernal"): void {
    const mode = requested === "infernal" ? "escape" : requested === "halloween" ? "horror" : requested;
    if (this.mode === mode) return;
    this.stopPreview();
    this.stopMusic();
    this.mode = mode;
    this.musicOffset = 0;
    this.syncMusic();
  }
  haunt({ allowNormalMode = false } = {}): void { void this.playHaunt(false, allowNormalMode); }
  whimper(): void { void this.playSample("whimper", .22, () => this.settings.sound); }
  private playHaunt(preview: boolean, allowNormalMode = false): Promise<boolean> {
    return this.playSample("laugh", .32, () => (preview || this.settings.sound) && (allowNormalMode || this.scaryMode));
  }
  private async playSample(recording: "laugh" | "whimper", volume: number, permitted: () => boolean): Promise<boolean> {
    const generation = this.effectGeneration;
    const canPlay = () => permitted() && !this.disposed && !document.hidden;
    if (!canPlay()) return false;
    if (!await this.unlock()) return false;
    const buffer = await this.loadRecording(recording), context = this.context;
    if (!buffer || generation !== this.effectGeneration || !canPlay() || context?.state !== "running") { this.releasePlaybackIfIdle(); return false; }
    this.playback.activate();
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; gain.gain.setValueAtTime(volume, context.currentTime);
    source.connect(gain); gain.connect(context.destination);
    this.sampledVoices.set(source, gain);
    source.onended = () => { this.sampledVoices.delete(source); source.disconnect(); gain.disconnect(); this.releasePlaybackIfIdle(); };
    source.start();
    return true;
  }
  async preview(kind: "music" | "sound"): Promise<boolean> {
    this.stopPreview();
    const generation = this.previewGeneration;
    this.preparingPreview = true;
    try {
      if (!await this.unlock() || generation !== this.previewGeneration || document.hidden) { this.releasePlaybackIfIdle(); return false; }
      if (kind === "music") {
        if (!await this.loadMusic() || generation !== this.previewGeneration || this.disposed || document.hidden || this.context?.state !== "running") { this.releasePlaybackIfIdle(); return false; }
        if (!this.musicSource) this.musicOffset = 0;
        this.previewingMusic = true;
        this.syncMusic();
        this.previewTimer = window.setTimeout(() => {
          this.previewTimer = undefined;
          this.previewingMusic = false;
          this.syncMusic();
          this.releasePlaybackIfIdle();
        }, 4000);
      } else if (this.mode !== "normal") return await this.playHaunt(true);
      else this.playEffect("win");
      return true;
    } finally {
      if (generation === this.previewGeneration) {
        this.preparingPreview = false;
        this.releasePlaybackIfIdle();
      }
    }
  }
  stopPreview(): void {
    this.previewGeneration++;
    if (this.previewTimer !== undefined) window.clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
    this.previewingMusic = false;
    this.preparingPreview = false;
    this.stopVoices();
    this.syncMusic();
    this.releasePlaybackIfIdle();
  }
  effect(effect: Effect, pan = 0): void {
    if (this.disposed || document.hidden) return;
    if (effect === "dig") {
      const now = performance.now();
      if (now - this.lastDigAt < 100) return;
      this.lastDigAt = now;
    }
    if (this.settings.vibration && ["tap", "coin", "win", "door"].includes(effect) && "vibrate" in navigator)
      navigator.vibrate(effect === "win" ? 28 : effect === "coin" ? 18 : 8);
    if (!this.settings.sound) return;
    if (this.context?.state === "running") this.playEffect(effect, pan);
    else void this.unlock().then(ready => {
      if (ready && this.settings.sound) this.playEffect(effect, pan);
    });
  }
  /** A coin in a run of coins: each one a step higher up the scale (0 is the first). */
  chime(step: number, pan = 0): void {
    if (this.disposed || document.hidden || !this.settings.sound) return;
    const note = 880 * 2 ** (CHIME_SCALE[Math.max(0, Math.min(CHIME_SCALE.length - 1, Math.floor(step)))] / 12);
    const layers: Sweep[] = [{ kind: "tone", type: "sine", from: note, to: note, volume: .06, time: .07 }, { kind: "tone", type: "sine", from: note * 1.5, to: note * 1.5, volume: .045, time: .12, delay: .045 }];
    if (this.context?.state === "running") this.playSweeps(layers, pan);
    else void this.unlock().then(ready => { if (ready && this.settings.sound) this.playSweeps(layers, pan); });
  }
  private noise?: AudioBuffer;
  private runnerBus?: { context: AudioContext; input: GainNode };
  private bus(context: AudioContext) {
    if (this.runnerBus?.context === context) return this.runnerBus.input;
    const input = context.createGain(), squeeze = context.createDynamicsCompressor();
    input.gain.value = .95;
    squeeze.threshold.value = -16; squeeze.knee.value = 10; squeeze.ratio.value = 4; squeeze.attack.value = .004; squeeze.release.value = .2;
    input.connect(squeeze); squeeze.connect(context.destination);
    this.runnerBus = { context, input };
    return input;
  }
  private loops = new Map<RunnerLoop, { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; level: number; pitch: number }>();
  /**
   * A sound that lasts as long as something does, such as the pulley whirring along a zipline: called
   * every frame with how loud (0 stops it) and how high (1 normal) it should be.
   */
  /** The zipline's pulley (kept for callers that only know this one). */
  hum(level: number, pitch = 1): void { this.loop("zip", level, pitch); }
  /**
   * A sound that lasts as long as something does: called every frame with how loud (0 stops it) and
   * how high (1 normal) it should be.
   */
  loop(name: RunnerLoop, level: number, pitch = 1): void {
    const context = this.context, voice = this.loops.get(name), spec = LOOPS[name];
    const live = voice && this.sampledVoices.has(voice.source);
    if (level <= 0 || !this.settings.sound || !context || context.state !== "running" || document.hidden || this.disposed) {
      if (live && context) {
        voice.gain.gain.setTargetAtTime(.0001, context.currentTime, .12);
        voice.source.stop(context.currentTime + .6);
      }
      this.loops.delete(name);
      return;
    }
    if (live) {
      if (Math.abs(voice.level - level) < .02 && Math.abs(voice.pitch - pitch) < .02) return;
      voice.level = level; voice.pitch = pitch;
      voice.gain.gain.setTargetAtTime(level * spec.volume, context.currentTime, .15);
      voice.filter.frequency.setTargetAtTime(spec.frequency * pitch, context.currentTime, .15);
      return;
    }
    this.playback.activate();
    if (!this.noise || this.noise.sampleRate !== context.sampleRate) this.makeNoise(context);
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = this.noise!; source.loop = true;
    filter.type = spec.type; filter.Q.value = spec.q; filter.frequency.value = spec.frequency * pitch;
    gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.setTargetAtTime(level * spec.volume, context.currentTime, .25);
    source.connect(filter); filter.connect(gain); gain.connect(this.bus(context));
    this.sampledVoices.set(source, gain);
    source.onended = () => { this.sampledVoices.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); this.releasePlaybackIfIdle(); };
    source.start(context.currentTime, Math.random() * .8);
    this.loops.set(name, { source, filter, gain, level, pitch });
  }
  private makeNoise(context: AudioContext) {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
  }
  /** Layers tones and noise sweeps into one short sound, tracked so a hidden page silences it. */
  private playSweeps(layers: Sweep[], pan = 0, pitch = 1): void {
    const context = this.context;
    if (!context || context.state !== "running" || this.disposed || document.hidden) return;
    this.playback.activate();
    if (!this.noise || this.noise.sampleRate !== context.sampleRate) this.makeNoise(context);
    // From the side of the road the dog is on.
    let out: AudioNode = this.bus(context), panner: StereoPannerNode | undefined;
    if (pan && typeof context.createStereoPanner === "function") {
      panner = context.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan)); panner.connect(out); out = panner;
      const last = Math.max(...layers.map(layer => (layer.delay ?? 0) + layer.time));
      window.setTimeout(() => panner?.disconnect(), (last + .3) * 1000);
    }
    for (const layer of layers) {
      const start = context.currentTime + (layer.delay ?? 0), end = start + layer.time;
      const gain = context.createGain();
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(layer.volume, start + Math.min(.012, layer.time / 3));
      gain.gain.exponentialRampToValueAtTime(.0001, end);
      gain.connect(out);
      if (layer.kind === "tone") {
        const oscillator = context.createOscillator();
        oscillator.type = layer.type ?? "sine";
        oscillator.frequency.setValueAtTime(layer.from * pitch, start);
        if (layer.to !== layer.from) oscillator.frequency.exponentialRampToValueAtTime(layer.to * pitch, end);
        oscillator.connect(gain);
        const voice = { oscillator, gain };
        this.voices.add(voice);
        oscillator.onended = () => { this.voices.delete(voice); oscillator.disconnect(); gain.disconnect(); this.releasePlaybackIfIdle(); };
        oscillator.start(start); oscillator.stop(end + .02);
      } else {
        const source = context.createBufferSource(), filter = context.createBiquadFilter();
        source.buffer = this.noise!; filter.type = layer.filter ?? "bandpass"; filter.Q.value = layer.q ?? 1;
        filter.frequency.setValueAtTime(layer.from * pitch, start);
        if (layer.to !== layer.from) filter.frequency.exponentialRampToValueAtTime(layer.to * pitch, end);
        source.connect(filter); filter.connect(gain);
        this.sampledVoices.set(source, gain);
        source.onended = () => { this.sampledVoices.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); this.releasePlaybackIfIdle(); };
        source.start(start, Math.random() * .5); source.stop(end + .02);
      }
    }
  }
  private playEffect(effect: Effect, pan = 0): void {
    const context = this.context;
    if (!context || context.state !== "running" || this.disposed || document.hidden) return;
    // A little higher or lower each time, so repeats (steps, jumps, coins) never sound mechanical.
    if (isRunnerEffect(effect)) { this.playSweeps(runnerSounds[effect], pan, .96 + Math.random() * .08); return; }
    this.playback.activate();
    if (effect === "breath") {
      const length = Math.floor(context.sampleRate * .42), buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / length) ** .7;
      const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
      source.buffer = buffer; filter.type = "bandpass"; filter.frequency.value = 820; filter.Q.value = .65;
      gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.linearRampToValueAtTime(.11, context.currentTime + .07); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .4);
      source.connect(filter); filter.connect(gain); gain.connect(context.destination); this.sampledVoices.set(source, gain);
      source.onended = () => { this.sampledVoices.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); this.releasePlaybackIfIdle(); };
      source.start(); return;
    }
    const spec = effectNotes[effect], now = context.currentTime,
      duration = spec.frequencies.length * spec.step, volume = effect === "dig" ? .07 : effect === "step" ? .055 : effect === "heartbeat" ? .09 : .12;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = spec.type;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + .012);
    gain.gain.setValueAtTime(volume, now + Math.max(.02, duration - .045));
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    spec.frequencies.forEach((frequency, index) => oscillator.frequency.setValueAtTime(frequency, now + index * spec.step));
    oscillator.connect(gain); gain.connect(context.destination);
    const voice = { oscillator, gain };
    this.voices.add(voice);
    oscillator.onended = () => { this.voices.delete(voice); oscillator.disconnect(); gain.disconnect(); this.releasePlaybackIfIdle(); };
    oscillator.start(now); oscillator.stop(now + duration + .015);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playing = false;
    this.stopPreview(); this.stopMusic(); this.stopVoices();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    for (const event of unlockEvents) document.removeEventListener(event, this.onGesture, true);
    this.playback.dispose();
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }
  private syncMusic(): void {
    if (((!this.playing || !this.settings.music) && !this.previewingMusic) || !this.context || this.disposed || document.hidden || this.context.state !== "running") {
      this.stopMusic(); return;
    }
    if (this.musicSource) return;
    if (this.musicBuffer) this.startMusic();
    else void this.loadMusic().then(buffer => { if (buffer) this.syncMusic(); });
  }
  private releasePlaybackIfIdle(): void {
    if (!this.playing && !this.previewingMusic && !this.preparingPreview && !this.voices.size && !this.sampledVoices.size) this.playback.release();
  }
  private loadMusic(): Promise<AudioBuffer | undefined> {
    return this.loadRecording(this.mode);
  }
  private loadRecording(key: Recording): Promise<AudioBuffer | undefined> {
    if (this.buffers[key]) return Promise.resolve(this.buffers[key]);
    if (this.loading[key]) return this.loading[key];
    const context = this.context;
    if (!context || this.disposed) return Promise.resolve(undefined);
    this.loading[key] = (async () => {
      try {
        const response = await fetch(recordingPaths[key]);
        if (!response.ok) return undefined;
        const bytes = await response.arrayBuffer();
        if (this.disposed || this.context !== context) return undefined;
        const buffer = await context.decodeAudioData(bytes);
        if (this.disposed || this.context !== context) return undefined;
        this.buffers[key] = buffer;
        return buffer;
      } catch { return undefined; }
    })().finally(() => { delete this.loading[key]; });
    return this.loading[key];
  }
  private startMusic(): void {
    const context = this.context, buffer = this.musicBuffer;
    if (!context || context.state !== "running" || !buffer || this.musicSource) return;
    // Dialog close and decoded recordings may resume after the gesture task.
    this.playback.activate();
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    // Original horror master is exactly 32 seconds; exclude MP3 padding.
    if (this.mode === "horror") source.loopEnd = Math.min(32, buffer.duration);
    if (this.mode === "escape") source.loopEnd = Math.min(48, buffer.duration);
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.linearRampToValueAtTime(this.mode === "escape" ? .42 : .65, context.currentTime + .18);
    source.connect(gain); gain.connect(context.destination);
    this.musicStartedAt = context.currentTime;
    source.start(context.currentTime, this.musicOffset);
    this.musicSource = source; this.musicGain = gain;
  }
  private stopMusic(): void {
    const source = this.musicSource, gain = this.musicGain;
    this.musicSource = undefined; this.musicGain = undefined;
    if (!source || !gain) return;
    if (this.context && this.musicBuffer)
      this.musicOffset = (this.musicOffset + Math.max(0, this.context.currentTime - this.musicStartedAt)) % (source.loopEnd || this.musicBuffer.duration);
    try { source.stop(); } catch { /* Already stopped. */ }
    source.disconnect(); gain.disconnect();
  }
  private stopSamples(): void {
    this.effectGeneration++;
    for (const [source, gain] of this.sampledVoices) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect(); gain.disconnect();
    }
    this.sampledVoices.clear();
  }
  private stopVoices(): void {
    this.stopSamples();
    for (const { oscillator, gain } of this.voices) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch { /* Already ended. */ }
      oscillator.disconnect(); gain.disconnect();
    }
    this.voices.clear();
  }
}
