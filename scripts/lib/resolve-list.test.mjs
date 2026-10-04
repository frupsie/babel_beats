import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSongList } from './resolve-list.mjs';

describe('readSongList', () => {
  async function read(text) {
    const dir = await mkdtemp(path.join(tmpdir(), 'babel-list-'));
    try {
      const file = path.join(dir, 'x.txt');
      await writeFile(file, text);
      return await readSongList(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('reads title and artists, and the header lines', async () => {
    const { meta, songs } = await read('# name: Test\n# lang: en\nSmooth|Santana, Rob Thomas\n\nHello|Adele\n');
    expect(meta).toMatchObject({ name: 'Test', lang: 'en' });
    expect(songs).toEqual([
      { title: 'Smooth', artists: ['Santana', 'Rob Thomas'] },
      { title: 'Hello', artists: ['Adele'] },
    ]);
  });

  it('reads an optional release year as a third field', async () => {
    const { songs } = await read('# lang: en\nBette Davis Eyes|Kim Carnes|1981\nNo Year|Someone| \nBad Year|Someone|soon\n');
    expect(songs[0]).toEqual({ title: 'Bette Davis Eyes', artists: ['Kim Carnes'], year: 1981 });
    expect(songs[1]).not.toHaveProperty('year');
    expect(songs[2]).not.toHaveProperty('year');
  });
});
