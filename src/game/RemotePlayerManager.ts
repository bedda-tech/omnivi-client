import Phaser from "phaser";
import type { RemotePlayer } from "./NetworkManager";
import { parseHslColor } from "./constants";
import { traceOrganicCircle } from "./utils/organicCircle";

const TICK_LAG   = 0.05;  // assume ~50ms from when server sampled to when we apply it
const INTERP_SPD = 14;    // lerp rate — converges in ~1/14 s ≈ 70ms

export class RemotePlayerManager {
  private nameLabels  = new Map<string, Phaser.GameObjects.Text>();
  private remoteRender = new Map<string, { renderX: number; renderY: number; shapeSeed: number }>();

  constructor(private scene: Phaser.Scene) {}

  /** Interpolate positions and render all alive remote players + their name labels. */
  draw(dt: number, gfx: Phaser.GameObjects.Graphics, otherPlayers: Map<string, RemotePlayer>): void {
    const seen = new Set<string>();

    for (const [id, rp] of otherPlayers) {
      if (rp.phase !== "alive") continue;
      seen.add(id);

      // Dead-reckoning: lerp render pos toward server pos + velocity * estimated lag
      const deadX = rp.x + rp.vx * TICK_LAG;
      const deadY = rp.y + rp.vy * TICK_LAG;
      if (!this.remoteRender.has(id)) {
        this.remoteRender.set(id, { renderX: deadX, renderY: deadY, shapeSeed: Math.random() * 1000 });
      }
      const rr = this.remoteRender.get(id)!;
      const a = Math.min(dt * INTERP_SPD, 1);
      rr.renderX += (deadX - rr.renderX) * a;
      rr.renderY += (deadY - rr.renderY) * a;
      const rx = rr.renderX;
      const ry = rr.renderY;

      const r     = Math.sqrt(rp.mass) * 2;
      const color = parseHslColor(rp.color);
      const tSec  = this.scene.time.now / 1000;

      // Subtle glow
      gfx.fillStyle(color, 0.08);
      gfx.fillCircle(rx, ry, r * 2.0);

      // Body — undulating "magical circle" outline (CONSTRAINTS.md)
      gfx.fillStyle(color, 0.75);
      traceOrganicCircle(gfx, rx, ry, r, tSec, rr.shapeSeed);
      gfx.fillPath();

      // Outline
      gfx.lineStyle(Math.max(1, r * 0.04), 0xffffff, 0.5);
      traceOrganicCircle(gfx, rx, ry, r, tSec, rr.shapeSeed);
      gfx.strokePath();

      // Thrust flash
      if (rp.isThrusting) {
        gfx.fillStyle(0xff6600, 0.35);
        gfx.fillCircle(rx, ry, r * 0.4);
      }

      // Escape aura
      if (rp.isEscaping) {
        gfx.lineStyle(3, 0x00ffaa, 0.4);
        gfx.strokeCircle(rx, ry, r * 1.5);
      }

      // Threat indicator — pulsing red ring while a bot is actively hunting a target,
      // so players get a visible cue that this bot is more dangerous than an
      // opportunistic one (see BotManager.ts BOT_HUNT_* ramp).
      if (rp.isHunting) {
        const pulse = 0.35 + 0.25 * Math.sin(tSec * 6);
        gfx.lineStyle(2, 0xff2222, pulse);
        gfx.strokeCircle(rx, ry, r * 1.35);
      }

      // Fragmentation Bomb — brief post-explosion dodge window: scattered dashed rays
      // rather than a solid ring, reading as "still reassembling" rather than shielded.
      if (rp.isFragmenting) {
        const shardCount = 8;
        gfx.lineStyle(2, 0xcccccc, 0.6);
        for (let i = 0; i < shardCount; i++) {
          const ang = (i / shardCount) * Math.PI * 2 + tSec * 2;
          const inner = r * 1.2;
          const outer = r * 1.6;
          gfx.lineBetween(
            rx + Math.cos(ang) * inner, ry + Math.sin(ang) * inner,
            rx + Math.cos(ang) * outer, ry + Math.sin(ang) * outer,
          );
        }
      }

      // Name label above the player circle
      if (!this.nameLabels.has(id)) {
        const lbl = this.scene.add.text(0, 0, rp.name, {
          fontSize: '13px', fontFamily: 'monospace',
          color: '#ffffff',
          stroke: '#000000', strokeThickness: 3,
        }).setAlpha(0.85).setOrigin(0.5, 1).setDepth(15);
        this.nameLabels.set(id, lbl);
      }
      this.nameLabels.get(id)!.setPosition(rx, ry - r - 5);
    }

    // Destroy labels + render state for players no longer visible
    for (const [id, lbl] of this.nameLabels) {
      if (!seen.has(id)) {
        lbl.destroy();
        this.nameLabels.delete(id);
      }
    }
    for (const id of this.remoteRender.keys()) {
      if (!seen.has(id)) this.remoteRender.delete(id);
    }
  }

  /** Draw remote player dots on the minimap. */
  drawMinimapDots(
    gfx: Phaser.GameObjects.Graphics,
    otherPlayers: Map<string, RemotePlayer>,
    wx: (x: number) => number,
    wy: (y: number) => number,
  ): void {
    for (const [, rp] of otherPlayers) {
      if (rp.phase !== "alive") continue;
      gfx.fillStyle(parseHslColor(rp.color), 0.9);
      gfx.fillCircle(wx(rp.x), wy(rp.y), 3);
    }
  }

  /** Called when NetworkManager fires onPlayerRemoved — clean up label and render state. */
  removePlayer(id: string): void {
    this.nameLabels.get(id)?.destroy();
    this.nameLabels.delete(id);
    this.remoteRender.delete(id);
  }

  /** Destroy all labels and clear state (called on scene shutdown and restart). */
  destroy(): void {
    for (const lbl of this.nameLabels.values()) lbl.destroy();
    this.nameLabels.clear();
    this.remoteRender.clear();
  }
}
