import { parseSettings, type Settings } from "./settings.ts";
import { PlaybackSession } from "./ios-audio.ts";

type Effect = "tap" | "coin" | "win" | "dig" | "step" | "door" | "heartbeat" | "noise" | "breath";
type Voice = { oscillator: OscillatorNode; gain: GainNode };
type Recording = "normal" | "horror" | "escape" | "laugh";
const recordingPaths: Record<Recording, string> = {
  normal: "/assets/audio/bubble-day-soft-v1.mp3",
  horror: "/assets/audio/haunted-bath-v1.mp3",
  escape: "/assets/audio/sewer-escape-v1.mp3",
  laugh: "/assets/audio/haunted-laugh-v1.mp3",
};
const unlockEvents = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
const effectNotes: Record<Effect, { frequencies: number[]; step: number; type: OscillatorType }> = {
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
  private async playHaunt(preview = false, allowNormalMode = false): Promise<boolean> {
    const generation = this.effectGeneration;
    if ((!allowNormalMode && !this.scaryMode) || (!preview && !this.settings.sound) || this.disposed || document.hidden) return false;
    if (!await this.unlock()) return false;
    const buffer = await this.loadRecording("laugh"), context = this.context;
    if (!buffer || generation !== this.effectGeneration || (!preview && !this.settings.sound) || (!allowNormalMode && !this.scaryMode) || this.disposed || document.hidden || context?.state !== "running") { this.releasePlaybackIfIdle(); return false; }
    this.playback.activate();
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; gain.gain.setValueAtTime(.32, context.currentTime);
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
  effect(effect: Effect): void {
    if (this.disposed || document.hidden) return;
    if (effect === "dig") {
      const now = performance.now();
      if (now - this.lastDigAt < 100) return;
      this.lastDigAt = now;
    }
    if (this.settings.vibration && ["tap", "coin", "win", "door"].includes(effect) && "vibrate" in navigator)
      navigator.vibrate(effect === "win" ? 28 : effect === "coin" ? 18 : 8);
    if (!this.settings.sound) return;
    if (this.context?.state === "running") this.playEffect(effect);
    else void this.unlock().then(ready => {
      if (ready && this.settings.sound) this.playEffect(effect);
    });
  }
  private playEffect(effect: Effect): void {
    const context = this.context;
    if (!context || context.state !== "running" || this.disposed || document.hidden) return;
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
