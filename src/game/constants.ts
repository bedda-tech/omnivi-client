// ─── World ──────────────────────────────────────────────────────────────────
export const WORLD_SIZE = 5000;
export const RADIUS_SCALE = 2.0;        // radius = sqrt(mass) * RADIUS_SCALE
export const STARTING_MASS = 1000;
export const THRUST_FORCE = 250;        // pixels/s² acceleration
export const THRUST_MASS_COST_PCT = 0.001; // fraction of mass lost per thrust tick (0.1%/tick = ~6%/sec regardless of size)
export const MAX_SPEED = 500;           // thrust speed cap (gravity/collisions can exceed)
export const DUST_EMIT_MASS = 0.3;      // mass of each emitted dust particle
export const INITIAL_DUST_COUNT = 300;  // dust seeded at match start
export const MAX_DUST = 600;
export const ABSORB_RATIO = 1.5;        // must be this times larger to absorb
export const DUST_RESPAWN_MIN = 150;    // respawn ambient dust when count falls below this

// ─── Asteroid ───────────────────────────────────────────────────────────────
export const ASTEROID_THRESHOLD = 50;  // dust mass at which it graduates to Asteroid
export const PLANET_THRESHOLD = 1000;  // asteroid mass at which it's labeled a Planet
export const STAR_THRESHOLD = 10000;   // asteroid mass at which it's labeled a Star (OMNIVI.md Phase 4)
export const STAR_GRAVITY_MULT = 2.0;  // stars have intensified gravity wells beyond raw mass
export const INITIAL_ASTEROIDS = 6;    // asteroid bodies seeded at match start
// No drag in space — all bodies conserve momentum (Newton's 1st law)
export const ASTEROID_VERTICES = 10;   // polygon vertex count for craggy look

// ─── Gravity (Barnes-Hut) ───────────────────────────────────────────────────
export const GRAVITY_G = 1000;          // gravitational constant — Newtonian, tuned for stellar scale
export const GRAVITY_THETA = 0.5;       // Barnes-Hut approximation threshold
export const GRAVITY_MIN_DIST_SQ = 900; // 30px — avoid singularity
export const MAX_G_ACCEL = 800;         // px/s² cap

// ─── Collision Physics ─────────────────────────────────────────────────────
export const COLLISION_RESTITUTION  = 0.7;    // coefficient of restitution (1 = perfect elastic, 0 = perfect inelastic)
export const FRAGMENT_KE_THRESHOLD  = 5e6;    // kinetic energy threshold for fragmentation (reduced_mass * v_rel² / 2)
export const FRAGMENT_MASS_PCT      = 0.05;   // each body loses up to 5% mass as debris per collision
export const FRAGMENT_COUNT         = 4;      // debris pieces per body on fragmentation
export const COLLISION_SEPARATION   = 1.01;   // push-apart multiplier to prevent overlap sticking
export const TIDAL_STRIP_RATIO      = 3.0;    // mass ratio at which tidal stripping begins (smaller body sheds mass)
export const TIDAL_STRIP_RATE       = 0.02;   // fraction of smaller body's mass stripped per second at contact

// ─── Black Hole / Big Shrink ─────────────────────────────────────────────────
export const SHRINK_START_DELAY = 180;   // seconds of normal play before Big Shrink (3-min rounds)
export const BH_INITIAL_MASS    = 8000;  // starting BH mass (radius ≈ 179px)
export const BH_GROWTH_RATE     = 200;   // mass/second added to BH (initial)
export const BH_GROWTH_ACCEL    = 5.0;   // extra mass/s² — shrink accelerates over time
export const BH_GRAVITY_MULT    = 5.0;   // BH gravity multiplier over GRAVITY_G
export const WARN_SECONDS       = [60, 30, 10] as const; // countdown warnings before shrink
export const BOT_HUNT_START_S   = 20;    // seconds into shrink when bots start hunting — must match server BotManager.ts BOT_HUNT_START_S default

// ─── Escape Sequence ────────────────────────────────────────────────────────
export const ESCAPE_DURATION      = 12;    // seconds to complete escape
export const ESCAPE_MIN_DIST      = 1600;  // must be this far from world center (px)
export const ESCAPE_DISRUPT_RATIO = 0.5;   // disrupted if hit by object > this × player mass

// ─── Spawn Protection ───────────────────────────────────────────────────────
export const SPAWN_PROTECT_SECS = 5; // seconds of invulnerability after spawning

// ─── Economy ────────────────────────────────────────────────────────────────
// Must match GameVault.sol RAKE_BPS (300 = 3%) — rake is deducted ONCE, on-chain.
// Client-side numbers here are display-only estimates and must agree with that.
export const RAKE_PCT = 0.03;
export const NET_AFTER_RAKE = 1 - RAKE_PCT;

// ─── Skill Abilities ─────────────────────────────────────────────────────────
export const BOOST_MASS_COST_PCT = 0.05;   // 5% of mass spent per boost
export const BOOST_IMPULSE       = 350;    // px/s velocity impulse on boost
export const BOOST_COOLDOWN      = 5.0;    // seconds between boosts
export const EJECT_MASS_PCT      = 0.10;   // 10% of mass ejected per fire
export const EJECT_MASS_MIN      = 20;     // minimum ejected mass
export const EJECT_MASS_MAX      = 250;    // cap on ejected mass
export const EJECT_SPEED         = 600;    // px/s — projectile exit speed (relative to player)
export const EJECT_COOLDOWN      = 1.0;    // seconds between ejects
export const CLUTCH_MASS_THRESH  = 150;    // mass below this = clutch escape (fanfare)
export const SHIELD_MASS_COST_PCT = 0.08;  // 8% of mass spent per shield activation
export const SHIELD_DURATION      = 2.5;   // seconds of invulnerability
export const SHIELD_COOLDOWN      = 8.0;   // seconds between shield uses
export const BRAKE_MASS_COST_PCT  = 0.04;  // 4% of mass spent per brake dodge
export const BRAKE_COOLDOWN       = 3.0;   // seconds between brake dodges
export const BRAKE_VELOCITY_CUT   = 0.85;  // fraction of current velocity canceled on brake
export const GRAVITY_WELL_MASS_COST_PCT = 0.12;  // 12% of mass spent per gravity well cast — mirror server
export const GRAVITY_WELL_MIN_MASS      = 100;   // minimum mass required to cast
export const GRAVITY_WELL_COOLDOWN      = 15.0;  // seconds between casts — mirror server
export const GRAVITY_WELL_DURATION      = 5.0;   // seconds the well persists — mirror server
export const FRAGMENT_MASS_COST_PCT = 0.20;  // 20% of mass spent per fragmentation bomb — mirror server
export const FRAGMENT_MIN_MASS      = 100;   // minimum mass required to cast
export const FRAGMENT_COOLDOWN      = 14.0;  // seconds between casts — mirror server
export const FRAGMENT_DURATION      = 2.0;   // seconds of absorption immunity — mirror server
export const COMBO_TIMEOUT       = 2.5;    // seconds of inactivity before combo resets
export const COMBO_ANNOUNCE_THRESHOLDS = [5, 10, 20, 50] as const;

// ─── Round Economy ──────────────────────────────────────────────────────────
// Mass IS VI — one universal unit of energy. No conversion needed.
// "Omnivi" = all VI = all energy. The goal is to collect it all.

// ─── AI Bots ────────────────────────────────────────────────────────────────
export const BOT_COUNT       = 0; // NPC bots now live server-side in OmniviRoom
export const BOT_NAMES       = ["TITAN", "VEGA", "NOVA", "AXIOM"];
export const BOT_COLORS      = [0xff5555, 0x55ff99, 0xffbb33, 0xbb66ff];
export const BOT_THRUST      = 220;        // slightly weaker than player
export const BOT_MAX_SPEED   = 420;
export const BOT_DETECT_RANGE = 700;       // px — how far bots look for targets

// ─── Types ──────────────────────────────────────────────────────────────────
export type GamePhase = 'playing' | 'shrinking' | 'escaped' | 'consumed';

// ─── Utilities ──────────────────────────────────────────────────────────────
export function massToRadius(mass: number): number {
  return Math.sqrt(mass) * RADIUS_SCALE;
}

/** Effective gravitational mass — stars punch above their weight (intense gravity wells). */
export function gravWeight(mass: number): number {
  return mass >= STAR_THRESHOLD ? mass * STAR_GRAVITY_MULT : mass;
}

/** Convert "hsl(H, S%, L%)" string to a Phaser-compatible 0xRRGGBB number. */
export function parseHslColor(hsl: string): number {
  const m = hsl.match(/hsl\(\s*(\d+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
  if (!m) return 0xffffff;
  const h  = parseInt(m[1], 10);
  const s  = parseFloat(m[2]) / 100;
  const l  = parseFloat(m[3]) / 100;
  const C  = (1 - Math.abs(2 * l - 1)) * s;
  const X  = C * (1 - Math.abs((h / 60) % 2 - 1));
  const mo = l - C / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = C; g = X; b = 0; }
  else if (h < 120) { r = X; g = C; b = 0; }
  else if (h < 180) { r = 0; g = C; b = X; }
  else if (h < 240) { r = 0; g = X; b = C; }
  else if (h < 300) { r = X; g = 0; b = C; }
  else              { r = C; g = 0; b = X; }
  return (
    (Math.round((r + mo) * 255) << 16) |
    (Math.round((g + mo) * 255) << 8)  |
    Math.round((b + mo) * 255)
  );
}
