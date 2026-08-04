import {
  WORLD_SIZE, ABSORB_RATIO,
  GRAVITY_G, GRAVITY_MIN_DIST_SQ, MAX_G_ACCEL, BH_GRAVITY_MULT,
  massToRadius,
} from "../constants";
import { PhysicsManager } from "./PhysicsManager";
import type { Main } from "../scenes/Main";

/**
 * Drives bot AI, physics and all bot-involved collisions each tick
 * (bot↔BH, bot↔dust, bot↔asteroid, bot↔player, bot↔bot).
 * Operates directly on the owning scene's state — this is an extracted
 * method, not a decoupled subsystem, so it takes the scene itself.
 */
export class BotManager {
  constructor(private scene: Main) {}

  update(dt: number) {
    const s = this.scene;
    if (s.phase === 'escaped' || s.phase === 'consumed') return;

    for (const bot of s.bots) {
      if (!bot.active) continue;

      bot.updateAI(dt, s.player, s.dust, s.asteroids, s.phase, WORLD_SIZE / 2, WORLD_SIZE / 2, s.bhMass, s.bots);
      bot.updatePhysics(dt);

      // BH gravity + consumption during shrink phase
      if (s.phase === 'shrinking') {
        const bx  = WORLD_SIZE / 2;
        const by  = WORLD_SIZE / 2;
        const bhR = massToRadius(s.bhMass);
        const bhG = GRAVITY_G * BH_GRAVITY_MULT;
        const dx  = bx - bot.x;
        const dy  = by - bot.y;
        const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
        const dist = Math.sqrt(dSq);
        let ax = bhG * s.bhMass / dSq * dx / dist;
        let ay = bhG * s.bhMass / dSq * dy / dist;
        const mag = Math.hypot(ax, ay);
        if (mag > MAX_G_ACCEL) { ax = ax / mag * MAX_G_ACCEL; ay = ay / mag * MAX_G_ACCEL; }
        bot.vx += ax * dt;
        bot.vy += ay * dt;
        if (dist < bhR + bot.radius) { bot.active = false; continue; }
      }

      // Bot absorbs dust (contact only)
      let dustAbsorbed = false;
      for (const d of s.dust) {
        if (!d.active) continue;
        if (bot.mass < d.mass * ABSORB_RATIO) continue;
        const dx = d.x - bot.x;
        const dy = d.y - bot.y;
        if (dx * dx + dy * dy < (bot.radius + d.radius) ** 2) {
          const tm = bot.mass + d.mass;
          bot.vx = (bot.vx * bot.mass + d.vx * d.mass) / tm;
          bot.vy = (bot.vy * bot.mass + d.vy * d.mass) / tm;
          bot.mass = tm;
          d.active = false;
          dustAbsorbed = true;
        }
      }
      if (dustAbsorbed) s.dust = s.dust.filter(d => d.active);

      // Bot ↔ Asteroid collision
      let asteroidAbsorbed = false;
      for (const a of s.asteroids) {
        if (!a.active) continue;
        const dx = a.x - bot.x;
        const dy = a.y - bot.y;
        if (dx * dx + dy * dy >= (bot.radius + a.radius) ** 2) continue;
        if (bot.mass >= a.mass * ABSORB_RATIO) {
          const tm = bot.mass + a.mass;
          bot.vx = (bot.vx * bot.mass + a.vx * a.mass) / tm;
          bot.vy = (bot.vy * bot.mass + a.vy * a.mass) / tm;
          bot.mass = tm;
          a.active = false;
          asteroidAbsorbed = true;
        } else if (a.mass >= bot.mass * ABSORB_RATIO) {
          const tm = a.mass + bot.mass;
          a.vx = (a.vx * a.mass + bot.vx * bot.mass) / tm;
          a.vy = (a.vy * a.mass + bot.vy * bot.mass) / tm;
          a.mass = tm;
          bot.active = false;
          break;
        } else {
          const bBody = { x: bot.x, y: bot.y, vx: bot.vx, vy: bot.vy, mass: bot.mass, radius: bot.radius };
          const aBody = { x: a.x, y: a.y, vx: a.vx, vy: a.vy, mass: a.mass, radius: a.radius };
          const debris = PhysicsManager.resolveElasticCollision(bBody, aBody);
          bot.x = bBody.x; bot.y = bBody.y; bot.vx = bBody.vx; bot.vy = bBody.vy; bot.mass = bBody.mass;
          a.x = aBody.x; a.y = aBody.y; a.vx = aBody.vx; a.vy = aBody.vy; a.mass = aBody.mass;
          if (debris.length > 0) s.spawnCollisionDebris(debris);
        }
      }
      if (asteroidAbsorbed) s.asteroids = s.asteroids.filter(a => a.active);
      if (!bot.active) continue;

      // Player ↔ Bot collision
      {
        const dx = bot.x - s.player.x;
        const dy = bot.y - s.player.y;
        const distSq = dx * dx + dy * dy;
        const touchDist = s.player.radius + bot.radius;
        if (distSq < touchDist * touchDist) {
          if (bot.mass >= s.player.mass * ABSORB_RATIO && s.spawnProtectTimer <= 0 && s.shieldTimer <= 0) {
            // Bot absorbs player
            s.phase = 'consumed';
            s.showEndScreen(false, `ABSORBED BY ${bot.name}`);
            return;
          } else if (s.player.mass >= bot.mass * ABSORB_RATIO) {
            // Player absorbs bot
            const tm = s.player.mass + bot.mass;
            s.player.vx = (s.player.vx * s.player.mass + bot.vx * bot.mass) / tm;
            s.player.vy = (s.player.vy * s.player.mass + bot.vy * bot.mass) / tm;
            s.player.mass = tm;
            s.net?.sendAbsorb("bot", bot.mass);
            bot.active = false;
            s.sfx.absorb(bot.mass);
            s.absorbFlashTimer = 0.35;
            s.bumpCombo(10);
            s.killStreak++;
            s.pvpKills++;
            s.killStreakTimer = 4.0;
            s.pvpKillGlowTimer = 2.0 + s.killStreak * 0.5;
            s.cameras.main.shake(350, 0.015);
            s.spawnBurst(bot.x, bot.y, 40, 190, 0xff7700, 1.1);
            s.spawnFloatLabel(bot.x, bot.y, bot.mass, 0xff7700);
            s.hud.pushKillFeed(`YOU absorbed ${bot.name}`, 0xff9900);
            if (s.killStreak >= 2) {
              s.hud.triggerMilestone(`KILL STREAK ×${s.killStreak}!`, 2.2);
            }
          } else {
            // Similar size: elastic collision
            const pBody = { x: s.player.x, y: s.player.y, vx: s.player.vx, vy: s.player.vy, mass: s.player.mass, radius: s.player.radius };
            const bBody = { x: bot.x, y: bot.y, vx: bot.vx, vy: bot.vy, mass: bot.mass, radius: bot.radius };
            const debris = PhysicsManager.resolveElasticCollision(pBody, bBody);
            s.player.x = pBody.x; s.player.y = pBody.y;
            s.player.vx = pBody.vx; s.player.vy = pBody.vy;
            s.player.mass = pBody.mass;
            bot.x = bBody.x; bot.y = bBody.y;
            bot.vx = bBody.vx; bot.vy = bBody.vy;
            bot.mass = bBody.mass;
            if (debris.length > 0) {
              s.spawnCollisionDebris(debris);
              s.cameras.main.shake(180, 0.006);
              s.spawnBurst((s.player.x + bot.x) / 2, (s.player.y + bot.y) / 2, 12, 100, 0xff8844, 0.5);
            }
          }
        }
      }

      // Bot ↔ Bot collision
      for (const other of s.bots) {
        if (!other.active || other === bot) continue;
        const dx = other.x - bot.x;
        const dy = other.y - bot.y;
        const distSq = dx * dx + dy * dy;
        const touchDist = bot.radius + other.radius;
        if (distSq >= touchDist * touchDist) continue;
        if (bot.mass >= other.mass * ABSORB_RATIO) {
          // bot absorbs other
          const tm = bot.mass + other.mass;
          bot.vx = (bot.vx * bot.mass + other.vx * other.mass) / tm;
          bot.vy = (bot.vy * bot.mass + other.vy * other.mass) / tm;
          bot.mass = tm;
          other.active = false;
        } else if (other.mass >= bot.mass * ABSORB_RATIO) {
          // other absorbs bot
          const tm = other.mass + bot.mass;
          other.vx = (other.vx * other.mass + bot.vx * bot.mass) / tm;
          other.vy = (other.vy * other.mass + bot.vy * bot.mass) / tm;
          other.mass = tm;
          bot.active = false;
          break;
        } else {
          // Similar size: elastic collision between bots
          const bA = { x: bot.x, y: bot.y, vx: bot.vx, vy: bot.vy, mass: bot.mass, radius: bot.radius };
          const bB = { x: other.x, y: other.y, vx: other.vx, vy: other.vy, mass: other.mass, radius: other.radius };
          const debris = PhysicsManager.resolveElasticCollision(bA, bB);
          bot.x = bA.x; bot.y = bA.y; bot.vx = bA.vx; bot.vy = bA.vy; bot.mass = bA.mass;
          other.x = bB.x; other.y = bB.y; other.vx = bB.vx; other.vy = bB.vy; other.mass = bB.mass;
          if (debris.length > 0) s.spawnCollisionDebris(debris);
        }
      }
    }

    s.bots = s.bots.filter(b => b.active);
  }
}
