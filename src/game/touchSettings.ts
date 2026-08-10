// Minimal persisted touch-control preferences (joystick size + swap-sides).
// Single JSON blob in localStorage, no cvar/console system.

const STORAGE_KEY = "omnivi_touch_settings";

export type JoystickSize = "small" | "medium" | "large";

export interface TouchSettings {
  joystickSize: JoystickSize;
  swapSides: boolean;
}

const DEFAULT_SETTINGS: TouchSettings = {
  joystickSize: "medium",
  swapSides: false,
};

const SIZE_SCALE: Record<JoystickSize, number> = {
  small: 0.75,
  medium: 1.0,
  large: 1.3,
};

const SIZE_ORDER: JoystickSize[] = ["small", "medium", "large"];

export function joystickSizeScale(size: JoystickSize): number {
  return SIZE_SCALE[size];
}

export function getTouchSettings(): TouchSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const joystickSize: JoystickSize =
      parsed?.joystickSize in SIZE_SCALE ? parsed.joystickSize : DEFAULT_SETTINGS.joystickSize;
    return { joystickSize, swapSides: !!parsed?.swapSides };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveTouchSettings(settings: TouchSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function setJoystickSize(size: JoystickSize): void {
  saveTouchSettings({ ...getTouchSettings(), joystickSize: size });
}

export function setSwapSides(swap: boolean): void {
  saveTouchSettings({ ...getTouchSettings(), swapSides: swap });
}

export function cycleJoystickSize(): JoystickSize {
  const current = getTouchSettings().joystickSize;
  const next = SIZE_ORDER[(SIZE_ORDER.indexOf(current) + 1) % SIZE_ORDER.length];
  setJoystickSize(next);
  return next;
}

export function toggleSwapSides(): boolean {
  const next = !getTouchSettings().swapSides;
  setSwapSides(next);
  return next;
}
