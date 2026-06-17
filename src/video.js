import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

export class FrameWriter {
  #framesDir;
  #extension;
  #deduplicate;
  #frameCount = 0;
  #framesSkippedDuplicate = 0;
  #lastHash = null;

  constructor({ framesDir, extension = 'jpg', deduplicate = true }) {
    this.#framesDir = framesDir;
    this.#extension = extension;
    this.#deduplicate = deduplicate;
  }

  get frameCount() {
    return this.#frameCount;
  }

  get framesSkippedDuplicate() {
    return this.#framesSkippedDuplicate;
  }

  reset() {
    this.#frameCount = 0;
    this.#framesSkippedDuplicate = 0;
    this.#lastHash = null;
  }

  async writeFromBase64(dataBase64) {
    const buffer = Buffer.from(dataBase64, 'base64');
    return this.writeBuffer(buffer);
  }

  async writeBuffer(buffer) {
    if (this.#deduplicate) {
      const hash = createHash('sha256').update(buffer).digest('hex');
      if (hash === this.#lastHash) {
        this.#framesSkippedDuplicate += 1;
        return false;
      }
      this.#lastHash = hash;
    }

    this.#frameCount += 1;
    const filename = `frame_${String(this.#frameCount).padStart(6, '0')}.${this.#extension}`;
    await writeFile(join(this.#framesDir, filename), buffer);
    return true;
  }
}

export function readImageSize(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      break;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xc0 || marker === 0xc2 || marker === 0xc1) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }

  throw new Error('Could not read image dimensions');
}

export async function getMaxFrameDimensions(framesDir) {
  const files = (await readdir(framesDir)).filter((name) => name.startsWith('frame_')).sort();

  if (files.length === 0) {
    throw new Error('No frames found to measure');
  }

  let maxWidth = 0;
  let maxHeight = 0;

  for (const file of files) {
    const buffer = await readFile(join(framesDir, file));
    const { width, height } = readImageSize(buffer);
    maxWidth = Math.max(maxWidth, width);
    maxHeight = Math.max(maxHeight, height);
  }

  return { width: maxWidth, height: maxHeight };
}

export function buildVideoFilter({ width, height }) {
  const evenWidth = Math.max(2, width - (width % 2));
  const evenHeight = Math.max(2, height - (height % 2));

  // Lanczos downscale + pad handles variable frame heights without cropping content.
  return [
    `scale=${evenWidth}:${evenHeight}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${evenWidth}:${evenHeight}:(ow-iw)/2:(oh-ih)/2:color=white`,
    'setsar=1'
  ].join(',');
}

export async function encodeFramesToVideo({
  framesDir,
  outputPath,
  fps,
  width,
  height,
  crf = 15,
  pixFmt = 'yuv444p'
}) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not available. Frames were saved but video encoding failed.');
  }

  const files = (await readdir(framesDir)).filter((name) => name.startsWith('frame_'));
  if (files.length === 0) {
    throw new Error('No frames found to encode');
  }

  const extension = files[0].endsWith('.png') ? 'png' : 'jpg';
  const inputPattern = join(framesDir, `frame_%06d.${extension}`);
  const outputSize = width && height ? { width, height } : await getMaxFrameDimensions(framesDir);

  await runFfmpeg([
    '-y',
    '-framerate',
    String(fps),
    '-i',
    inputPattern,
    '-vf',
    buildVideoFilter(outputSize),
    '-c:v',
    'libx264',
    '-crf',
    String(crf),
    '-preset',
    'slow',
    '-pix_fmt',
    pixFmt,
    '-movflags',
    '+faststart',
    outputPath
  ]);

  return outputSize;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpegProc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    ffmpegProc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpegProc.on('error', reject);
    ffmpegProc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`));
      }
    });
  });
}
