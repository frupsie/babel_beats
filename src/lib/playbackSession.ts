// iPhones and iPads mute Web Audio when the ring/silent switch is on silent: the browser treats a page's sound like a
// game's sound effects. A guessing game is a music player, so it asks iOS to treat it as one:
//   - Safari with the Audio Session API (iOS 17 and later): set `navigator.audioSession.type` to "playback".
//   - Older iOS: while a round is in use, keep a silent <audio> element playing. As long as a media element plays,
//     iOS puts the page in its media-playback mode, which the silent switch does not mute, and Web Audio plays too.
// Either way, starting a clip pauses music from other apps, as any music player does.

interface AudioSessionLike {
  type: string;
}

/** The parts of the browser this module touches, so tests can pass stand-ins. */
export interface PlaybackEnv {
  navigator: { userAgent: string; maxTouchPoints: number; audioSession?: AudioSessionLike };
  document: {
    visibilityState: string;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
  };
  createAudio(): KeepAliveAudio;
}

/** The parts of an HTMLAudioElement the keep-alive uses. */
export interface KeepAliveAudio {
  src: string;
  loop: boolean;
  preload: string;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  setAttribute(name: string, value: string): void;
}

/** iPhone, iPod, or iPad (which reports itself as a Mac but has a touch screen). */
export function isAppleTouchDevice(nav: Pick<PlaybackEnv['navigator'], 'userAgent' | 'maxTouchPoints'>): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

/** A tiny silent WAV (mono, 8-bit, 8 kHz) as a data: URI, so the keep-alive needs no file on the server. */
export function silentWavDataUri(seconds = 0.5, sampleRate = 8000): string {
  const samples = Math.round(seconds * sampleRate);
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // bytes per second
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit PCM silence is the midpoint, 128
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export type PlaybackMethod = 'audio-session' | 'media-element' | 'none';

export class PlaybackSession {
  private keepAlive: KeepAliveAudio | null = null;
  readonly method: PlaybackMethod;

  constructor(private readonly env: PlaybackEnv) {
    const nav = env.navigator;
    this.method = nav.audioSession ? 'audio-session' : isAppleTouchDevice(nav) ? 'media-element' : 'none';
    if (this.method === 'audio-session') {
      try {
        nav.audioSession!.type = 'playback';
      } catch {
        // An unknown type throws in some versions; the page then just keeps the default behaviour.
      }
    }
    if (this.method === 'media-element') {
      // Don't keep iOS in playback mode (or show "Now Playing" on the lock screen) while the page is in the background.
      env.document.addEventListener('visibilitychange', () => {
        if (env.document.visibilityState === 'hidden') this.keepAlive?.pause();
      });
    }
  }

  /** Call from the click or tap that starts a clip (iOS only lets a media element start from one). */
  claim(): void {
    if (this.method !== 'media-element') return;
    if (!this.keepAlive) {
      const audio = this.env.createAudio();
      audio.src = silentWavDataUri();
      audio.loop = true;
      audio.preload = 'auto';
      audio.setAttribute('playsinline', '');
      audio.setAttribute('x-webkit-airplay', 'deny');
      this.keepAlive = audio;
    }
    if (this.keepAlive.paused) {
      try {
        void Promise.resolve(this.keepAlive.play()).catch(() => {});
      } catch {
        // If iOS refuses, clips still play; they just follow the silent switch as before.
      }
    }
  }
}

/** The real browser, for the app. */
export function browserPlaybackEnv(): PlaybackEnv {
  return {
    navigator: navigator as PlaybackEnv['navigator'],
    document,
    createAudio: () => new Audio(),
  };
}
