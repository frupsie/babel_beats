import { describe, expect, it } from 'vitest';
import { compact, hasHan, stripDecor, titleKey } from './text';

describe('compact', () => {
  it('folds case, punctuation, spacing and Latin diacritics', () => {
    expect(compact("Don't Stop Believin'")).toBe('dontstopbelievin');
    expect(compact('Beyoncé')).toBe('beyonce');
    expect(compact('R.E.M.')).toBe('rem');
    expect(compact('...Baby One More Time')).toBe('babyonemoretime');
  });

  it('folds full-width and half-width forms', () => {
    expect(compact('Ｌｅｍｏｎ')).toBe('lemon');
    expect(compact('ｷｾｷ')).toBe(compact('キセキ'));
  });

  it('treats katakana and hiragana as the same', () => {
    expect(compact('キセキ')).toBe(compact('きせき'));
    expect(compact('ロビンソン')).toBe(compact('ろびんそん'));
  });

  it('keeps Japanese voiced marks intact through normalisation', () => {
    expect(compact('ブルーバード')).toBe(compact('ぶるーばーど'));
    expect(compact('が')).not.toBe(compact('か'));
  });

  it('keeps Chinese characters and drops full-width punctuation', () => {
    expect(compact('你，好不好？')).toBe('你好不好');
  });
});

describe('stripDecor', () => {
  it('removes feature credits and version suffixes', () => {
    expect(stripDecor('Uptown Funk (feat. Bruno Mars)')).toBe('Uptown Funk');
    expect(stripDecor('Hallelujah - Remastered 2011')).toBe('Hallelujah');
    expect(stripDecor('Stay ft. Justin Bieber')).toBe('Stay');
  });

  it('removes nested brackets from Apple-style titles', () => {
    expect(stripDecor('你,好不好?(TVBS連續劇【遺憾拼圖】片尾曲)')).toBe('你,好不好?');
  });

  it('never returns an empty title', () => {
    expect(stripDecor('(Untitled)')).toBe('(Untitled)');
  });

  it('titleKey ignores decoration and script variants of punctuation', () => {
    expect(titleKey('Single Ladies (Put a Ring on It)')).toBe(titleKey('Single Ladies'));
  });
});

describe('hasHan', () => {
  it('detects Han characters only', () => {
    expect(hasHan('晴天')).toBe(true);
    expect(hasHan('さくら')).toBe(false);
    expect(hasHan('Lemon')).toBe(false);
  });
});
