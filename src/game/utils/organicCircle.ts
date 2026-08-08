import type Phaser from "phaser";

/**
 * Traces a path for the "magical circle" identity — an undulating, hand-drawn-feeling
 * outline instead of a perfect circle. Two sine harmonics at different frequencies/speeds
 * (per CONSTRAINTS.md "Keep") avoid a mechanical, single-wave wobble; `seed` desyncs
 * players from pulsing in lockstep. Caller sets fillStyle/lineStyle and calls
 * gfx.fillPath()/strokePath() after this — matches the drawAsteroid() convention of
 * re-tracing the same path once per fill/stroke pass.
 */
export function traceOrganicCircle(
  gfx: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  radius: number,
  timeSec: number,
  seed: number,
  vertices: number = 14,
  wobbleAmp: number = 0.07,
): void {
  gfx.beginPath();
  for (let i = 0; i <= vertices; i++) {
    const angle = (i / vertices) * Math.PI * 2;
    const wob = 1 + wobbleAmp * (
      Math.sin(angle * 3 + timeSec * 1.3 + seed) * 0.6 +
      Math.sin(angle * 5 - timeSec * 0.9 + seed * 2.7) * 0.4
    );
    const vr = radius * wob;
    const vx = cx + Math.cos(angle) * vr;
    const vy = cy + Math.sin(angle) * vr;
    if (i === 0) gfx.moveTo(vx, vy);
    else gfx.lineTo(vx, vy);
  }
  gfx.closePath();
}
