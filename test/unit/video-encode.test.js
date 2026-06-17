import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPhysicalCaptureSize } from '../../src/emulation.js';
import { buildVideoFilter, getMaxFrameDimensions } from '../../src/video.js';

test('getPhysicalCaptureSize uses min of profile and display DPR', () => {
  const profile = { width: 390, height: 844, deviceScaleFactor: 3 };
  assert.deepEqual(getPhysicalCaptureSize(profile, 2), {
    maxWidth: 780,
    maxHeight: 1688
  });
  assert.deepEqual(getPhysicalCaptureSize(profile, 3), {
    maxWidth: 1170,
    maxHeight: 2532
  });
});

test('encodeFramesToVideo returns output dimensions from frames when size omitted', async () => {
  const framesDir = await mkdtemp(join(tmpdir(), 'video-encode-'));
  const tallPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x03, 0x0c, 0x00, 0x00, 0x06, 0x98, 0x08, 0x06, 0x00, 0x00, 0x00, 0x7a, 0x05, 0xfe,
    0xba, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ]);
  await writeFile(join(framesDir, 'frame_000001.png'), tallPng);

  const dims = await getMaxFrameDimensions(framesDir);
  assert.deepEqual(dims, { width: 780, height: 1688 });

  await rm(framesDir, { recursive: true, force: true });
});

test('buildVideoFilter uses lanczos downscale and pad for variable frames', () => {
  const filter = buildVideoFilter({ width: 780, height: 1688 });
  assert.match(filter, /flags=lanczos/);
  assert.match(filter, /force_original_aspect_ratio=decrease/);
  assert.match(filter, /pad=780:1688/);
});
