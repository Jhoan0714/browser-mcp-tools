import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_PATH = join(__dirname, 'devices', 'builtin.json');
const DEFAULT_USER_PATH = join(homedir(), '.config', 'browser-mcp-tools', 'devices.json');

const deviceProfileSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive().optional(),
  mobile: z.boolean().optional(),
  touch: z.boolean().optional(),
  userAgent: z.string().nullable().optional()
});

const devicesFileSchema = z.record(z.string(), deviceProfileSchema);

export function normalizeDeviceProfile(raw) {
  const parsed = deviceProfileSchema.parse(raw);
  const mobile = parsed.mobile ?? false;
  return {
    width: parsed.width,
    height: parsed.height,
    deviceScaleFactor: parsed.deviceScaleFactor ?? 1,
    mobile,
    touch: parsed.touch ?? mobile,
    userAgent: parsed.userAgent ?? null
  };
}

export async function loadBuiltinDevices() {
  const raw = await readFile(BUILTIN_PATH, 'utf8');
  const parsed = devicesFileSchema.parse(JSON.parse(raw));
  return Object.fromEntries(
    Object.entries(parsed).map(([name, profile]) => [name, normalizeDeviceProfile(profile)])
  );
}

export function getUserDevicesPath() {
  return process.env.BROWSER_MCP_TOOLS_DEVICES ?? DEFAULT_USER_PATH;
}

export async function loadUserDevices() {
  try {
    const raw = await readFile(getUserDevicesPath(), 'utf8');
    const parsed = devicesFileSchema.parse(JSON.parse(raw));
    return Object.fromEntries(
      Object.entries(parsed).map(([name, profile]) => [name, normalizeDeviceProfile(profile)])
    );
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

export async function getAllDevices() {
  const builtin = await loadBuiltinDevices();
  const user = await loadUserDevices();
  return { ...builtin, ...user };
}

export async function resolveDevice(name) {
  const all = await getAllDevices();
  const profile = all[name];
  if (!profile) {
    const available = Object.keys(all).sort().join(', ');
    throw new Error(
      `Unknown device "${name}". Use list_devices to see available devices. Available: ${available || '(none)'}`
    );
  }
  return profile;
}

export async function listDevices() {
  const builtin = await loadBuiltinDevices();
  const user = await loadUserDevices();
  const names = [...new Set([...Object.keys(builtin), ...Object.keys(user)])].sort();

  return names.map((name) => {
    const isUser = name in user;
    const profile = isUser ? user[name] : builtin[name];
    return {
      name,
      source: isUser ? 'user' : 'builtin',
      width: profile.width,
      height: profile.height,
      deviceScaleFactor: profile.deviceScaleFactor,
      mobile: profile.mobile,
      touch: profile.touch,
      hasUserAgent: Boolean(profile.userAgent)
    };
  });
}
