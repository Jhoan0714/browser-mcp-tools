import { access } from 'node:fs/promises';

const CHROME_PATHS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
};

const EDGE_PATHS = {
  darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  linux: ['microsoft-edge', 'microsoft-edge-stable']
};

async function firstExisting(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return paths[0];
}

export async function detectBrowserPath(browser = 'chrome') {
  const platform = process.platform;
  const key = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';
  const paths = browser === 'edge' ? EDGE_PATHS[key] : CHROME_PATHS[key];
  return firstExisting(paths);
}
