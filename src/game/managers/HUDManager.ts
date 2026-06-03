import Phaser from "phaser";
import {
  WORLD_SIZE, PLANET_THRESHOLD, massToRadius,
  SHRINK_START_DELAY, ESCAPE_MIN_DIST,
} from "../constants";
import type { Asteroid } from "../entities/Asteroid";
import type { BotPlayer } from "../entities/BotPlayer";
import type { NetworkManager } from "../NetworkManager";
import { getOrCreatePlayerName } from "../NetworkManager";
import type { GamePhase } from "../constants";

function parseHslColor(hsl: string): number {
  const m = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!m) return 0xffffff;
  const h = parseInt(m[1]) / 360;
  const s = parseInt(m[2]) / 100;
  const l = parseInt(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return (
    (Math.round(hue2rgb(h + 1 / 3) * 255) << 16) |
    (Math.round(hue2rgb(h) * 255) << 8) |
    Math.round(hue2rgb(h - 1 / 3) * 255)
  );
}

interface KillFeedEntry { msg: string; life: number; color: number }

export interface MassHudState {
  playerMass: number;
  buyInTokens: number;
  tierLabel: string;
  spawnProtectTimer: number;
  boostCooldown: number;
  ejectCooldown: number;
  shieldCooldown: number;
  estimatedPayout: number;
  myRank: number;
  prizePool: number;
}

export interface PhaseHudState {
  phase: GamePhase;
  gameTimer: number;
  escaping: boolean;
  escapeTimer: number;
  disruptFlash: number;
  playerX: number;
  playerY: number;
  timeNow: number;
}

export interface MinimapState {
  phase: GamePhase;
  bhMass: number;
  asteroids: Asteroid[];
  net: NetworkManager | null;
  bots: BotPlayer[];
  playerX: number;
  playerY: number;
}

export interface LeaderboardState {
  playerMass: number;
  net: NetworkManager | null;
  bots: BotPlayer[];
}

export interface EndResultConfig {
  title: string;
  titleColor: string;
  statsLines: string[];
  statsColor: string;
  restartLabel: string;
}

/**
 * Owns all HUD Phaser objects: mass display, phase timer, kill feed,
 * minimap, leaderboard, milestone popups, end screen, and background grid.
 */
export class HUDManager {
  private massText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private roundTimerText!: Phaser.GameObjects.Text;
  private endText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private restartText!: Phaser.GameObjects.Text;
  private menuKeyText!: Phaser.GameObjects.Text;
  private milestoneText!: Phaser.GameObjects.Text;
  private leaderboardText!: Phaser.GameObjects.Text;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private minimapGfx!: Phaser.GameObjects.Graphics;
  private waitingGfx!: Phaser.GameObjects.Graphics;
  private waitingText!: Phaser.GameObjects.Text;
  private killFeedEntries: KillFeedEntry[] = [];
  private killFeedTexts: Phaser.GameObjects.Text[] = [];
  private milestoneTimer: number = 0;

  constructor(private scene: Phaser.Scene) {}

  create(gw: number, gh: number) {
    // ── Background grid (world-space, static) ──────────────────────────────
    this.gridGfx = this.scene.add.graphics();
    const gridSize = 200;
    this.gridGfx.lineStyle(1, 0x1a2a3a, 0.8);
    for (let x = 0; x <= WORLD_SIZE; x += gridSize) {
      this.gridGfx.moveTo(x, 0);
      this.gridGfx.lineTo(x, WORLD_SIZE);
    }
    for (let y = 0; y <= WORLD_SIZE; y += gridSize) {
      this.gridGfx.moveTo(0, y);
      this.gridGfx.lineTo(WORLD_SIZE, y);
    }
    this.gridGfx.strokePath();

    // ── Minimap (screen-space overlay) ─────────────────────────────────────
    this.minimapGfx = this.scene.add.graphics().setScrollFactor(0).setDepth(22);

    // ── Mass / VI HUD (top-left) ────────────────────────────────────────────
    this.massText = this.scene.add
      .text(16, 16, "", { fontSize: "16px", color: "#ffffff", stroke: "#000000", strokeThickness: 3, lineSpacing: 4 })
      .setScrollFactor(0).setDepth(20);

    this.scene.add
      .text(16, 136,
        "Mouse/Touch: point to aim  |  Hold: thrust\nWASD / Arrow keys: rotate & thrust\nShift: boost  |  Q: eject mass  |  E: begin escape  |  F: shield",
        { fontSize: "12px", color: "#aaaaaa", stroke: "#000000", strokeThickness: 2 })
      .setScrollFactor(0).setDepth(20);

    // ── Phase / timer (center-top) ─────────────────────────────────────────
    this.phaseText = this.scene.add
      .text(gw / 2, 12, "", { fontSize: "15px", color: "#ffcc00", stroke: "#000000", strokeThickness: 3, align: "center" })
      .setScrollFactor(0).setDepth(20).setOrigin(0.5, 0);

    this.roundTimerText = this.scene.add
      .text(gw / 2, 38, "", { fontSize: "13px", color: "#888888", stroke: "#000000", strokeThickness: 2, fontFamily: "monospace" })
      .setScrollFactor(0).setDepth(20).setOrigin(0.5, 0);

    // ── End screen elements (hidden until game ends) ────────────────────────
    this.endText = this.scene.add
      .text(gw / 2, 210, "", { fontFamily: "Arial Black", fontSize: "44px", color: "#ffffff", stroke: "#000000", strokeThickness: 6, align: "center" })
      .setScrollFactor(0).setDepth(30).setOrigin(0.5).setVisible(false);

    this.statsText = this.scene.add
      .text(gw / 2, 300, "", { fontFamily: "monospace", fontSize: "18px", color: "#dddddd", stroke: "#000000", strokeThickness: 3, align: "center", lineSpacing: 6 })
      .setScrollFactor(0).setDepth(30).setOrigin(0.5).setVisible(false);

    this.restartText = this.scene.add
      .text(gw / 2, 405, "[ R ]  Play Again", { fontSize: "20px", color: "#00ff88", stroke: "#000000", strokeThickness: 3 })
      .setScrollFactor(0).setDepth(30).setOrigin(0.5).setVisible(false);

    this.menuKeyText = this.scene.add
      .text(gw / 2, 438, "[ M ]  Main Menu", { fontSize: "20px", color: "#aaaaff", stroke: "#000000", strokeThickness: 3 })
      .setScrollFactor(0).setDepth(30).setOrigin(0.5).setVisible(false);

    // ── Milestone popup (center-screen) ────────────────────────────────────
    this.milestoneText = this.scene.add
      .text(gw / 2, 155, "", { fontFamily: "Arial Black", fontSize: "30px", color: "#ffdd00", stroke: "#000000", strokeThickness: 5, align: "center" })
      .setScrollFactor(0).setDepth(21).setOrigin(0.5).setVisible(false);

    // ── Leaderboard (top-right) ────────────────────────────────────────────
    this.leaderboardText = this.scene.add
      .text(gw - 14, 14, "", { fontSize: "13px", color: "#dddddd", stroke: "#000000", strokeThickness: 3, lineSpacing: 3, fontFamily: "monospace" })
      .setScrollFactor(0).setDepth(22).setOrigin(1, 0);

    // ── Waiting overlay (shown when joining during 'ended' phase) ──────────
    this.waitingGfx = this.scene.add.graphics().setScrollFactor(0).setDepth(25).setVisible(false);
    this.waitingText = this.scene.add
      .text(gw / 2, gh / 2, "", { fontSize: "28px", fontFamily: "monospace", color: "#00ff88", stroke: "#000000", strokeThickness: 4, align: "center" })
      .setScrollFactor(0).setDepth(26).setOrigin(0.5).setVisible(false);

    // ── Kill feed (bottom-left, 5 pre-allocated slots) ─────────────────────
    this.killFeedEntries = [];
    this.killFeedTexts = [];
    for (let i = 0; i < 5; i++) {
      this.killFeedTexts.push(
        this.scene.add
          .text(16, 0, "", { fontSize: "13px", fontFamily: "monospace", color: "#00ff88", stroke: "#000000", strokeThickness: 2 })
          .setScrollFactor(0).setDepth(21).setVisible(false)
      );
    }

    // ── Resize: reposition center-anchored elements ────────────────────────
    this.scene.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      const cx = gameSize.width / 2;
      this.phaseText.setX(cx);
      this.roundTimerText.setX(cx);
      this.endText.setX(cx);
      this.statsText.setX(cx);
      this.restartText.setX(cx);
      this.menuKeyText.setX(cx);
      this.milestoneText.setX(cx);
      this.leaderboardText.setX(gameSize.width - 14);
    });
  }

  reset() {
    this.killFeedEntries = [];
    this.milestoneTimer = 0;
  }

  // ── Mass / VI HUD ──────────────────────────────────────────────────────────

  updateMassHUD(state: MassHudState) {
    const { playerMass, buyInTokens, tierLabel, spawnProtectTimer,
      boostCooldown, ejectCooldown, shieldCooldown, estimatedPayout, myRank, prizePool } = state;
    const vi = Math.floor(playerMass);
    const deltaVI = vi - buyInTokens;
    const deltaStr = deltaVI >= 0 ? `+${deltaVI}` : `${deltaVI}`;
    const losing = deltaVI < 0;
    const hudLines = [
      `${vi} VI  (${deltaStr})  [${tierLabel}  ${buyInTokens} VI]`,
      `Payout: ~${estimatedPayout} VI   rank #${myRank}`,
      `Pool:    ${prizePool} VI staked`,
    ];
    if (spawnProtectTimer > 0) hudLines.push(`SPAWN SHIELD: ${spawnProtectTimer.toFixed(1)}s`);
    const cdBoost  = boostCooldown  > 0 ? `${boostCooldown.toFixed(1)}s`  : "READY";
    const cdEject  = ejectCooldown  > 0 ? `${ejectCooldown.toFixed(1)}s`  : "READY";
    const cdShield = shieldCooldown > 0 ? `${shieldCooldown.toFixed(1)}s` : "READY";
    hudLines.push(`Shift:${cdBoost}  Q:${cdEject}  F:${cdShield}`);
    this.massText.setColor(losing ? "#ff3333" : deltaVI > 0 ? "#00ff88" : "#ffffff");
    this.massText.setText(hudLines.join("\n"));
  }

  // ── Phase / timer HUD ──────────────────────────────────────────────────────

  updatePhaseHUD(state: PhaseHudState) {
    const { phase, gameTimer, escaping, escapeTimer, disruptFlash, playerX, playerY, timeNow } = state;
    if (phase === 'playing') {
      const remaining = Math.max(0, SHRINK_START_DELAY - gameTimer);
      const mins = Math.floor(remaining / 60);
      const secs = Math.floor(remaining % 60).toString().padStart(2, '0');
      if (remaining <= 10) {
        const blink = Math.sin(timeNow * 10) > 0;
        this.phaseText.setText(`⚠  BIG SHRINK IN  ${remaining.toFixed(0)}s  ⚠`)
          .setColor(blink ? "#ff0000" : "#ff6600").setFontSize("18px");
        this.roundTimerText.setText("");
      } else if (remaining <= 30) {
        this.phaseText.setText(`⚠  BIG SHRINK IN  ${remaining.toFixed(0)}s  ⚠`)
          .setColor("#ff6600").setFontSize("15px");
        this.roundTimerText.setText("");
      } else if (remaining <= 60) {
        this.phaseText.setText(`BIG SHRINK IN ${remaining.toFixed(0)}s`)
          .setColor("#ffaa00").setFontSize("14px");
        this.roundTimerText.setText("");
      } else {
        this.phaseText.setText("").setFontSize("15px");
        this.roundTimerText.setText(`SHRINK IN  ${mins}:${secs}`).setColor("#999999").setFontSize("12px");
      }
      return;
    }
    this.roundTimerText.setText("");
    if (phase === 'shrinking') {
      if (escaping) {
        const pulse = Math.sin(timeNow * 6) > 0 ? "#00ffaa" : "#ffffff";
        this.phaseText.setText(`ESCAPING...  ${escapeTimer.toFixed(1)}s`).setColor(pulse);
      } else if (disruptFlash > 0) {
        // phaseText already set by setPhaseMessage — leave it
      } else {
        const dist = Math.hypot(playerX - WORLD_SIZE / 2, playerY - WORLD_SIZE / 2);
        if (dist >= ESCAPE_MIN_DIST) {
          this.phaseText.setText("THE BIG SHRINK  |  Press  [E]  to ESCAPE").setColor("#ffcc00");
        } else {
          this.phaseText.setText("THE BIG SHRINK  |  Move to the outer edge to escape").setColor("#ff8800");
        }
      }
    }
  }

  setPhaseMessage(text: string, color: string = "#ff4400") {
    this.phaseText.setText(text).setColor(color);
  }

  // ── Milestone popup ────────────────────────────────────────────────────────

  triggerMilestone(text: string, duration: number, color: string = "#ffdd00") {
    this.milestoneText.setText(text).setColor(color).setAlpha(1).setVisible(true);
    this.milestoneTimer = duration;
  }

  tickMilestone(dt: number) {
    if (this.milestoneTimer <= 0) return;
    this.milestoneTimer = Math.max(0, this.milestoneTimer - dt);
    const alpha = this.milestoneTimer < 0.5 ? this.milestoneTimer / 0.5 : 1;
    this.milestoneText.setAlpha(alpha);
    if (this.milestoneTimer <= 0) this.milestoneText.setVisible(false);
  }

  // ── Kill feed ──────────────────────────────────────────────────────────────

  pushKillFeed(msg: string, color: number = 0x00ff88) {
    this.killFeedEntries.unshift({ msg, life: 5.0, color });
    if (this.killFeedEntries.length > 5) this.killFeedEntries.pop();
  }

  drawKillFeed(dt: number) {
    for (const e of this.killFeedEntries) e.life -= dt;
    this.killFeedEntries = this.killFeedEntries.filter(e => e.life > 0);
    const baseY = this.scene.scale.height - 90;
    for (let i = 0; i < this.killFeedTexts.length; i++) {
      const entry = this.killFeedEntries[i];
      const txt   = this.killFeedTexts[i];
      if (!entry) { txt.setVisible(false); continue; }
      const alpha = entry.life < 1.5 ? entry.life / 1.5 : 1.0;
      const r = (entry.color >> 16) & 0xff;
      const g = (entry.color >>  8) & 0xff;
      const b =  entry.color        & 0xff;
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      txt.setText(entry.msg).setColor(hex).setAlpha(alpha).setY(baseY - i * 20).setVisible(true);
    }
  }

  // ── Minimap ────────────────────────────────────────────────────────────────

  drawMinimap(state: MinimapState) {
    const { phase, bhMass, asteroids, net, bots, playerX, playerY } = state;
    const gw = this.scene.scale.width;
    const gh = this.scene.scale.height;
    const MM_SIZE = 160;
    const MM_PAD  = 12;
    const mmX = gw - MM_SIZE - MM_PAD;
    const mmY = gh - MM_SIZE - MM_PAD;
    const sc  = MM_SIZE / WORLD_SIZE;
    const wx = (x: number) => mmX + x * sc;
    const wy = (y: number) => mmY + y * sc;

    this.minimapGfx.clear();
    this.minimapGfx.fillStyle(0x000818, 0.65);
    this.minimapGfx.fillRect(mmX, mmY, MM_SIZE, MM_SIZE);
    this.minimapGfx.lineStyle(1, 0x334455, 0.9);
    this.minimapGfx.strokeRect(mmX, mmY, MM_SIZE, MM_SIZE);

    if (phase === 'shrinking' || phase === 'escaped' || phase === 'consumed') {
      const bhR = Math.max(3, Math.min(massToRadius(bhMass) * sc, 14));
      this.minimapGfx.fillStyle(0xff6600, 0.9);
      this.minimapGfx.fillCircle(wx(WORLD_SIZE / 2), wy(WORLD_SIZE / 2), bhR);
      this.minimapGfx.fillStyle(0x000000, 1);
      this.minimapGfx.fillCircle(wx(WORLD_SIZE / 2), wy(WORLD_SIZE / 2), bhR * 0.65);
    }

    for (const a of asteroids) {
      const isPlanet = a.mass >= PLANET_THRESHOLD;
      this.minimapGfx.fillStyle(isPlanet ? 0xffdd88 : 0x778899, isPlanet ? 0.85 : 0.55);
      this.minimapGfx.fillCircle(wx(a.x), wy(a.y), isPlanet ? 3 : 1.5);
    }

    if (net) {
      for (const [, rp] of net.otherPlayers) {
        if (rp.phase !== "alive") continue;
        this.minimapGfx.fillStyle(parseHslColor(rp.color), 0.9);
        this.minimapGfx.fillCircle(wx(rp.x), wy(rp.y), 3);
      }
    }

    for (const bot of bots) {
      if (!bot.active) continue;
      this.minimapGfx.fillStyle(bot.color, 0.9);
      this.minimapGfx.fillCircle(wx(bot.x), wy(bot.y), 2.5);
    }

    this.minimapGfx.fillStyle(0xffffff, 1);
    this.minimapGfx.fillCircle(wx(playerX), wy(playerY), 3);
    this.minimapGfx.lineStyle(1.5, 0x00ffff, 0.9);
    this.minimapGfx.strokeCircle(wx(playerX), wy(playerY), 5);
  }

  // ── Leaderboard ────────────────────────────────────────────────────────────

  drawLeaderboard(state: LeaderboardState) {
    const { playerMass, net, bots } = state;
    const myName = getOrCreatePlayerName();
    type Entry = { label: string; mass: number; isLocal: boolean };
    const entries: Entry[] = [{ label: myName, mass: playerMass, isLocal: true }];
    if (net) {
      for (const [, rp] of net.otherPlayers) {
        if (rp.phase !== "alive") continue;
        entries.push({ label: rp.name, mass: rp.mass, isLocal: false });
      }
    }
    for (const bot of bots) {
      if (bot.active) entries.push({ label: bot.name, mass: bot.mass, isLocal: false });
    }
    entries.sort((a, b) => b.mass - a.mass);
    const top5 = entries.slice(0, 5);
    const BONUS_MULTS = [1.50, 1.25, 1.10];
    const lines: string[] = ["LEADERBOARD"];
    for (let i = 0; i < top5.length; i++) {
      const e = top5[i];
      const tag = e.isLocal ? `[${e.label}]` : e.label;
      if (i < 3) {
        const payout = Math.floor(e.mass * BONUS_MULTS[i] * 0.95);
        lines.push(`#${i + 1} ${tag}  ${Math.floor(e.mass)}  →${payout}`);
      } else {
        lines.push(`#${i + 1} ${tag}  ${Math.floor(e.mass)}`);
      }
    }
    this.leaderboardText.setText(lines.join("\n"));
  }

  // ── End screen ─────────────────────────────────────────────────────────────

  showEndResult(config: EndResultConfig) {
    const { title, titleColor, statsLines, statsColor, restartLabel } = config;
    this.endText.setText(title).setColor(titleColor).setVisible(true);
    this.statsText.setText(statsLines.join("\n")).setColor(statsColor).setVisible(true);
    this.restartText.setText(restartLabel).setVisible(true);
    this.menuKeyText.setVisible(true);
  }

  // ── Waiting overlay ────────────────────────────────────────────────────────

  showWaitingOverlay(secs: number, gw: number, gh: number) {
    this.waitingGfx.clear();
    this.waitingGfx.fillStyle(0x000000, 0.75);
    this.waitingGfx.fillRect(0, 0, gw, gh);
    this.waitingGfx.setVisible(true);
    this.waitingText.setText(`Next round starting in ${secs}s`).setVisible(true);
  }

  hideWaitingOverlay() {
    this.waitingGfx.setVisible(false);
    this.waitingText.setVisible(false);
  }
}
