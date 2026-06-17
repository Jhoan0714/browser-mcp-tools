import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getMaxFrameDimensions, readImageSize } from '../../src/video.js';

// Minimal valid JPEG (1x1) with SOF0 marker
const tinyJpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff,
  0xd9
]);

test('readImageSize reads JPEG dimensions', () => {
  assert.deepEqual(readImageSize(tinyJpeg), { width: 1, height: 1 });
});

test('getMaxFrameDimensions returns largest frame size', async () => {
  const framesDir = await mkdtemp(join(tmpdir(), 'video-dims-'));
  const tallJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0x4c, 0x01, 0x86, 0x01, 0x01, 0x11, 0x00, 0xff,
    0xd9
  ]);
  const shortJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x08, 0x01, 0x86, 0x01, 0x01, 0x11, 0x00, 0xff,
    0xd9
  ]);

  await writeFile(join(framesDir, 'frame_000001.jpg'), shortJpeg);
  await writeFile(join(framesDir, 'frame_000002.jpg'), tallJpeg);

  const dims = await getMaxFrameDimensions(framesDir);
  assert.deepEqual(dims, { width: 390, height: 844 });

  await rm(framesDir, { recursive: true, force: true });
});
