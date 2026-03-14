import Phaser from "phaser";
import { WORLD_SIZE, PLANET_THRESHOLD, massToRadius } from "../constants";
import type { Asteroid } from "../entities/Asteroid";
import type { BotPlayer } from "../entities/BotPlayer";
import type { NetworkManager } from "../NetworkManager";
import { getOrCreatePlayerName } from "../NetworkManager";

/** Parse "hsl(H,S%,L%)" server color string → Phaser hex number. */
export function parseHslColor(hsl: string): number {
  const m = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!m) return 0xffffff;
  const h = parseInt(m[1]) / 360;
  const s = parseInt(m[2]) / 100;
  const l = parseInt(m[3]) / 100;
  // HSL → RGB
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const r = Math.round(hue2rgb(h + 1/3) * 255);
  const g = Math.round(hue2rgb(h) * 255);
  const b = Math.round(hue2rgb(h - 1/3) * 255);
  return (r << 16) | (g << 8) | b;
}

interface MinimapData {
  phase: string;
  bhMass: number;
  asteroids: Asteroid[];
  net: NetworkManager | null;
  bots: BotPlayer[];
  playerX: number;
  playerY: number;
}

interface LeaderboardData {
  playerMass: number;
  net: NetworkManager | null;
  bots: BotPlayer[];
}

/** Manages minimap, leaderboard, and background grid rendering. */
export class HUDManager {
  constructor(
    private minimapGfx: Phaser.GameObjects.Graphics,
    private leaderboardText: Phaser.GameObjects.Text,
    private gridGfx: Phaser.GameObjects.Graphics,
    private gw: number,
    private gh: number,
  ) {}

  drawMinimap(data: MinimapData) {
    const MM_SIZE = 160;
    const MM_PAD  = 12;
    const mmX  = this.gw - MM_SIZE - MM_PAD;
    const mmY  = this.gh - MM_SIZE - MM_PAD;
    const sc   = MM_SIZE / WORLD_SIZE;
    const wx = (x: number) => mmX + x * sc;
    const wy = (y: number) => mmY + y * sc;

    this.minimapGfx.clear();

    this.minimapGfx.fillStyle(0x000818, 0.65);
    this.minimapGfx.fillRect(mmX, mmY, MM_SIZE, MM_SIZE);
    this.minimapGfx.lineStyle(1, 0x334455, 0.9);
    this.minimapGfx.strokeRect(mmX, mmY, MM_SIZE, MM_SIZE);

    if (data.phase === 'shrinking' || data.phase === 'escaped' || data.phase === 'consumed') {
      const bhR = Math.max(3, Math.min(massToRadius(data.bhMass) * sc, 14));
      this.minimapGfx.fillStyle(0xff6600, 0.9);
      this.minimapGfx.fillCircle(wx(WORLD_SIZE / 2), wy(WORLD_SIZE / 2), bhR);
      this.minimapGfx.fillStyle(0x000000, 1);
      this.minimapGfx.fillCircle(wx(WORLD_SIZE / 2), wy(WORLD_SIZE / 2), bhR * 0.65);
    }

    for (const a of data.asteroids) {
      const isPlanet = a.mass >= PLANET_THRESHOLD;
      this.minimapGfx.fillStyle(isPlanet ? 0xffdd88 : 0x778899, isPlanet ? 0.85 : 0.55);
      this.minimapGfx.fillCircle(wx(a.x), wy(a.y), isPlanet ? 3 : 1.5);
    }

    if (data.net) {
      for (const [, rp] of data.net.otherPlayers) {
        if (rp.phase !== "alive") continue;
        this.minimapGfx.fillStyle(parseHslColor(rp.color), 0.9);
        this.minimapGfx.fillCircle(wx(rp.x), wy(rp.y), 3);
      }
    }

    for (const bot of data.bots) {
      if (!bot.active) continue;
      this.minimapGfx.fillStyle(bot.color, 0.9);
      this.minimapGfx.fillCircle(wx(bot.x), wy(bot.y), 2.5);
    }

    // Local player — bright white with cyan ring
    this.minimapGfx.fillStyle(0xffffff, 1);
    this.minimapGfx.fillCircle(wx(data.playerX), wy(data.playerY), 3);
    this.minimapGfx.lineStyle(1.5, 0x00ffff, 0.9);
    this.minimapGfx.strokeCircle(wx(data.playerX), wy(data.playerY), 5);
  }

  drawLeaderboard(data: LeaderboardData) {
    const myName = getOrCreatePlayerName();
    type Entry = { label: string; mass: number; isLocal: boolean };
    const entries: Entry[] = [{ label: myName, mass: data.playerMass, isLocal: true }];

    if (data.net) {
      for (const [, rp] of data.net.otherPlayers) {
        if (rp.phase !== "alive") continue;
        entries.push({ label: rp.name, mass: rp.mass, isLocal: false });
      }
    }
    for (const bot of data.bots) {
      if (bot.active) entries.push({ label: bot.name, mass: bot.mass, isLocal: false });
    }

    entries.sort((a, b) => b.mass - a.mass);
    const top5 = entries.slice(0, 5);
    const BONUS_MULT = ["×1.5", "×1.25", "×1.1"];

    const lines: string[] = ["LEADERBOARD"];
    for (let i = 0; i < top5.length; i++) {
      const e = top5[i];
      const tag = e.isLocal ? `[${e.label}]` : e.label;
      const bonus = i < 3 ? `  ${BONUS_MULT[i]}` : "";
      lines.push(`#${i + 1} ${tag}  ${Math.floor(e.mass)}${bonus}`);
    }
    this.leaderboardText.setText(lines.join("\n"));
  }

  drawGrid() {
    const gridSize = 200;
    this.gridGfx.lineStyle(1, 0x1a2a3a, 0.8);
    for (let gx = 0; gx <= WORLD_SIZE; gx += gridSize) {
      this.gridGfx.moveTo(gx, 0);
      this.gridGfx.lineTo(gx, WORLD_SIZE);
    }
    for (let gy = 0; gy <= WORLD_SIZE; gy += gridSize) {
      this.gridGfx.moveTo(0, gy);
      this.gridGfx.lineTo(WORLD_SIZE, gy);
    }
    this.gridGfx.strokePath();
  }
}
