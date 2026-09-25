/**
 * Clip playback on the Web Audio API. Previews are decoded up front so a clip can be cut to
 * sample-accurate lengths (down to 0.1 s), which an <audio> element cannot do.
 * Apple's preview host sends open CORS headers, which is what makes fetch + decode possible.
 */

/** AAC previews often begin with a few ms of encoder silence; skip it so a 0.1 s clip is not mostly silence. */
export function firstAudibleOffset(buffer: AudioBuffer, threshold = 0.01, maxSeconds = 0.6): number {
  const limit = Math.min(buffer.length, Math.floor(buffer.sampleRate * maxSeconds));
  let first = limit;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < first; i++) {
      if (Math.abs(data[i]!) > threshold) {
        first = i;
        break;
      }
    }
  }
  if (first >= limit) return 0;
  return Math.max(0, first / buffer.sampleRate - 0.005);
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

  /** Fetches and decodes a preview (cached). Safe to call before any user gesture. */
  async load(url: string, signal?: AbortSignal): Promise<AudioBuffer> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Preview download failed (HTTP ${res.status})`);
    const data = await res.arrayBuffer();
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

  private output(): { ctx: AudioContext; master: GainNode } {
    if (!this.ctx || !this.master) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterLevel;
      this.master.connect(this.ctx.destination);
    }
    return { ctx: this.ctx, master: this.master };
  }

  /** Plays the first `seconds` of the track. Must be called from a click/tap handler. */
  play(buffer: AudioBuffer, seconds: number, onEnded: () => void): void {
    this.stop();
    const { ctx, master } = this.output();
    void ctx.resume();

    const offset = firstAudibleOffset(buffer);
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
