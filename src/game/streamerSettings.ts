// Minimal persisted streamer-mode preferences (wallet privacy + OBS-friendly HUD).
// Single JSON blob in localStorage, no cvar/console system — mirrors touchSettings.ts.

const STORAGE_KEY = "omnivi_streamer_settings";
const MAX_HANDLE_LEN = 25;

export interface StreamerSettings {
  enabled: boolean;
  twitchHandle: string;
}

const DEFAULT_SETTINGS: StreamerSettings = {
  enabled: false,
  twitchHandle: "",
};

export function getStreamerSettings(): StreamerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed?.enabled,
      twitchHandle: typeof parsed?.twitchHandle === "string" ? parsed.twitchHandle.slice(0, MAX_HANDLE_LEN) : "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveStreamerSettings(settings: StreamerSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function toggleStreamerMode(): boolean {
  const next = !getStreamerSettings().enabled;
  saveStreamerSettings({ ...getStreamerSettings(), enabled: next });
  return next;
}

export function setTwitchHandle(handle: string): void {
  saveStreamerSettings({ ...getStreamerSettings(), twitchHandle: handle.trim().replace(/^@/, "").slice(0, MAX_HANDLE_LEN) });
}

/** Display fallback for a wallet address when streamer mode is on — never leak the real address on stream. */
export function maskedWalletLabel(): string {
  return "Anonymous";
}
