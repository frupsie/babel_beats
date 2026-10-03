/**
 * Clip playback on the Web Audio API. Previews are decoded up front so a clip can be cut to
 * sample-accurate lengths (down to 0.1 s), which an <audio> element cannot do.
 * Apple's preview host sends open CORS headers, which is what makes fetch + decode possible.
 */

import { clipStart } from './clipStart';
import { PlaybackSession, browserPlaybackEnv } from './playbackSession';

/** Where clips start in each preview (skipping a quiet opening), worked out once per decoded preview. */
const starts = new WeakMap<AudioBuffer, number>();
function startOf(buffer: AudioBuffer): number {
  let start = starts.get(buffer);
  if (start === undefined) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch));
    start = clipStart(channels, buffer.sampleRate);
    starts.set(buffer, start);
  }
  return start;
}

export class ClipEngine {
  private ctx: AudioContext | null = null;
  /** Every clip plays through this node, so one value controls the volume of everything. */
  private master: GainNode | null = null;
  /** Remembered here because the AudioContext (and so the master node) only exists after the first click. */
  private masterLevel = 1;
  private decoder: OfflineAudioContext | null = null;
  private cache = new Map<string, AudioBuffer>();
  private current: AudioBufferSourceNode | null = null;

  /**
   * Fetches and decodes a preview (cached). Safe to call before any user gesture. `onProgress` hears how much of the
   * download is done (0–1), when the server says how big the file is.
   */
  async load(url: string, signal?: AbortSignal, onProgress?: (done: number) => void): Promise<AudioBuffer> {
    const cached = this.cache.get(url);
    if (cached) {
      onProgress?.(1);
      return cached;
    }
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Preview download failed (HTTP ${res.status})`);
    const data = await readWithProgress(res, onProgress);
    // An offline context can decode without needing the autoplay-gated real one.
    this.decoder ??= new OfflineAudioContext(2, 44100, 44100);
    const buffer = await this.decoder.decodeAudioData(data);
    this.cache.set(url, buffer);
    if (this.cache.size > 3) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return buffer;
  }

  /** Sets the output level (linear gain, 0–1). Takes effect immediately, even mid-clip. */
  setVolume(gain: number): void {
    this.masterLevel = Math.min(1, Math.max(0, gain));
    if (this.ctx && this.master) {
      // A short glide instead of a jump avoids audible zipper noise while the slider is dragged.
      this.master.gain.setTargetAtTime(this.masterLevel, this.ctx.currentTime, 0.015);
    }
  }

  /** Keeps iPhones from muting clips when the silent switch is on (see playbackSession.ts). */
  private session: PlaybackSession | null = null;

  private output(): { ctx: AudioContext; master: GainNode } {
    if (!this.ctx || !this.master) {
      // Tell iOS this page is a music player before its audio context exists.
      this.session ??= new PlaybackSession(browserPlaybackEnv());
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterLevel;
      this.master.connect(this.ctx.destination);
    }
    return { ctx: this.ctx, master: this.master };
  }

  /** True once the page may start sound by itself (the visitor has clicked, tapped or pressed a key). */
  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * Unlocks audio on the visitor's first click, tap or key press anywhere on the page, so that later clips (a new
   * round's first clip, the longer clip after a skip) can play by themselves. Browsers block sound before that.
   */
  unlockOnFirstGesture(): void {
    const events = ['pointerdown', 'touchend', 'keydown'] as const;
    const onGesture = () => {
      this.unlock();
      if (this.ready) for (const e of events) window.removeEventListener(e, onGesture, true);
    };
    for (const e of events) window.addEventListener(e, onGesture, true);
  }

  /**
   * Gets audio ready to play later without a click, e.g. when a party round starts for everyone at once. Browsers (and
   * iOS above all) only allow that once the page has started audio from a click or tap, so call this from one.
   */
  unlock(): void {
    const { ctx } = this.output();
    this.session?.claim();
    void ctx.resume();
  }

  /** Plays `seconds` of the track from its clip start (see clipStart.ts). Must be called from a click/tap handler. */
  play(buffer: AudioBuffer, seconds: number, onEnded: () => void): void {
    this.stop();
    const { ctx, master } = this.output();
    this.session?.claim();
    void ctx.resume();

    const offset = startOf(buffer);
    const duration = Math.min(seconds, buffer.duration - offset);
    const startAt = ctx.currentTime + 0.02;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1, startAt);
    if (duration > 0.4) {
      // A 30 ms fade avoids an audible click where the clip is cut off.
      gain.gain.setValueAtTime(1, startAt + duration - 0.03);
      gain.gain.linearRampToValueAtTime(0, startAt + duration);
    }
    source.connect(gain).connect(master);
    source.onended = () => {
      if (this.current === source) {
        this.current = null;
        onEnded();
      }
    };
    source.start(startAt, offset, duration);
    this.current = source;
  }

  stop(): void {
    const source = this.current;
    if (!source) return;
    this.current = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
  }
}

/** Reads a response body, reporting progress when the size is known; otherwise reads it in one go. */
async function readWithProgress(res: Response, onProgress?: (done: number) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get('content-length'));
  if (!onProgress || !res.body || !Number.isFinite(total) || total <= 0) {
    const data = await res.arrayBuffer();
    onProgress?.(1);
    return data;
  }
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > out.length) {
      // The server sent more than it announced (compressed transfer): fall back to collecting the pieces.
      const grown = new Uint8Array(received + value.length);
      grown.set(out.subarray(0, received));
      grown.set(value, received);
      return finishGrowing(reader, grown, onProgress);
    }
    out.set(value, received);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  onProgress(1);
  return out.buffer.slice(0, received);
}

async function finishGrowing(reader: ReadableStreamDefaultReader<Uint8Array>, start: Uint8Array, onProgress: (done: number) => void) {
  const parts = [start];
  let size = start.length;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  onProgress(1);
  return out.buffer;
}
