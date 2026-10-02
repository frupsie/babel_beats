import { describe, expect, it } from 'vitest';
import { PlaybackSession, isAppleTouchDevice, silentWavDataUri, type KeepAliveAudio, type PlaybackEnv } from './playbackSession';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MAC = IPAD; // an iPad asks for the desktop site with a Mac user agent; only the touch screen tells them apart
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

class FakeAudio implements KeepAliveAudio {
  src = '';
  loop = false;
  preload = '';
  paused = true;
  plays = 0;
  attrs: Record<string, string> = {};
  play() {
    this.plays += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
}

function fakeEnv(userAgent: string, maxTouchPoints: number, audioSession?: { type: string }) {
  const listeners: (() => void)[] = [];
  const created: FakeAudio[] = [];
  const env: PlaybackEnv & { hide(): void; created: FakeAudio[] } = {
    navigator: { userAgent, maxTouchPoints, ...(audioSession ? { audioSession } : {}) },
    document: {
      visibilityState: 'visible',
      addEventListener: (_type, listener) => listeners.push(listener),
    },
    createAudio: () => {
      const a = new FakeAudio();
      created.push(a);
      return a;
    },
    created,
    hide() {
      env.document.visibilityState = 'hidden';
      listeners.forEach((l) => l());
    },
  };
  return env;
}

describe('isAppleTouchDevice', () => {
  it('spots iPhones and iPads, including an iPad asking for the desktop site', () => {
    expect(isAppleTouchDevice({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: IPAD, maxTouchPoints: 5 })).toBe(true);
  });

  it('leaves Macs and other computers alone', () => {
    expect(isAppleTouchDevice({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouchDevice({ userAgent: WINDOWS, maxTouchPoints: 0 })).toBe(false);
  });
});

describe('PlaybackSession', () => {
  it('uses the Audio Session API when Safari has it (iOS 17+), with no extra audio element', () => {
    const audioSession = { type: 'auto' };
    const env = fakeEnv(IPHONE, 5, audioSession);
    const session = new PlaybackSession(env);
    session.claim();
    expect(session.method).toBe('audio-session');
    expect(audioSession.type).toBe('playback');
    expect(env.created).toHaveLength(0);
  });

  it('on older iPhones, plays one silent looping <audio> from the click that starts a clip', () => {
    const env = fakeEnv(IPHONE, 5);
    const session = new PlaybackSession(env);
    expect(session.method).toBe('media-element');
    expect(env.created).toHaveLength(0); // nothing until the first clip
    session.claim();
    session.claim();
    expect(env.created).toHaveLength(1);
    const audio = env.created[0]!;
    expect(audio).toMatchObject({ loop: true, paused: false, plays: 1 });
    expect(audio.src.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(audio.attrs).toHaveProperty('playsinline');
  });

  it('pauses the silent audio when the page goes to the background and restarts it on the next clip', () => {
    const env = fakeEnv(IPHONE, 5);
    const session = new PlaybackSession(env);
    session.claim();
    env.hide();
    expect(env.created[0]!.paused).toBe(true);
    session.claim();
    expect(env.created[0]!).toMatchObject({ paused: false, plays: 2 });
  });

  it('does nothing on a computer', () => {
    const env = fakeEnv(WINDOWS, 0);
    const session = new PlaybackSession(env);
    session.claim();
    expect(session.method).toBe('none');
    expect(env.created).toHaveLength(0);
  });

  it('keeps working if iOS refuses to play the silent audio', () => {
    const env = fakeEnv(IPHONE, 5);
    env.createAudio = () => Object.assign(new FakeAudio(), { play: () => Promise.reject(new Error('NotAllowedError')) });
    const session = new PlaybackSession(env);
    expect(() => session.claim()).not.toThrow();
  });
});

describe('silentWavDataUri', () => {
  it('is a valid, silent 8-bit WAV', () => {
    const bytes = Uint8Array.from(atob(silentWavDataUri(0.5, 8000).split(',')[1]!), (c) => c.charCodeAt(0));
    const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
    expect([ascii(0, 4), ascii(8, 12), ascii(36, 40)]).toEqual(['RIFF', 'WAVE', 'data']);
    expect(bytes.length).toBe(44 + 4000);
    expect(bytes.slice(44).every((b) => b === 128)).toBe(true);
  });
});
