import Phaser from "phaser";
import type { BurstParticle, TrailPoint, FloatLabel } from "../entities/types";

interface PlayerSnapshot {
  x: number; y: number;
  radius: number; rotation: number;
  vx: number; vy: number;
  thrustingThisFrame: boolean;
}

/** Manages burst particles, engine trail, and floating text labels. */
export class ParticleSystem {
  private particles: BurstParticle[] = [];
  private trailPoints: TrailPoint[] = [];
  private floatLabels: FloatLabel[] = [];

  constructor(private scene: Phaser.Scene) {}

  spawnBurst(x: number, y: number, count: number, speed: number, color: number, life: number) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = speed * (0.35 + Math.random() * 0.8);
      this.particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, life, maxLife: life, color, r: 1.5 + Math.random() * 3.5 });
    }
  }

  spawnFloatLabel(x: number, y: number, mass: number, color: number = 0x00ff88) {
    const hex   = '#' + color.toString(16).padStart(6, '0');
    const size  = Math.max(14, Math.min(36, 10 + Math.sqrt(mass)));
    const label = this.scene.add.text(x, y, `+${Math.floor(mass)}`, {
      fontSize: size + 'px',
      fontFamily: 'monospace',
      color: hex,
      stroke: '#000000',
      strokeThickness: 3,
    }).setDepth(20).setOrigin(0.5, 1);
    this.floatLabels.push({ text: label, vy: -55 - Math.random() * 30, life: 1.4, maxLife: 1.4 });
  }

  spawnFloatText(x: number, y: number, str: string, color: number = 0x44ffaa) {
    const hex   = '#' + color.toString(16).padStart(6, '0');
    const label = this.scene.add.text(x, y, str, {
      fontSize: '17px',
      fontFamily: 'monospace',
      color: hex,
      stroke: '#000000',
      strokeThickness: 3,
    }).setDepth(20).setOrigin(0.5, 1);
    this.floatLabels.push({ text: label, vy: -48, life: 2.0, maxLife: 2.0 });
  }

  /** Advance particle simulation. Call once per frame before draw(). */
  update(dt: number) {
    for (const p of this.particles) {
      p.x   += p.vx * dt;
      p.y   += p.vy * dt;
      p.vx  *= 0.90;
      p.vy  *= 0.90;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);

    for (const fl of this.floatLabels) {
      fl.text.y += fl.vy * dt;
      fl.life   -= dt;
      const t    = fl.life / fl.maxLife;
      fl.text.setAlpha(t < 0.25 ? t / 0.25 : 1);
    }
    this.floatLabels = this.floatLabels.filter(fl => {
      if (fl.life <= 0) { if (fl.text.active) fl.text.destroy(); return false; }
      return true;
    });

    this.trailPoints = this.trailPoints.filter(tp => tp.life > 0);
  }

  /** Draw engine trail and burst particles into world-space gfx. */
  draw(dt: number, gfx: Phaser.GameObjects.Graphics, player: PlayerSnapshot) {
    // Engine exhaust trail: push new point when thrusting
    if (player.thrustingThisFrame) {
      const cos = Math.cos(player.rotation);
      const sin = Math.sin(player.rotation);
      this.trailPoints.push({
        x: player.x - cos * player.radius * 0.8,
        y: player.y - sin * player.radius * 0.8,
        life: 0.35, maxLife: 0.35,
      });
    }
    for (const tp of this.trailPoints) {
      tp.life -= dt;
      if (tp.life <= 0) continue;
      const t = tp.life / tp.maxLife;
      const r = (3 + t * 5) * player.radius / 40;
      gfx.fillStyle(0xff5500, t * 0.55);
      gfx.fillCircle(tp.x, tp.y, r);
      gfx.fillStyle(0xffcc00, t * 0.35);
      gfx.fillCircle(tp.x, tp.y, r * 0.5);
    }

    for (const p of this.particles) {
      if (p.life <= 0) continue;
      const t = p.life / p.maxLife;
      gfx.fillStyle(p.color, t * 0.85);
      gfx.fillCircle(p.x, p.y, Math.max(0.5, p.r * t));
    }
  }

  /** Draw speed lines in screen-space into vignetteGfx (call after clear). */
  drawSpeedLines(
    speed: number,
    vignetteGfx: Phaser.GameObjects.Graphics,
    gw: number, gh: number,
    playerVx: number, playerVy: number,
  ) {
    const MIN_SPEED = 200;
    if (speed < MIN_SPEED) return;
    const t = Math.min(1, (speed - MIN_SPEED) / 300);
    if (t < 0.05) return;
    const cx    = gw / 2;
    const cy    = gh / 2;
    const angle = Math.atan2(playerVy, playerVx);
    const count = Math.floor(t * 10) + 2;
    for (let i = 0; i < count; i++) {
      const spread   = ((i / count) - 0.5) * Math.PI * 1.3;
      const lineAng  = angle + spread + Math.PI;
      const startD   = 50 + (i * 23) % 120;
      const len      = 25 + t * 70;
      const x0 = cx + Math.cos(lineAng) * startD;
      const y0 = cy + Math.sin(lineAng) * startD;
      const x1 = cx + Math.cos(lineAng) * (startD + len);
      const y1 = cy + Math.sin(lineAng) * (startD + len);
      vignetteGfx.lineStyle(0.8 + t * 1.2, 0x99ccff, t * 0.30);
      vignetteGfx.lineBetween(x0, y0, x1, y1);
    }
  }

  destroy() {
    for (const fl of this.floatLabels) {
      if (fl.text.active) fl.text.destroy();
    }
    this.floatLabels = [];
    this.particles = [];
    this.trailPoints = [];
  }
}
