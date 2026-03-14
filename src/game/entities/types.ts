import type Phaser from "phaser";

export interface BurstParticle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: number; r: number;
}

export interface TrailPoint {
  x: number; y: number;
  life: number; maxLife: number;
}

export interface FloatLabel {
  text: Phaser.GameObjects.Text;
  vy: number;
  life: number;
  maxLife: number;
}
