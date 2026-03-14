import Phaser from "phaser";
import { EventBus } from "../EventBus";
import { NetworkManager, getOrCreatePlayerName, getStoredTier, TIER_INFO } from "../NetworkManager";
import { connectWallet } from "../blockchain/ClaimClient";
import {
  WORLD_SIZE, STARTING_MASS, MAX_SPEED, DUST_EMIT_MASS, INITIAL_DUST_COUNT, MAX_DUST, ABSORB_RATIO,
  DUST_RESPAWN_MIN, ASTEROID_THRESHOLD, PLANET_THRESHOLD, INITIAL_ASTEROIDS, ASTEROID_VERTICES,
  GRAVITY_G, GRAVITY_THETA, GRAVITY_MIN_DIST_SQ,
  MAX_G_ACCEL, SHRINK_START_DELAY, BH_INITIAL_MASS, BH_GROWTH_RATE, BH_GROWTH_ACCEL,
  BH_GRAVITY_MULT, WARN_SECONDS, ESCAPE_DURATION, ESCAPE_MIN_DIST, ESCAPE_DISRUPT_RATIO,
  SPAWN_PROTECT_SECS, BOOST_MASS_COST_PCT, BOOST_IMPULSE, BOOST_COOLDOWN, EJECT_MASS_PCT,
  EJECT_MASS_MIN, EJECT_MASS_MAX, EJECT_SPEED, EJECT_COOLDOWN, CLUTCH_MASS_THRESH,
  SHIELD_MASS_COST_PCT, SHIELD_DURATION, SHIELD_COOLDOWN, COMBO_TIMEOUT,
  COMBO_ANNOUNCE_THRESHOLDS, MASS_PER_TOKEN, VI_PRICE_USD, BOT_COUNT, BOT_NAMES,
  BOT_COLORS, massToRadius, parseHslColor,
  type GamePhase,
} from "../constants";
import { SfxManager } from "../managers/SfxManager";
import {
  DustParticle, Asteroid, QuadNode, Player, BotPlayer,
  type BurstParticle, type TrailPoint, type FloatLabel,
} from "../entities";

// ─── Main Scene ────────────────────────────────────────────────────────────
export class Main extends Phaser.Scene {
  private player!: Player;
  private dust: DustParticle[] = [];
  private asteroids: Asteroid[] = [];
  private bots: BotPlayer[] = [];
  /** World-space name labels for bots, keyed by bot name. */
  private botNameLabels = new Map<string, Phaser.GameObjects.Text>();

  // Rendering
  private gfx!: Phaser.GameObjects.Graphics;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private vignetteGfx!: Phaser.GameObjects.Graphics;  // screen-space overlay

  // HUD
  private massText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;        // phase/escape status (center-top)
  private endText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private restartText!: Phaser.GameObjects.Text;
  private menuKeyText!: Phaser.GameObjects.Text;
  private minimapGfx!: Phaser.GameObjects.Graphics;  // screen-space minimap overlay
  private leaderboardText!: Phaser.GameObjects.Text; // top-right mass ranking

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyE!: Phaser.Input.Keyboard.Key;           // initiate escape
  private keyShift!: Phaser.Input.Keyboard.Key;       // boost burst
  private keyQ!: Phaser.Input.Keyboard.Key;           // mass eject
  private keyF!: Phaser.Input.Keyboard.Key;           // shield
  private pointer!: Phaser.Input.Pointer;
  private mouseDown: boolean = false;
  private gamepad: Phaser.Input.Gamepad.Gamepad | null = null;

  // Input mode
  private useMouse: boolean = true;
  private useKeyboard: boolean = false;
  private useGamepad: boolean = false;

  // ── Multiplayer ─────────────────────────────────────────────────────────
  private net: NetworkManager | null = null;
  private sendTimer: number = 0;    // seconds since last network send
  private readonly SEND_RATE = 1 / 20; // 20 Hz
  /** Session IDs we've already absorbed this life — prevents double-counting. */
  private absorbedPlayers = new Set<string>();
  /** World-space name labels for remote players, keyed by session ID. */
  private nameLabels = new Map<string, Phaser.GameObjects.Text>();
  /** Interpolated render positions for remote players (dead reckoning). */
  private remoteRender = new Map<string, { renderX: number; renderY: number }>();
  /** Connected wallet address (if MetaMask available), used for on-chain claim. */
  private walletAddress: string = "";
  /** Entry tier this session (0=Quick, 1=Standard, 2=HighRoller). */
  private playerTier: number = 1;
  /** VI tokens staked this session (buy-in reference for loss-aversion HUD). */
  private buyInTokens: number = 25;

  // ── Sound ────────────────────────────────────────────────────────────────
  private sfx!: SfxManager;
  private wasThrusting: boolean = false;
  private absorbSfxCooldown: number = 0; // seconds until next dust-absorb sound

  // ── Juice / visual feedback ──────────────────────────────────────────────
  private particles: BurstParticle[] = [];
  private trailPoints: TrailPoint[] = [];
  private floatLabels: FloatLabel[] = [];
  private pvpKillGlowTimer: number = 0;   // seconds of gold border glow after eating a player
  private bhRumbleCooldown: number = 0;   // throttle BH rumble sound
  private heartbeatCooldown: number = 0;  // throttle heartbeat sound
  private absorbFlashTimer: number = 0;   // white impact flash on player after absorbing
  private killStreak: number = 0;         // consecutive kills before dying
  private killStreakTimer: number = 0;    // decay timer — resets streak after inactivity
  private milestoneText!: Phaser.GameObjects.Text;  // center-screen mass milestone pop
  private milestoneTimer: number = 0;    // how long to display the milestone label
  private lastMassMilestone: number = 0; // last mass threshold announced

  // ── Skill ability state ──────────────────────────────────────────────
  private boostCooldown: number = 0;  // seconds until boost is ready
  private ejectCooldown: number = 0;  // seconds until eject is ready
  private shieldTimer: number = 0;    // seconds of shield remaining (0 = off)
  private shieldCooldown: number = 0; // seconds until shield is usable again

  private slingshotCooldown: number = 0; // prevents spam gravity-assist label

  // ── Absorption combo ─────────────────────────────────────────────────
  private absorbCombo: number = 0;                     // current combo count
  private absorbComboTimer: number = 0;                // seconds before combo resets
  private bestCombo: number = 0;                       // best combo this life
  private comboAnnounced = new Set<number>();           // thresholds already shown

  // ── Game phase / Big Shrink state ──────────────────────────────────────
  private phase!: GamePhase;
  private gameTimer!: number;       // seconds elapsed since game start
  private shrinkTimer!: number;     // seconds elapsed since shrink started
  private bhMass!: number;          // black hole mass (grows during shrink)
  private escaping!: boolean;       // player is in escape countdown
  private escapeTimer!: number;     // seconds remaining in escape countdown
  private disruptFlash!: number;    // seconds remaining for disruption red flash
  private spawnProtectTimer!: number; // seconds of invulnerability remaining

  // ── Round pacing / tension curve ──────────────────────────────────────
  private warningFlash: number = 0;             // seconds of warning screen flash
  private warningFlashColor: number = 0xff8800; // color of current warning flash
  private climaxWarningFired: boolean = false;  // one-shot: final 30s climax announcement
  private warnedAt = new Set<number>();          // WARN_SECONDS values already triggered
  private roundTimerText!: Phaser.GameObjects.Text;
  private bhCameraShakeCooldown: number = 0;    // throttle camera shakes during shrink

  constructor() {
    super("Main");
  }

  preload() {}

  create() {
    this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);

    // Background grid (static, drawn once)
    this.gridGfx = this.add.graphics();
    this.drawGrid();

    // Main dynamic graphics
    this.gfx = this.add.graphics();

    // Screen-space overlay (vignette, disruption flash)
    this.vignetteGfx = this.add.graphics().setScrollFactor(0).setDepth(18);

    // Player
    this.player = new Player(WORLD_SIZE / 2, WORLD_SIZE / 2, STARTING_MASS);

    // Seed initial dust scattered around the world
    this.dust = [];
    this.asteroids = [];
    for (let i = 0; i < INITIAL_DUST_COUNT; i++) {
      const x = Math.random() * WORLD_SIZE;
      const y = Math.random() * WORLD_SIZE;
      const mass = DUST_EMIT_MASS + Math.random() * 8;
      const speed = Math.random() * 15;
      const angle = Math.random() * Math.PI * 2;
      this.dust.push(new DustParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, mass));
    }

    // Seed initial asteroids (spread away from center to avoid instant player collision)
    for (let i = 0; i < INITIAL_ASTEROIDS; i++) {
      // Place in a ring between 800–2000px from center
      const angle = (i / INITIAL_ASTEROIDS) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 800 + Math.random() * 1200;
      const x = WORLD_SIZE / 2 + Math.cos(angle) * dist;
      const y = WORLD_SIZE / 2 + Math.sin(angle) * dist;
      const mass = ASTEROID_THRESHOLD + Math.random() * 300; // 50–350 mass
      const speed = Math.random() * 25;
      const avel = Math.random() * Math.PI * 2;
      this.asteroids.push(
        new Asteroid(x, y, Math.cos(avel) * speed, Math.sin(avel) * speed, mass)
      );
    }

    // ── Game state (reset on restart) ──────────────────────────────────
    this.phase          = 'playing';
    this.gameTimer      = 0;
    this.shrinkTimer    = 0;
    this.bhMass         = BH_INITIAL_MASS;
    this.escaping       = false;
    this.escapeTimer    = 0;
    this.disruptFlash        = 0;
    this.spawnProtectTimer   = SPAWN_PROTECT_SECS;
    this.absorbedPlayers.clear();
    // Juice reset (Phaser destroys text objects on scene restart, so just clear arrays)
    this.particles = [];
    this.trailPoints = [];
    this.floatLabels = [];
    this.pvpKillGlowTimer = 0;
    this.bhRumbleCooldown = 0;
    this.heartbeatCooldown = 0;
    this.absorbFlashTimer = 0;
    this.killStreak = 0;
    this.killStreakTimer = 0;
    this.boostCooldown = 0;
    this.ejectCooldown = 0;
    this.shieldTimer = 0;
    this.shieldCooldown = 0;
    this.slingshotCooldown = 0;
    this.absorbCombo = 0;
    this.absorbComboTimer = 0;
    this.bestCombo = 0;
    this.comboAnnounced.clear();
    this.warningFlash = 0;
    this.warnedAt = new Set();
    this.bhCameraShakeCooldown = 0;
    this.climaxWarningFired = false;
    this.milestoneTimer = 0;
    this.lastMassMilestone = STARTING_MASS;
    for (const lbl of this.nameLabels.values()) lbl.destroy();
    this.nameLabels.clear();
    this.remoteRender.clear();
    for (const lbl of this.botNameLabels.values()) lbl.destroy();
    this.botNameLabels.clear();

    // Spawn bots spread around the world, away from the player start
    this.bots = [];
    for (let i = 0; i < BOT_COUNT; i++) {
      const angle = (i / BOT_COUNT) * Math.PI * 2 + Math.random() * 0.8;
      const dist  = 1000 + Math.random() * 1200;
      const bx    = WORLD_SIZE / 2 + Math.cos(angle) * dist;
      const by    = WORLD_SIZE / 2 + Math.sin(angle) * dist;
      const bmass = 200 + Math.random() * 600; // 200–800 (smaller than player's 1000)
      this.bots.push(new BotPlayer(bx, by, bmass, BOT_COLORS[i], BOT_NAMES[i]));
    }

    // HUD elements — setScrollFactor(0) pins them to the screen
    this.massText = this.add
      .text(16, 16, "", {
        fontSize: "16px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
        lineSpacing: 4,
      })
      .setScrollFactor(0)
      .setDepth(20);

    this.add
      .text(16, 136, "Mouse: point to aim  |  Click/Hold: thrust\nWASD / Arrow keys: rotate & thrust", {
        fontSize: "12px",
        color: "#aaaaaa",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setScrollFactor(0)
      .setDepth(20);

    // Phase/escape status — centered at top
    this.phaseText = this.add
      .text(this.scale.width / 2, 12, "", {
        fontSize: "15px",
        color: "#ffcc00",
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
      })
      .setScrollFactor(0)
      .setDepth(20)
      .setOrigin(0.5, 0);

    // Round countdown timer — below phaseText, always visible during playing
    this.roundTimerText = this.add
      .text(this.scale.width / 2, 38, "", {
        fontSize: "13px",
        color: "#888888",
        stroke: "#000000",
        strokeThickness: 2,
        fontFamily: "monospace",
      })
      .setScrollFactor(0)
      .setDepth(20)
      .setOrigin(0.5, 0);

    // End-screen overlay elements (hidden until game ends)
    this.endText = this.add
      .text(this.scale.width / 2, 210, "", {
        fontFamily: "Arial Black",
        fontSize: "44px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 6,
        align: "center",
      })
      .setScrollFactor(0)
      .setDepth(30)
      .setOrigin(0.5)
      .setVisible(false);

    this.statsText = this.add
      .text(this.scale.width / 2, 300, "", {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#dddddd",
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
        lineSpacing: 6,
      })
      .setScrollFactor(0)
      .setDepth(30)
      .setOrigin(0.5)
      .setVisible(false);

    this.restartText = this.add
      .text(this.scale.width / 2, 405, "[ R ]  Play Again", {
        fontSize: "20px",
        color: "#00ff88",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(30)
      .setOrigin(0.5)
      .setVisible(false);

    this.menuKeyText = this.add
      .text(this.scale.width / 2, 438, "[ M ]  Main Menu", {
        fontSize: "20px",
        color: "#aaaaff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(30)
      .setOrigin(0.5)
      .setVisible(false);

    // Mass milestone announcement (center-screen pop, hidden until triggered)
    this.milestoneText = this.add
      .text(this.scale.width / 2, 155, "", {
        fontFamily: "Arial Black",
        fontSize: "30px",
        color: "#ffdd00",
        stroke: "#000000",
        strokeThickness: 5,
        align: "center",
      })
      .setScrollFactor(0)
      .setDepth(21)
      .setOrigin(0.5)
      .setVisible(false);

    // Minimap — screen-space overlay, bottom-right
    this.minimapGfx = this.add.graphics().setScrollFactor(0).setDepth(22);

    // Leaderboard — top-right, right-anchored
    this.leaderboardText = this.add
      .text(this.scale.width - 14, 14, "", {
        fontSize: "13px",
        color: "#dddddd",
        stroke: "#000000",
        strokeThickness: 3,
        lineSpacing: 3,
        fontFamily: "monospace",
      })
      .setScrollFactor(0)
      .setDepth(22)
      .setOrigin(1, 0);

    // Reposition center-anchored HUD on resize
    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
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

    // Keyboard input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyW = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyE     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyShift = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyQ     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.keyF     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);

    // Mouse input
    this.pointer = this.input.activePointer;
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.pointer = p;
      this.useMouse = true;
      this.useKeyboard = false;
      this.useGamepad = false;
    });
    this.input.on("pointerdown", () => {
      this.mouseDown = true;
    });
    this.input.on("pointerup", () => {
      this.mouseDown = false;
    });

    // Gamepad input
    this.input.gamepad?.once(
      Phaser.Input.Gamepad.Events.CONNECTED,
      (pad: Phaser.Input.Gamepad.Gamepad) => {
        this.gamepad = pad;
        this.useGamepad = true;
        this.useMouse = false;
        this.useKeyboard = false;
      }
    );

    // Initial camera
    this.cameras.main.setZoom(1);
    this.cameras.main.centerOn(this.player.x, this.player.y);

    // ── Wallet: request MetaMask accounts early (non-blocking) ───────
    connectWallet().then((addr) => {
      this.walletAddress = addr;
      if (addr) console.log("[Wallet] Connected:", addr);
    });

    // ── Network: connect to Colyseus server (graceful if offline) ─────
    this.playerTier    = getStoredTier();
    this.buyInTokens   = TIER_INFO[this.playerTier].viCost;

    this.net = new NetworkManager();
    this.net.onPlayerRemoved((id) => {
      this.nameLabels.get(id)?.destroy();
      this.nameLabels.delete(id);
    });
    this.net.connect(getOrCreatePlayerName(), this.playerTier).catch((err: unknown) => {
      console.warn("[Net] Server unavailable — playing offline:", err);
      this.net = null;
    });

    // When server sends a signed claim after escape, surface it to the React layer via DOM event
    this.net?.onClaimReady((payload) => {
      window.dispatchEvent(new CustomEvent("omnivi:claim_ready", { detail: payload }));
    });

    // Kill bounty: apply bonus mass and show floating label
    this.net?.onKillBounty((payload) => {
      // Apply the bonus mass to the player (server already credited it server-side)
      this.player.mass += payload.bonusMass;
      this.spawnFloatLabel(
        this.player.x + (Math.random() - 0.5) * 60,
        this.player.y - 80,
        payload.bonusMass,
        0xffd700,
      );
    });

    // Re-stake: React layer dispatches this after a successful on-chain restake
    const onRestakeDone = () => this.scene.restart();
    window.addEventListener("omnivi:restake_done", onRestakeDone, { once: true });
    this.events.once('shutdown', () =>
      window.removeEventListener("omnivi:restake_done", onRestakeDone));

    // Sound (create after scene is active so AudioContext has a user gesture)
    this.sfx = new SfxManager();
    this.sfx.startTensionDrone();
    this.events.once('shutdown', () => this.sfx.destroy());
    this.wasThrusting = false;
    this.absorbSfxCooldown = 0;

    EventBus.emit("current-scene-ready", this);
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.05); // cap at 50 ms to prevent lag-spike explosions

    // ── Timer & phase transitions ────────────────────────────────────────
    this.gameTimer += dt;
    if (this.phase === 'playing') {
      // Fire warning pulses at 60s, 30s, 10s before shrink
      const remaining = SHRINK_START_DELAY - this.gameTimer;
      for (let i = 0; i < WARN_SECONDS.length; i++) {
        const w = WARN_SECONDS[i];
        if (remaining <= w && !this.warnedAt.has(w)) {
          this.warnedAt.add(w);
          this.warningFlash = 0.7 + i * 0.4;                             // 0.7s→1.1s→1.5s
          this.warningFlashColor = i === 2 ? 0xff2200 : i === 1 ? 0xff6600 : 0xffaa00;
          this.sfx.warnCountdown(i);
        }
      }
    }
    if (this.phase === 'playing' && this.gameTimer >= SHRINK_START_DELAY) {
      this.phase = 'shrinking';
      this.sfx.bigShrink();
    }
    this.absorbSfxCooldown = Math.max(0, this.absorbSfxCooldown - dt);
    if (this.spawnProtectTimer > 0) this.spawnProtectTimer = Math.max(0, this.spawnProtectTimer - dt);

    // ── Freeze game logic when ended; still draw and handle R key ───────
    if (this.phase === 'escaped' || this.phase === 'consumed') {
      this.updateJuice(dt); // keep particles / labels animating on end screen
      this.drawVignette();
      this.drawScene(dt);
      return;
    }

    // ── Determine input mode ────────────────────────────────────────────
    const keyLeft = this.cursors.left?.isDown || this.keyA.isDown;
    const keyRight = this.cursors.right?.isDown || this.keyD.isDown;
    const keyUp = this.cursors.up?.isDown || this.keyW.isDown;
    const keyDown = this.cursors.down?.isDown || this.keyS.isDown;
    const anyKey = keyLeft || keyRight || keyUp || keyDown;

    if (anyKey) {
      this.useKeyboard = true;
      this.useMouse = false;
      this.useGamepad = false;
    }

    // ── Compute aim direction and thrust intent ─────────────────────────
    let thrusting = false;

    if (this.useKeyboard) {
      if (keyLeft) this.player.rotation -= 2.2 * dt;
      if (keyRight) this.player.rotation += 2.2 * dt;
      if (keyUp) thrusting = true;
      if (keyDown) {
        // Brake: apply thrust backward
        this.player.rotation += Math.PI;
        thrusting = true;
        this.player.rotation -= Math.PI;
      }
      if (keyUp) thrusting = true;
    }

    if (this.useGamepad && this.gamepad) {
      const lx = this.gamepad.leftStick?.x ?? 0;
      const ly = this.gamepad.leftStick?.y ?? 0;
      const rt = (this.gamepad as any).R2 ?? 0;
      if (Math.hypot(lx, ly) > 0.1) {
        this.player.rotation = Math.atan2(ly, lx);
      }
      if (rt > 0.1) thrusting = true;
    }

    if (this.useMouse) {
      this.player.rotation = Phaser.Math.Angle.Between(
        this.player.x,
        this.player.y,
        this.pointer.worldX,
        this.pointer.worldY
      );
      if (this.mouseDown) thrusting = true;
    }

    // ── Apply thrust (costs mass, emits dust) ──────────────────────────
    this.player.thrustingThisFrame = thrusting;
    if (thrusting) {
      const ejected = this.player.applyThrust(dt);
      if (ejected && this.dust.length < MAX_DUST) {
        const d = new DustParticle(ejected.x, ejected.y, ejected.vx, ejected.vy, ejected.mass);
        d.playerEjected = true;
        d.playerImmuneUntil = Date.now() + 500;
        this.dust.push(d);
      }
    }

    // Thrust sound: start on press, stop on release
    if (thrusting && !this.wasThrusting) this.sfx.startThrust();
    else if (!thrusting && this.wasThrusting) this.sfx.stopThrust();
    this.wasThrusting = thrusting;

    // ── Update player ──────────────────────────────────────────────────
    this.player.update(dt);

    // ── Gravity simulation ─────────────────────────────────────────────
    {
      // Build Barnes-Hut tree for dust-to-dust gravity
      const tree = new QuadNode(0, 0, WORLD_SIZE, WORLD_SIZE);
      for (const d of this.dust) tree.insert(d);

      const px = this.player.x;
      const py = this.player.y;
      const pm = this.player.mass;

      // Dust: gravity from other dust (Barnes-Hut) + player gravity + asteroid gravity
      for (const d of this.dust) {
        let [ax, ay] = this.dust.length > 0
          ? tree.accelAt(d.x, d.y, d, GRAVITY_THETA)
          : [0, 0];

        // Player as dominant gravity well
        {
          const dx = px - d.x;
          const dy = py - d.y;
          const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
          const dist = Math.sqrt(dSq);
          const pa = GRAVITY_G * pm / dSq;
          ax += pa * dx / dist;
          ay += pa * dy / dist;
        }

        // Each asteroid is also a gravity well for dust
        for (const a of this.asteroids) {
          const dx = a.x - d.x;
          const dy = a.y - d.y;
          const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
          const dist = Math.sqrt(dSq);
          const ag = GRAVITY_G * a.mass / dSq;
          ax += ag * dx / dist;
          ay += ag * dy / dist;
        }

        const mag = Math.hypot(ax, ay);
        if (mag > MAX_G_ACCEL) { ax = ax / mag * MAX_G_ACCEL; ay = ay / mag * MAX_G_ACCEL; }
        d.vx += ax * dt;
        d.vy += ay * dt;
      }

      // Asteroid-to-asteroid gravity (N² but count stays small)
      for (let i = 0; i < this.asteroids.length; i++) {
        const a = this.asteroids[i];
        for (let j = i + 1; j < this.asteroids.length; j++) {
          const b = this.asteroids[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
          const dist = Math.sqrt(dSq);
          const f = GRAVITY_G / dSq / dist; // precompute /dist
          a.vx += b.mass * f * dx * dt;
          a.vy += b.mass * f * dy * dt;
          b.vx -= a.mass * f * dx * dt;
          b.vy -= a.mass * f * dy * dt;
        }
      }

      // Asteroid gravity on player (large rocks are dangerous!)
      const speedBeforeAsteroidGrav = Math.hypot(this.player.vx, this.player.vy);
      for (const a of this.asteroids) {
        const dx = a.x - this.player.x;
        const dy = a.y - this.player.y;
        const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
        const dist = Math.sqrt(dSq);
        let ag = GRAVITY_G * a.mass / dSq;
        let agx = ag * dx / dist;
        let agy = ag * dy / dist;
        const amag = Math.hypot(agx, agy);
        if (amag > MAX_G_ACCEL) { agx = agx / amag * MAX_G_ACCEL; agy = agy / amag * MAX_G_ACCEL; }
        this.player.vx += agx * dt;
        this.player.vy += agy * dt;
      }
      // Gravity slingshot indicator: player gained significant speed from a planet
      const speedAfterAsteroidGrav = Math.hypot(this.player.vx, this.player.vy);
      if (
        speedAfterAsteroidGrav - speedBeforeAsteroidGrav >= 28 &&
        this.slingshotCooldown <= 0 &&
        this.asteroids.some(a => a.mass >= PLANET_THRESHOLD)
      ) {
        this.slingshotCooldown = 6.0;
        this.spawnFloatText(this.player.x, this.player.y - this.player.radius - 10, "GRAVITY ASSIST!", 0x44ffaa);
      }
    }

    // ── Update positions ───────────────────────────────────────────────
    for (const d of this.dust) d.update(dt);
    for (const a of this.asteroids) a.update(dt);

    // ── Dust-to-dust merging ────────────────────────────────────────────
    this.mergeDust();

    // ── Promote large dust → Asteroid ──────────────────────────────────
    this.promoteDust();

    // ── Asteroid absorbs nearby dust ───────────────────────────────────
    this.asteroidAbsorbsDust();

    // ── Asteroids merge with each other (planet formation) ─────────────
    this.mergeAsteroids();

    // ── Player absorbs dust ────────────────────────────────────────────
    {
      const pr = this.player.radius;
      const px = this.player.x;
      const py = this.player.y;
      let absorbed = false;
      const now = Date.now();
      for (const d of this.dust) {
        if (!d.active) continue;
        if (d.playerEjected && now < d.playerImmuneUntil) continue;
        if (this.player.mass < d.mass * ABSORB_RATIO) continue;
        const dx = d.x - px;
        const dy = d.y - py;
        if (dx * dx + dy * dy < (pr + d.radius) * (pr + d.radius)) {
          this.player.mass += d.mass;
          d.active = false;
          absorbed = true;
          this.bumpCombo(1);
          // Brief white flash on player for every absorption
          this.absorbFlashTimer = Math.max(this.absorbFlashTimer, 0.10);
          if (this.absorbSfxCooldown <= 0) {
            this.sfx.absorb(d.mass);
            this.absorbSfxCooldown = 0.1;
            const burstCount = d.mass >= 8 ? 5 : 2;
            this.spawnBurst(d.x, d.y, burstCount, 40, 0x88aaff, 0.22);
          }
        }
      }
      if (absorbed) this.dust = this.dust.filter(d => d.active);
    }

    // ── Player absorbs asteroids ────────────────────────────────────────
    {
      const pr = this.player.radius;
      const px = this.player.x;
      const py = this.player.y;
      let absorbed = false;
      for (const a of this.asteroids) {
        if (!a.active) continue;
        if (this.player.mass < a.mass * ABSORB_RATIO) continue;
        const dx = a.x - px;
        const dy = a.y - py;
        if (dx * dx + dy * dy < (pr + a.radius) * (pr + a.radius)) {
          // Momentum conservation: the player is absorbing a moving body
          const tm = this.player.mass + a.mass;
          this.player.vx = (this.player.vx * this.player.mass + a.vx * a.mass) / tm;
          this.player.vy = (this.player.vy * this.player.mass + a.vy * a.mass) / tm;
          this.player.mass = tm;
          a.active = false;
          absorbed = true;
          this.bumpCombo(3);   // asteroid absorptions are rarer and more skillful
          this.sfx.absorb(a.mass);
          this.absorbFlashTimer = 0.25;
          this.spawnBurst(a.x, a.y, Math.min(30, 8 + Math.floor(a.mass / 20)), 130, 0xffaa44, 0.9);
          this.spawnFloatLabel(a.x, a.y, a.mass, 0xffaa44);
          // Screen shake proportional to asteroid mass
          const shakeMag = Math.min(0.004 + a.mass / 50000, 0.012);
          this.cameras.main.shake(220, shakeMag);
        }
      }
      if (absorbed) this.asteroids = this.asteroids.filter(a => a.active);
    }

    // ── Skill abilities: boost burst, mass eject, shield ──────────────
    this.updateSkills(dt);
    this.updateCombo(dt);

    // ── PvP: player absorbs / is absorbed by remote players ────────────
    this.checkPvP();

    // ── Bots: AI, physics, dust absorption, PvP ────────────────────────
    this.updateBots(dt);

    // ── The Big Shrink: black hole physics ─────────────────────────────
    if (this.phase === 'shrinking') {
      this.updateBlackHole(dt);
      this.updateEscape(dt);
    }

    // ── Juice: particles, float labels, sounds ──────────────────────────
    this.updateJuice(dt);

    // ── Network: send local player state at 20 Hz ──────────────────────
    this.sendTimer += dt;
    if (this.net && this.sendTimer >= this.SEND_RATE) {
      this.sendTimer = 0;
      this.net.sendPlayerState(
        this.player.x, this.player.y,
        this.player.vx, this.player.vy,
        this.player.mass,
        thrusting,
        this.escaping,
      );
    }

    // ── Camera: follow player with dynamic zoom ─────────────────────────
    const targetZoom = Phaser.Math.Clamp(60 / this.player.radius, 0.15, 0.8);
    const currentZoom = this.cameras.main.zoom;
    const newZoom = Phaser.Math.Linear(currentZoom, targetZoom, 0.04);
    this.cameras.main.setZoom(newZoom);
    this.cameras.main.centerOn(this.player.x, this.player.y);

    // ── Mass milestones — announce doubling events ───────────────────────
    {
      const milestones = [2000, 5000, 10000, 25000, 50000, 100000];
      for (const m of milestones) {
        if (this.player.mass >= m && this.lastMassMilestone < m) {
          this.lastMassMilestone = m;
          const mult = Math.round(m / STARTING_MASS);
          const label = mult >= 2 ? `${mult}× MASS!` : `${Math.floor(m)} MASS!`;
          this.milestoneText.setText(label).setAlpha(1).setVisible(true);
          this.milestoneTimer = 2.5;
          this.spawnBurst(this.player.x, this.player.y, 25, 140, 0xffdd00, 1.2);
          break;
        }
      }
    }

    // ── HUD ─────────────────────────────────────────────────────────────
    const speed = Math.hypot(this.player.vx, this.player.vy);
    const planetCount = this.asteroids.filter(a => a.mass >= PLANET_THRESHOLD).length;
    const asteroidCount = this.asteroids.length - planetCount;
    const currentVI    = this.player.mass / MASS_PER_TOKEN;
    const deltaVI      = currentVI - this.buyInTokens;
    const currentUSD   = currentVI * VI_PRICE_USD;
    const deltaUSD     = deltaVI * VI_PRICE_USD;
    const deltaUSDStr  = deltaUSD >= 0 ? `+$${deltaUSD.toFixed(2)}` : `-$${Math.abs(deltaUSD).toFixed(2)}`;
    const tierLabel    = TIER_INFO[this.playerTier].label;
    const losing       = deltaVI < 0;
    const hudLines = [
      `$${currentUSD.toFixed(2)}  (${deltaUSDStr})  [${tierLabel} ${this.buyInTokens}VI = $${(this.buyInTokens * VI_PRICE_USD).toFixed(2)}]`,
      `Mass:     ${Math.floor(this.player.mass)}`,
      `Radius:   ${this.player.radius.toFixed(1)} px`,
      `Speed:    ${speed.toFixed(0)} px/s`,
      `Dust:     ${this.dust.length}`,
      `Asteroids:${asteroidCount}  Planets: ${planetCount}`,
      `Pos:      (${Math.floor(this.player.x)}, ${Math.floor(this.player.y)})`,
    ];
    if (this.spawnProtectTimer > 0) {
      hudLines.push(`SHIELD:   ${this.spawnProtectTimer.toFixed(1)}s`);
    }
    const boostReady  = this.boostCooldown <= 0;
    const ejectReady  = this.ejectCooldown <= 0;
    const shieldReady = this.shieldCooldown <= 0;
    const shieldHUD   = this.shieldTimer > 0
      ? `ACTIVE ${this.shieldTimer.toFixed(1)}s`
      : shieldReady ? "READY" : this.shieldCooldown.toFixed(1) + "s";
    hudLines.push(
      `[SHIFT] Boost: ${boostReady ? "READY" : this.boostCooldown.toFixed(1) + "s"}   ` +
      `[Q] Eject: ${ejectReady ? "READY" : this.ejectCooldown.toFixed(1) + "s"}   ` +
      `[F] Shield: ${shieldHUD}`,
    );
    if (this.absorbCombo > 1) {
      hudLines.push(`COMBO ×${this.absorbCombo}  (resets in ${this.absorbComboTimer.toFixed(1)}s)`);
    }
    // Loss aversion: turn HUD red when below buy-in, green when profiting
    this.massText.setColor(losing ? "#ff3333" : deltaVI > 0 ? "#00ff88" : "#ffffff");
    this.massText.setText(hudLines.join("\n"));

    this.updatePhaseHUD();

    // ── Render ──────────────────────────────────────────────────────────
    this.drawVignette();
    this.drawScene(dt);
    this.drawMinimap();
    this.drawLeaderboard();
  }

  // ─── Black Hole Update ─────────────────────────────────────────────────────
  private updateBlackHole(dt: number) {
    this.shrinkTimer += dt;
    // BH growth accelerates: starts at 200 mass/s, ramps up ~3 mass/s² (doubles at ~67s)
    this.bhMass += (BH_GROWTH_RATE + BH_GROWTH_ACCEL * this.shrinkTimer) * dt;

    const bhR  = massToRadius(this.bhMass);
    const bx   = WORLD_SIZE / 2;
    const by   = WORLD_SIZE / 2;
    const bhG  = GRAVITY_G * BH_GRAVITY_MULT;

    // BH gravity + absorption for dust
    for (const d of this.dust) {
      const dx = bx - d.x;
      const dy = by - d.y;
      const dSq  = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
      const dist = Math.sqrt(dSq);
      const a    = bhG * this.bhMass / dSq;
      d.vx += a * dx / dist * dt;
      d.vy += a * dy / dist * dt;
      if (dist < bhR + d.radius) d.active = false;
    }
    this.dust = this.dust.filter(d => d.active);

    // BH gravity + absorption for asteroids
    for (const a of this.asteroids) {
      const dx = bx - a.x;
      const dy = by - a.y;
      const dSq  = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
      const dist = Math.sqrt(dSq);
      const ag   = bhG * this.bhMass / dSq;
      let agx = ag * dx / dist;
      let agy = ag * dy / dist;
      const amag = Math.hypot(agx, agy);
      if (amag > MAX_G_ACCEL) { agx = agx / amag * MAX_G_ACCEL; agy = agy / amag * MAX_G_ACCEL; }
      a.vx += agx * dt;
      a.vy += agy * dt;
      if (dist < bhR + a.radius) {
        this.bhMass += a.mass * 0.3; // BH grows as it consumes mass
        a.active = false;
      }
    }
    this.asteroids = this.asteroids.filter(a => a.active);

    // BH gravity on player
    const pdx  = bx - this.player.x;
    const pdy  = by - this.player.y;
    const pdSq = Math.max(pdx * pdx + pdy * pdy, GRAVITY_MIN_DIST_SQ);
    const pdist = Math.sqrt(pdSq);
    let pag  = bhG * this.bhMass / pdSq;
    let pagX = pag * pdx / pdist;
    let pagY = pag * pdy / pdist;
    const pagMag = Math.hypot(pagX, pagY);
    if (pagMag > MAX_G_ACCEL) { pagX = pagX / pagMag * MAX_G_ACCEL; pagY = pagY / pagMag * MAX_G_ACCEL; }
    this.player.vx += pagX * dt;
    this.player.vy += pagY * dt;

    // Player consumed by BH
    if (pdist < bhR + this.player.radius) {
      this.phase = 'consumed';
      this.net?.sendConsumed();
      this.showEndScreen(false);
      return;
    }

    // Disruption: BH gravity too strong while escaping
    if (this.escaping && pagMag > MAX_G_ACCEL * 0.45) {
      this.disruptEscape("Too close to the singularity!");
    }
  }

  // ─── Escape Sequence Update ────────────────────────────────────────────────
  private updateEscape(dt: number) {
    // E key: start or cancel escape
    if (Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (!this.escaping) {
        const distFromCenter = Math.hypot(
          this.player.x - WORLD_SIZE / 2,
          this.player.y - WORLD_SIZE / 2
        );
        if (distFromCenter >= ESCAPE_MIN_DIST) {
          this.escaping    = true;
          this.escapeTimer = ESCAPE_DURATION;
        } else {
          // Too close — flash a warning
          this.disruptFlash = 1.5;
          this.phaseText.setText("TOO CLOSE TO CENTER — move to the outer edge!");
        }
      } else {
        // Cancel escape
        this.escaping    = false;
        this.escapeTimer = 0;
      }
    }

    if (!this.escaping) return;

    this.escapeTimer -= dt;
    if (this.disruptFlash > 0) this.disruptFlash -= dt;

    // Disruption: nearby asteroid/dust bigger than ESCAPE_DISRUPT_RATIO × player mass
    for (const a of this.asteroids) {
      if (a.mass < this.player.mass * ESCAPE_DISRUPT_RATIO) continue;
      const dx = a.x - this.player.x;
      const dy = a.y - this.player.y;
      if (dx * dx + dy * dy < (this.player.radius + a.radius) ** 2) {
        this.disruptEscape("Escape disrupted — impact!");
        return;
      }
    }

    // Escape complete!
    if (this.escapeTimer <= 0) {
      this.phase = 'escaped';
      this.net?.sendEscaped(this.walletAddress || undefined);
      this.showEndScreen(true);
    }
  }

  private disruptEscape(reason: string) {
    this.escaping     = false;
    this.escapeTimer  = 0;
    this.disruptFlash = 1.2;
    this.phaseText.setText(reason).setColor("#ff4400");
  }

  // ─── Skill Abilities: Boost + Mass Eject + Shield ──────────────────────────
  private updateSkills(dt: number) {
    this.boostCooldown    = Math.max(0, this.boostCooldown - dt);
    this.ejectCooldown    = Math.max(0, this.ejectCooldown - dt);
    this.slingshotCooldown = Math.max(0, this.slingshotCooldown - dt);

    // Tick down shield and cooldown
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) {
        this.shieldTimer = 0;
        this.sfx.shieldBreak();
      }
    }
    this.shieldCooldown = Math.max(0, this.shieldCooldown - dt);

    // BOOST BURST — Shift key: spend 5% mass for a velocity impulse
    if (Phaser.Input.Keyboard.JustDown(this.keyShift)) {
      if (this.boostCooldown <= 0 && this.player.mass > 100) {
        const massCost = Math.max(15, this.player.mass * BOOST_MASS_COST_PCT);
        this.player.mass = Math.max(15, this.player.mass - massCost);
        const cos = Math.cos(this.player.rotation);
        const sin = Math.sin(this.player.rotation);
        this.player.vx += cos * BOOST_IMPULSE;
        this.player.vy += sin * BOOST_IMPULSE;
        this.boostCooldown = BOOST_COOLDOWN;
        this.sfx.boost();
        this.spawnBurst(this.player.x, this.player.y, 18, 110, 0x00eeff, 0.7);
        this.cameras.main.shake(120, 0.007);
      }
    }

    // MASS EJECT — Q key: eject 10% mass as fast projectile
    if (Phaser.Input.Keyboard.JustDown(this.keyQ)) {
      if (this.ejectCooldown <= 0 && this.player.mass > 80) {
        const ejMass = Phaser.Math.Clamp(
          this.player.mass * EJECT_MASS_PCT,
          EJECT_MASS_MIN,
          EJECT_MASS_MAX,
        );
        this.player.mass = Math.max(15, this.player.mass - ejMass);

        // Recoil: push player back (momentum conservation, capped)
        const cos = Math.cos(this.player.rotation);
        const sin = Math.sin(this.player.rotation);
        this.player.vx -= cos * (ejMass * 0.6);
        this.player.vy -= sin * (ejMass * 0.6);
        const recoilSpd = Math.hypot(this.player.vx, this.player.vy);
        if (recoilSpd > MAX_SPEED) {
          this.player.vx = (this.player.vx / recoilSpd) * MAX_SPEED;
          this.player.vy = (this.player.vy / recoilSpd) * MAX_SPEED;
        }

        // Spawn projectile dust chunk ahead of player
        const spawnX = this.player.x + cos * (this.player.radius + 6);
        const spawnY = this.player.y + sin * (this.player.radius + 6);
        const proj = new DustParticle(
          spawnX, spawnY,
          this.player.vx + cos * EJECT_SPEED,
          this.player.vy + sin * EJECT_SPEED,
          ejMass,
        );
        proj.playerEjected = true;
        proj.playerImmuneUntil = Date.now() + 2000; // can't reabsorb own eject for 2s
        this.dust.push(proj);

        this.ejectCooldown = EJECT_COOLDOWN;
        this.sfx.eject();
        this.spawnBurst(spawnX, spawnY, 10, 70, 0xff8800, 0.55);
      }
    }

    // SHIELD — F key: spend 8% mass for 2.5s of invulnerability
    if (Phaser.Input.Keyboard.JustDown(this.keyF)) {
      if (this.shieldCooldown <= 0 && this.player.mass > 80) {
        const massCost = Math.max(10, this.player.mass * SHIELD_MASS_COST_PCT);
        this.player.mass = Math.max(15, this.player.mass - massCost);
        this.shieldTimer    = SHIELD_DURATION;
        this.shieldCooldown = SHIELD_COOLDOWN;
        this.sfx.shield();
        this.spawnBurst(this.player.x, this.player.y, 20, 90, 0xffdd00, 0.8);
      }
    }
  }

  /** Increment the absorption combo and announce at key thresholds. */
  private bumpCombo(amount: number = 1) {
    this.absorbCombo += amount;
    this.absorbComboTimer = COMBO_TIMEOUT;
    if (this.absorbCombo > this.bestCombo) this.bestCombo = this.absorbCombo;
    for (const thresh of COMBO_ANNOUNCE_THRESHOLDS) {
      if (this.absorbCombo >= thresh && !this.comboAnnounced.has(thresh)) {
        this.comboAnnounced.add(thresh);
        this.milestoneText.setText(`CHAIN x${this.absorbCombo}!`).setAlpha(1).setVisible(true);
        this.milestoneTimer = 2.0;
        this.sfx.combo(this.absorbCombo);
        break; // show highest unannounced threshold this frame
      }
    }
  }

  /** Decay combo timer; reset on expiry. Called in update(). */
  private updateCombo(dt: number) {
    if (this.absorbComboTimer <= 0) return;
    this.absorbComboTimer -= dt;
    if (this.absorbComboTimer <= 0) {
      this.absorbCombo = 0;
      this.comboAnnounced.clear();
    }
  }

  /**
   * PvP collision check: run after local player absorbs dust/asteroids.
   * - If local player overlaps a remote player and is ABSORB_RATIO× larger → absorb them.
   * - If a remote player overlaps local and is ABSORB_RATIO× larger → we die.
   */
  private checkPvP() {
    if (!this.net) return;
    if (this.phase === 'escaped' || this.phase === 'consumed') return;

    const px = this.player.x;
    const py = this.player.y;
    const pr = this.player.radius;
    const pm = this.player.mass;

    for (const [, rp] of this.net.otherPlayers) {
      if (rp.phase !== 'alive') continue;
      if (this.absorbedPlayers.has(rp.id)) continue;

      const rr = Math.sqrt(rp.mass) * 2;
      const dx = rp.x - px;
      const dy = rp.y - py;
      const touchDistSq = (pr + rr) * (pr + rr);
      if (dx * dx + dy * dy > touchDistSq) continue;

      if (pm >= rp.mass * ABSORB_RATIO) {
        // We absorb them: momentum conservation
        const tm = pm + rp.mass;
        this.player.vx = (this.player.vx * pm + rp.vx * rp.mass) / tm;
        this.player.vy = (this.player.vy * pm + rp.vy * rp.mass) / tm;
        this.player.mass = tm;
        this.absorbedPlayers.add(rp.id);
        this.net.sendAbsorbPlayer(rp.id);
        this.sfx.absorb(rp.mass);
        this.absorbFlashTimer = 0.40;
        this.bumpCombo(10);  // PvP kill is the ultimate skill expression
        this.killStreak++;
        this.killStreakTimer = 4.0;
        this.pvpKillGlowTimer = 2.0 + this.killStreak * 0.5;
        this.cameras.main.shake(350, 0.015); // big shake for eating a player
        this.spawnBurst(rp.x, rp.y, 50, 220, 0xffdd00, 1.3);
        this.spawnFloatLabel(rp.x, rp.y, rp.mass, 0xffdd00);
        if (this.killStreak >= 2) {
          this.milestoneText.setText(`KILL STREAK ×${this.killStreak}!`).setAlpha(1).setVisible(true);
          this.milestoneTimer = 2.2;
        }
      } else if (rp.mass >= pm * ABSORB_RATIO && this.spawnProtectTimer <= 0 && this.shieldTimer <= 0) {
        // They absorb us: game over (blocked during spawn protection or active shield)
        this.phase = 'consumed';
        const tag = rp.id.slice(0, 6).toUpperCase();
        this.showEndScreen(false, `ABSORBED BY ${tag}`);
        break;
      }
    }
  }

  // ─── Bot Update ────────────────────────────────────────────────────────────
  private updateBots(dt: number) {
    if (this.phase === 'escaped' || this.phase === 'consumed') return;

    for (const bot of this.bots) {
      if (!bot.active) continue;

      bot.updateAI(dt, this.player, this.dust);
      bot.updatePhysics(dt);

      // BH gravity + consumption during shrink phase
      if (this.phase === 'shrinking') {
        const bx  = WORLD_SIZE / 2;
        const by  = WORLD_SIZE / 2;
        const bhR = massToRadius(this.bhMass);
        const bhG = GRAVITY_G * BH_GRAVITY_MULT;
        const dx  = bx - bot.x;
        const dy  = by - bot.y;
        const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
        const dist = Math.sqrt(dSq);
        let ax = bhG * this.bhMass / dSq * dx / dist;
        let ay = bhG * this.bhMass / dSq * dy / dist;
        const mag = Math.hypot(ax, ay);
        if (mag > MAX_G_ACCEL) { ax = ax / mag * MAX_G_ACCEL; ay = ay / mag * MAX_G_ACCEL; }
        bot.vx += ax * dt;
        bot.vy += ay * dt;
        if (dist < bhR + bot.radius) { bot.active = false; continue; }
      }

      // Bot absorbs dust (momentum-conserving)
      let dustAbsorbed = false;
      for (const d of this.dust) {
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
      if (dustAbsorbed) this.dust = this.dust.filter(d => d.active);

      // Bot absorbs player (blocked during spawn protection or active shield)
      if (bot.mass >= this.player.mass * ABSORB_RATIO && this.spawnProtectTimer <= 0 && this.shieldTimer <= 0) {
        const dx = bot.x - this.player.x;
        const dy = bot.y - this.player.y;
        if (dx * dx + dy * dy < (bot.radius + this.player.radius) ** 2) {
          this.phase = 'consumed';
          this.showEndScreen(false, `ABSORBED BY ${bot.name}`);
          return;
        }
      }

      // Player absorbs bot
      if (this.player.mass >= bot.mass * ABSORB_RATIO) {
        const dx = bot.x - this.player.x;
        const dy = bot.y - this.player.y;
        if (dx * dx + dy * dy < (this.player.radius + bot.radius) ** 2) {
          const tm = this.player.mass + bot.mass;
          this.player.vx = (this.player.vx * this.player.mass + bot.vx * bot.mass) / tm;
          this.player.vy = (this.player.vy * this.player.mass + bot.vy * bot.mass) / tm;
          this.player.mass = tm;
          bot.active = false;
          this.sfx.absorb(bot.mass);
          this.absorbFlashTimer = 0.35;
          this.bumpCombo(10);  // bot kill = skill
          this.killStreak++;
          this.killStreakTimer = 4.0;
          this.pvpKillGlowTimer = 2.0 + this.killStreak * 0.5;
          this.cameras.main.shake(350, 0.015);
          this.spawnBurst(bot.x, bot.y, 40, 190, 0xff7700, 1.1);
          this.spawnFloatLabel(bot.x, bot.y, bot.mass, 0xff7700);
          if (this.killStreak >= 2) {
            this.milestoneText.setText(`KILL STREAK ×${this.killStreak}!`).setAlpha(1).setVisible(true);
            this.milestoneTimer = 2.2;
          }
        }
      }
    }

    this.bots = this.bots.filter(b => b.active);
  }

  private showEndScreen(escaped: boolean, deathMessage?: string) {
    const mass = Math.floor(this.player.mass);
    const timeSurvived = Math.floor(this.gameTimer);
    const score = Math.floor(mass * (1 + this.gameTimer / 60));

    // Compute rank among all players (local + alive remotes + alive bots)
    const allMasses: number[] = [this.player.mass];
    if (this.net) {
      for (const rp of this.net.otherPlayers.values()) {
        if (rp.phase === "alive") allMasses.push(rp.mass);
      }
    }
    for (const bot of this.bots) {
      if (bot.active) allMasses.push(bot.mass);
    }
    allMasses.sort((a, b) => b - a);
    const rank = allMasses.indexOf(this.player.mass) + 1;
    const total = allMasses.length;

    // High score (localStorage)
    const HS_KEY = "omnivi_highscore";
    const prevBest = parseInt(localStorage.getItem(HS_KEY) ?? "0", 10);
    const isNewBest = score > prevBest;
    if (isNewBest) {
      localStorage.setItem(HS_KEY, String(score));
      // Delay jingle slightly so it plays after the escaped/death sound settles
      setTimeout(() => this.sfx.newHighScore(), escaped ? 800 : 1600);
    }

    // Semi-transparent dark overlay
    const gw = this.scale.width;
    const gh = this.scale.height;
    const overlay = this.add.graphics().setScrollFactor(0).setDepth(25);
    overlay.fillStyle(0x000000, 0.65);
    overlay.fillRect(0, 0, gw, gh);

    if (escaped) {
      this.endText.setText("ESCAPED!").setColor("#00ffaa").setVisible(true);
      if (this.player.mass < CLUTCH_MASS_THRESH) {
        this.sfx.clutchEscape();
        this.milestoneText.setText("CLUTCH ESCAPE!!").setColor("#ff00ff").setAlpha(1).setVisible(true);
        this.milestoneTimer = 3.5;
      } else {
        this.sfx.escaped();
      }
    } else {
      const msg = deathMessage ?? "CONSUMED BY THE VOID";
      this.endText.setText(msg).setColor("#ff5500").setVisible(true);
      this.sfx.death();
    }

    const mins = Math.floor(timeSurvived / 60);
    const secs = timeSurvived % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    const rankStr = total > 1 ? `Rank  #${rank} / ${total}` : "";
    const bestStr = isNewBest ? "NEW HIGH SCORE!" : `Best: ${prevBest.toLocaleString()}`;

    // Economy summary
    const finalVI   = this.player.mass / MASS_PER_TOKEN;
    const BONUS_TABLE = [1.50, 1.25, 1.10];
    const bonusMult = escaped && rank >= 1 && rank <= 3 ? BONUS_TABLE[rank - 1] : 1.0;
    const boostedVI = finalVI * bonusMult;
    const rakeVI    = boostedVI * 0.03;
    const netVI     = boostedVI - rakeVI;
    const profitVI  = netVI - this.buyInTokens;
    const netUSD    = netVI * VI_PRICE_USD;
    const profitUSD = profitVI * VI_PRICE_USD;
    let economyLine: string;
    if (escaped) {
      const bonusTag   = bonusMult > 1 ? `  (×${bonusMult} TOP${rank} BONUS)` : "";
      const profitSign = profitVI >= 0 ? "+" : "";
      economyLine = `Payout: $${netUSD.toFixed(2)}  (${profitSign}$${Math.abs(profitUSD).toFixed(2)} ${profitVI >= 0 ? "profit" : "loss"})${bonusTag}`;
    } else {
      economyLine = `Stake lost: -$${(this.buyInTokens * VI_PRICE_USD).toFixed(2)}  (-${this.buyInTokens} VI)`;
    }

    const tierLabel = TIER_INFO[this.playerTier].label;
    const statsLines = [
      `Mass: ${mass.toLocaleString()}   Time: ${timeStr}   Score: ${score.toLocaleString()}`,
      economyLine,
      rankStr,
      bestStr,
    ].filter(Boolean);

    this.statsText
      .setText(statsLines.join("\n"))
      .setColor(isNewBest ? "#ffdd00" : "#dddddd")
      .setVisible(true);

    this.restartText
      .setText(`[ R ]  Re-stake  ${tierLabel} (${this.buyInTokens} VI = $${(this.buyInTokens * VI_PRICE_USD).toFixed(2)})`)
      .setVisible(true);
    this.menuKeyText.setVisible(true);

    this.input.keyboard!.once("keydown-R", () => {
      this.scene.restart();
    });
    this.input.keyboard!.once("keydown-M", () => {
      this.scene.start("MainMenu");
    });
  }

  // ─── Phase HUD ─────────────────────────────────────────────────────────────
  private updatePhaseHUD() {
    if (this.phase === 'playing') {
      const remaining = Math.max(0, SHRINK_START_DELAY - this.gameTimer);
      const mins = Math.floor(remaining / 60);
      const secs = Math.floor(remaining % 60).toString().padStart(2, '0');
      const t_now = this.time.now / 1000;

      if (remaining <= 10) {
        // Final 10s: large blinking red countdown
        const blink = Math.sin(t_now * 10) > 0;
        this.phaseText
          .setText(`⚠  BIG SHRINK IN  ${remaining.toFixed(0)}s  ⚠`)
          .setColor(blink ? "#ff0000" : "#ff6600")
          .setFontSize("18px");
        this.roundTimerText.setText("");
      } else if (remaining <= 30) {
        // 30s: orange pulsing warning
        this.phaseText
          .setText(`⚠  BIG SHRINK IN  ${remaining.toFixed(0)}s  ⚠`)
          .setColor("#ff6600")
          .setFontSize("15px");
        this.roundTimerText.setText("");
      } else if (remaining <= 60) {
        // 60s: amber warning
        this.phaseText
          .setText(`BIG SHRINK IN ${remaining.toFixed(0)}s`)
          .setColor("#ffaa00")
          .setFontSize("14px");
        this.roundTimerText.setText("");
      } else {
        // Normal play: subtle timer
        this.phaseText.setText("").setFontSize("15px");
        this.roundTimerText
          .setText(`SHRINK IN  ${mins}:${secs}`)
          .setColor("#999999")
          .setFontSize("12px");
      }
      return;
    }

    // Clear round timer during shrink/end
    this.roundTimerText.setText("");

    if (this.phase === 'shrinking') {
      if (this.escaping) {
        const t = this.time.now / 1000;
        const pulse = Math.sin(t * 6) > 0 ? "#00ffaa" : "#ffffff";
        this.phaseText
          .setText(`ESCAPING...  ${this.escapeTimer.toFixed(1)}s`)
          .setColor(pulse);
      } else if (this.disruptFlash > 0) {
        // phaseText already set by disruptEscape/warning — leave it
      } else {
        const distFromCenter = Math.hypot(
          this.player.x - WORLD_SIZE / 2,
          this.player.y - WORLD_SIZE / 2
        );
        const canEscape = distFromCenter >= ESCAPE_MIN_DIST;
        if (canEscape) {
          this.phaseText
            .setText("THE BIG SHRINK  |  Press  [E]  to ESCAPE")
            .setColor("#ffcc00");
        } else {
          this.phaseText
            .setText("THE BIG SHRINK  |  Move to the outer edge to escape")
            .setColor("#ff8800");
        }
      }
    }
  }

  // ─── Spatial-grid dust merging ─────────────────────────────────────────────
  private mergeDust() {
    const CELL = 40; // grid cell size — covers max small-dust diameter well
    const grid = new Map<number, DustParticle[]>();
    const cellKey = (cx: number, cy: number) => cx * 10000 + cy;
    const cellOf = (v: number) => Math.floor(v / CELL);

    for (const d of this.dust) {
      const key = cellKey(cellOf(d.x), cellOf(d.y));
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(d);
    }

    let anyMerged = false;
    for (const d of this.dust) {
      if (!d.active) continue;
      const cx = cellOf(d.x);
      const cy = cellOf(d.y);
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        for (let ny = cy - 1; ny <= cy + 1; ny++) {
          const bucket = grid.get(cellKey(nx, ny));
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === d || !other.active) continue;
            const dx = other.x - d.x;
            const dy = other.y - d.y;
            const minDist = d.radius + other.radius;
            if (dx * dx + dy * dy < minDist * minDist) {
              // Larger absorbs smaller; ties go to d
              const bigger = d.mass >= other.mass ? d : other;
              const smaller = bigger === d ? other : d;
              const totalMass = bigger.mass + smaller.mass;
              bigger.vx = (bigger.vx * bigger.mass + smaller.vx * smaller.mass) / totalMass;
              bigger.vy = (bigger.vy * bigger.mass + smaller.vy * smaller.mass) / totalMass;
              bigger.x = (bigger.x * bigger.mass + smaller.x * smaller.mass) / totalMass;
              bigger.y = (bigger.y * bigger.mass + smaller.y * smaller.mass) / totalMass;
              bigger.mass = totalMass;
              smaller.active = false;
              anyMerged = true;
            }
          }
        }
      }
    }

    if (anyMerged) {
      this.dust = this.dust.filter(d => d.active);
    }

    // Respawn sparse ambient dust so the world stays populated
    while (this.dust.length < DUST_RESPAWN_MIN) {
      const x = Math.random() * WORLD_SIZE;
      const y = Math.random() * WORLD_SIZE;
      const mass = DUST_EMIT_MASS + Math.random() * 6;
      const speed = Math.random() * 20;
      const angle = Math.random() * Math.PI * 2;
      this.dust.push(new DustParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, mass));
    }
  }

  /** Graduate dust particles that have grown past the asteroid threshold. */
  private promoteDust() {
    const toPromote: DustParticle[] = [];
    this.dust = this.dust.filter(d => {
      if (d.mass >= ASTEROID_THRESHOLD) {
        toPromote.push(d);
        return false;
      }
      return true;
    });
    for (const d of toPromote) {
      this.asteroids.push(new Asteroid(d.x, d.y, d.vx, d.vy, d.mass));
    }
  }

  /** Each asteroid vacuums up overlapping dust via momentum-conserving absorption. */
  private asteroidAbsorbsDust() {
    let anyConsumed = false;
    for (const a of this.asteroids) {
      const ar = a.radius;
      for (const d of this.dust) {
        if (!d.active) continue;
        const dx = d.x - a.x;
        const dy = d.y - a.y;
        if (dx * dx + dy * dy < (ar + d.radius) * (ar + d.radius)) {
          const tm = a.mass + d.mass;
          a.vx = (a.vx * a.mass + d.vx * d.mass) / tm;
          a.vy = (a.vy * a.mass + d.vy * d.mass) / tm;
          a.x  = (a.x  * a.mass + d.x  * d.mass) / tm;
          a.y  = (a.y  * a.mass + d.y  * d.mass) / tm;
          a.mass = tm;
          d.active = false;
          anyConsumed = true;
        }
      }
    }
    if (anyConsumed) this.dust = this.dust.filter(d => d.active);
  }

  /** Larger asteroid merges with smaller on overlap (planet formation). */
  private mergeAsteroids() {
    let anyMerged = false;
    for (let i = 0; i < this.asteroids.length; i++) {
      const a = this.asteroids[i];
      if (!a.active) continue;
      for (let j = i + 1; j < this.asteroids.length; j++) {
        const b = this.asteroids[j];
        if (!b.active) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        if (dx * dx + dy * dy < minDist * minDist) {
          const bigger  = a.mass >= b.mass ? a : b;
          const smaller = bigger === a ? b : a;
          const tm = bigger.mass + smaller.mass;
          bigger.vx = (bigger.vx * bigger.mass + smaller.vx * smaller.mass) / tm;
          bigger.vy = (bigger.vy * bigger.mass + smaller.vy * smaller.mass) / tm;
          bigger.x  = (bigger.x  * bigger.mass + smaller.x  * smaller.mass) / tm;
          bigger.y  = (bigger.y  * bigger.mass + smaller.y  * smaller.mass) / tm;
          bigger.mass = tm;
          smaller.active = false;
          anyMerged = true;
        }
      }
    }
    if (anyMerged) this.asteroids = this.asteroids.filter(a => a.active);
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  private drawScene(dt: number = 0) {
    this.gfx.clear();

    // Draw black hole first (underneath everything)
    if (this.phase === 'shrinking' || this.phase === 'escaped' || this.phase === 'consumed') {
      this.drawBlackHole();
    }

    // ── Draw remote players (ghost players behind local) ─────────────────
    this.drawRemotePlayers(dt);

    // ── Draw bot players ─────────────────────────────────────────────────
    this.drawBots();

    // ── Draw dust — color shifts from blue (tiny) to orange (medium) ────
    for (const d of this.dust) {
      const r = Math.max(1.5, d.radius);
      // t: 0 at mass=2 (dust), 1 at mass=ASTEROID_THRESHOLD
      const t = Math.min(1, Math.log(Math.max(1, d.mass / 2)) / Math.log(25));
      const ri = Math.round(0x88 + t * (0xff - 0x88));
      const gi = Math.round(0xaa + t * (0x55 - 0xaa));
      const bi = Math.round(0xff + t * (0x11 - 0xff));
      const color = (ri << 16) | (gi << 8) | bi;
      const alpha = 0.55 + t * 0.35;
      this.gfx.fillStyle(color, alpha);
      this.gfx.fillCircle(d.x, d.y, r);
    }

    // ── Draw asteroids — craggy polygons, gray-brown-white by mass ───────
    for (const a of this.asteroids) {
      this.drawAsteroid(a);
    }

    const { x, y, radius, rotation, mass, thrustingThisFrame } = this.player;

    // ── Escape aura (drawn behind player) ───────────────────────────────
    if (this.escaping) {
      this.drawEscapeAura(x, y, radius);
    }

    // ── Engine exhaust trail + burst particles (juice) ───────────────────
    this.drawJuice(dt);

    // ── Thrust exhaust flame ─────────────────────────────────────────────
    if (thrustingThisFrame) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const flameX = x - cos * radius;
      const flameY = y - sin * radius;
      this.gfx.fillStyle(0xff4400, 0.3);
      this.gfx.fillCircle(flameX, flameY, radius * 0.55);
      this.gfx.fillStyle(0xffee00, 0.8);
      this.gfx.fillCircle(flameX, flameY, radius * 0.25);
    }

    // ── Spawn protection ring ────────────────────────────────────────────
    if (this.spawnProtectTimer > 0) {
      const t_prot = this.time.now / 1000;
      const fade   = this.spawnProtectTimer / SPAWN_PROTECT_SECS;    // 1→0
      const pulse  = 0.45 + 0.35 * Math.sin(t_prot * 6);
      const alpha  = fade * pulse;
      // Outer glow fill
      this.gfx.fillStyle(0x00ffff, alpha * 0.12);
      this.gfx.fillCircle(x, y, radius * 1.7);
      // Crisp ring
      this.gfx.lineStyle(Math.max(1.5, radius * 0.05), 0x00ffff, alpha);
      this.gfx.strokeCircle(x, y, radius * 1.4);
      // Inner ring (dimmer, slightly smaller)
      this.gfx.lineStyle(Math.max(1, radius * 0.03), 0x88ffff, alpha * 0.6);
      this.gfx.strokeCircle(x, y, radius * 1.2);
    }

    // ── F-key Shield — gold/amber ring while shieldTimer > 0 ────────────
    if (this.shieldTimer > 0) {
      const t_sh  = this.time.now / 1000;
      const fade  = this.shieldTimer / SHIELD_DURATION;   // 1→0 as shield expires
      const pulse = 0.40 + 0.40 * Math.sin(t_sh * 9);    // faster pulse than spawn ring
      const alpha = fade * pulse;
      // Outer amber glow
      this.gfx.fillStyle(0xffcc00, alpha * 0.12);
      this.gfx.fillCircle(x, y, radius * 1.85);
      // Primary gold ring
      this.gfx.lineStyle(Math.max(2, radius * 0.07), 0xffcc00, alpha);
      this.gfx.strokeCircle(x, y, radius * 1.55);
      // Secondary inner ring (dimmer)
      this.gfx.lineStyle(Math.max(1, radius * 0.03), 0xffe066, alpha * 0.55);
      this.gfx.strokeCircle(x, y, radius * 1.30);
    }

    // ── Absorption impact flash — white halo burst on absorb ─────────────
    if (this.absorbFlashTimer > 0) {
      const ft = this.absorbFlashTimer / 0.40; // normalise to peak flash duration
      this.gfx.fillStyle(0xffffff, ft * 0.45);
      this.gfx.fillCircle(x, y, radius * (1.3 + ft * 0.9));
      this.gfx.lineStyle(Math.max(1, radius * 0.06), 0xffffff, ft * 0.9);
      this.gfx.strokeCircle(x, y, radius * (1.1 + ft * 0.4));
    }

    // ── Pulsing mass glow (scales and breathes with mass) ────────────────
    const glowPulse   = 0.04 + 0.025 * Math.sin(this.time.now / 280);
    const massFrac    = Math.min(1, mass / 4000);
    const glowRadius  = radius * (2.2 + massFrac * 1.2);
    const glowColor   = mass > 2000 ? 0xffaa00 : 0xffffff;
    this.gfx.fillStyle(glowColor, glowPulse);
    this.gfx.fillCircle(x, y, glowRadius);

    // ── Player body — color shifts blue → yellow → red with mass ─────────
    const t = Math.min(1, mass / 5000);
    const hue = (1 - t) * 0.65;
    const playerColor = Phaser.Display.Color.HSLToColor(hue, 0.9, 0.6).color;
    this.gfx.fillStyle(playerColor, 1);
    this.gfx.fillCircle(x, y, radius);

    this.gfx.lineStyle(Math.max(1, radius * 0.04), 0xffffff, 0.7);
    this.gfx.strokeCircle(x, y, radius);

    // ── Direction indicator ──────────────────────────────────────────────
    const tipLen = radius + 12;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    this.gfx.lineStyle(Math.max(1.5, radius * 0.06), 0xffffff, 0.9);
    this.gfx.lineBetween(
      x + cos * radius * 0.3,
      y + sin * radius * 0.3,
      x + cos * tipLen,
      y + sin * tipLen
    );
  }

  /** Animated black hole at world center. */
  private drawBlackHole() {
    const bx  = WORLD_SIZE / 2;
    const by  = WORLD_SIZE / 2;
    const bhR = massToRadius(this.bhMass);
    const t   = this.time.now / 1000;

    // Outer gravitational lensing rings (faint, decreasing brightness outward)
    const lensRadii = [4.0, 3.0, 2.2, 1.6];
    const lensAlpha = [0.02, 0.04, 0.06, 0.08];
    for (let i = 0; i < lensRadii.length; i++) {
      this.gfx.fillStyle(0xff6600, lensAlpha[i]);
      this.gfx.fillCircle(bx, by, bhR * lensRadii[i]);
    }

    // Accretion disk — swirling hotspots orbiting the BH
    const numSpots = 10;
    for (let i = 0; i < numSpots; i++) {
      const angle  = (i / numSpots) * Math.PI * 2 + t * (1.2 + i * 0.08);
      const arcR   = bhR * (1.15 + 0.3 * Math.sin(i * 1.7 + t * 0.5));
      const ax     = bx + Math.cos(angle) * arcR;
      const ay     = by + Math.sin(angle) * arcR;
      const brightness = 0.1 + 0.15 * Math.sin(t * 3 + i * 0.9);
      // Color cycles orange → white near center
      const spotHue = 0.04 + 0.04 * Math.sin(t + i);
      const spotColor = Phaser.Display.Color.HSLToColor(spotHue, 0.9, 0.55).color;
      this.gfx.fillStyle(spotColor, Math.max(0.05, brightness));
      this.gfx.fillCircle(ax, ay, bhR * 0.14);
    }

    // Photon sphere ring
    this.gfx.lineStyle(Math.max(2, bhR * 0.04), 0xff9900, 0.5 + 0.3 * Math.sin(t * 2));
    this.gfx.strokeCircle(bx, by, bhR * 1.1);

    // Event horizon — pure black
    this.gfx.fillStyle(0x000000, 1);
    this.gfx.fillCircle(bx, by, bhR);

    // Thin bright rim at event horizon edge
    this.gfx.lineStyle(Math.max(1.5, bhR * 0.03), 0xffcc44, 0.7);
    this.gfx.strokeCircle(bx, by, bhR);
  }

  /** Pulsing escape aura drawn around the player. */
  private drawEscapeAura(x: number, y: number, radius: number) {
    const t     = this.time.now / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);

    this.gfx.lineStyle(5 + pulse * 4, 0x00ffaa, 0.35 + pulse * 0.45);
    this.gfx.strokeCircle(x, y, radius * 1.6 + pulse * 10);

    this.gfx.lineStyle(2, 0xffffff, 0.5 + pulse * 0.4);
    this.gfx.strokeCircle(x, y, radius * 1.25 + pulse * 5);
  }

  /** Screen-space vignette + disruption flash (drawn to vignetteGfx). */
  private drawVignette() {
    this.vignetteGfx.clear();

    const gw = this.scale.width;
    const gh = this.scale.height;

    // Pre-shrink tension: amber border builds in the last 60s of safe phase
    if (this.phase === 'playing') {
      const remaining = SHRINK_START_DELAY - this.gameTimer;
      if (remaining < 60) {
        const tensionT = 1 - (remaining / 60);  // 0 at 60s remaining → 1 at shrink
        const t_now = this.time.now / 1000;
        const pulse = 0.45 + 0.55 * Math.sin(t_now * (2 + tensionT * 4));
        const alpha = tensionT * 0.35 * pulse;
        this.vignetteGfx.lineStyle(12 + tensionT * 28, 0xff6600, alpha);
        this.vignetteGfx.strokeRect(0, 0, gw, gh);
      }
    }

    // Warning flash (amber/orange/red pulse on 60s/30s/10s warnings)
    if (this.warningFlash > 0) {
      const alpha = Math.min(0.30, this.warningFlash * 0.40);
      this.vignetteGfx.fillStyle(this.warningFlashColor, alpha);
      this.vignetteGfx.fillRect(0, 0, gw, gh);
    }

    // Disruption flash (red) — shown for any disruption/warning
    if (this.disruptFlash > 0) {
      const alpha = Math.min(0.4, this.disruptFlash * 0.33);
      this.vignetteGfx.fillStyle(0xff2200, alpha);
      this.vignetteGfx.fillRect(0, 0, gw, gh);
      return;
    }

    // Speed lines (drawn regardless of phase while playing)
    const speed = Math.hypot(this.player.vx, this.player.vy);
    this.drawSpeedLines(speed);

    // PvP kill glow — gold border escalates with kill streak
    if (this.pvpKillGlowTimer > 0) {
      const maxTimer = 2.0 + this.killStreak * 0.5;
      const t = this.pvpKillGlowTimer / maxTimer;
      const streakBonus = Math.min(3, this.killStreak);
      const thickness = 10 + t * 6 + streakBonus * 4;
      const color = this.killStreak >= 3 ? 0xff4400 : this.killStreak >= 2 ? 0xffcc00 : 0xffaa00;
      this.vignetteGfx.lineStyle(thickness, color, t * 0.80);
      this.vignetteGfx.strokeRect(0, 0, gw, gh);
    }

    if (this.phase !== 'shrinking') return;

    // Darkness creeps in as player approaches BH
    const distFromBH = Math.hypot(
      this.player.x - WORLD_SIZE / 2,
      this.player.y - WORLD_SIZE / 2
    );
    const bhR  = massToRadius(this.bhMass);
    const danger = Math.max(0, 1 - distFromBH / (bhR * 9));
    if (danger > 0) {
      this.vignetteGfx.fillStyle(0x000000, danger * 0.55);
      this.vignetteGfx.fillRect(0, 0, gw, gh);
    }

    // Shrink pulsing red border — intensifies over time and with shrinkTimer
    const shrinkProgress = Math.min(1, this.shrinkTimer / 90); // 0..1 over 90s
    const t_shrink = this.time.now / 1000;
    const shrinkPulse = 0.45 + 0.55 * Math.sin(t_shrink * (3 + shrinkProgress * 5));
    const shrinkBorderAlpha = (0.12 + shrinkProgress * 0.55) * shrinkPulse;
    this.vignetteGfx.lineStyle(6 + shrinkProgress * 22, 0xff2200, shrinkBorderAlpha);
    this.vignetteGfx.strokeRect(0, 0, gw, gh);

    // Final stretch (shrinkTimer >= 60): rapid red flicker overlay + bright outer border
    if (this.shrinkTimer >= 60) {
      const finalT     = Math.min(1, (this.shrinkTimer - 60) / 30); // 0..1 over 30s
      const rapidPulse = 0.5 + 0.5 * Math.sin(t_shrink * (8 + finalT * 12)); // 8→20 Hz pulse
      // Screen-fill red tint that intensifies toward end
      this.vignetteGfx.fillStyle(0xff0000, finalT * 0.20 * rapidPulse);
      this.vignetteGfx.fillRect(0, 0, gw, gh);
      // Extra bright border on top of the base shrink border
      this.vignetteGfx.lineStyle(4 + finalT * 10, 0xff4400, 0.6 + finalT * 0.35);
      this.vignetteGfx.strokeRect(2, 2, gw - 4, gh - 4);
    }
  }

  // ─── Juice helpers ──────────────────────────────────────────────────────

  /** Spawn N burst particles at world position (x,y). */
  private spawnBurst(x: number, y: number, count: number, speed: number, color: number, life: number) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = speed * (0.35 + Math.random() * 0.8);
      this.particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, life, maxLife: life, color, r: 1.5 + Math.random() * 3.5 });
    }
  }

  /** Spawn a floating "+mass" label at world position (x,y). */
  private spawnFloatLabel(x: number, y: number, mass: number, color: number = 0x00ff88) {
    const hex   = '#' + color.toString(16).padStart(6, '0');
    const size  = Math.max(14, Math.min(36, 10 + Math.sqrt(mass)));
    const label = this.add.text(x, y, `+${Math.floor(mass)}`, {
      fontSize: size + 'px',
      fontFamily: 'monospace',
      color: hex,
      stroke: '#000000',
      strokeThickness: 3,
    }).setDepth(20).setOrigin(0.5, 1);
    this.floatLabels.push({ text: label, vy: -55 - Math.random() * 30, life: 1.4, maxLife: 1.4 });
  }

  /** Spawn a floating text string (non-mass announcements like "GRAVITY ASSIST!"). */
  private spawnFloatText(x: number, y: number, str: string, color: number = 0x44ffaa) {
    const hex   = '#' + color.toString(16).padStart(6, '0');
    const label = this.add.text(x, y, str, {
      fontSize: '17px',
      fontFamily: 'monospace',
      color: hex,
      stroke: '#000000',
      strokeThickness: 3,
    }).setDepth(20).setOrigin(0.5, 1);
    this.floatLabels.push({ text: label, vy: -48, life: 2.0, maxLife: 2.0 });
  }

  /** Update particles, trail, float labels, timers; play BH rumble / heartbeat. */
  private updateJuice(dt: number) {
    // Burst particles
    for (const p of this.particles) {
      p.x   += p.vx * dt;
      p.y   += p.vy * dt;
      p.vx  *= 0.90;
      p.vy  *= 0.90;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);

    // Float labels
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

    // Trail: age is tracked in drawJuice
    this.trailPoints = this.trailPoints.filter(tp => tp.life > 0);

    // Kill glow decay
    if (this.pvpKillGlowTimer > 0) this.pvpKillGlowTimer = Math.max(0, this.pvpKillGlowTimer - dt);

    // Warning flash decay
    if (this.warningFlash > 0) this.warningFlash = Math.max(0, this.warningFlash - dt);

    // Absorption flash decay
    if (this.absorbFlashTimer > 0) this.absorbFlashTimer = Math.max(0, this.absorbFlashTimer - dt);

    // Kill streak decay — reset after inactivity
    if (this.killStreakTimer > 0) {
      this.killStreakTimer = Math.max(0, this.killStreakTimer - dt);
      if (this.killStreakTimer <= 0) this.killStreak = 0;
    }

    // Milestone text fade-out
    if (this.milestoneTimer > 0) {
      this.milestoneTimer = Math.max(0, this.milestoneTimer - dt);
      const alpha = this.milestoneTimer < 0.5 ? this.milestoneTimer / 0.5 : 1;
      this.milestoneText.setAlpha(alpha);
      if (this.milestoneTimer <= 0) this.milestoneText.setVisible(false);
    }

    // BH rumble (throttled, only during shrink)
    if (this.phase === 'shrinking') {
      this.bhRumbleCooldown = Math.max(0, this.bhRumbleCooldown - dt);
      if (this.bhRumbleCooldown <= 0) {
        const dist      = Math.hypot(this.player.x - WORLD_SIZE / 2, this.player.y - WORLD_SIZE / 2);
        const intensity = Math.max(0, 1 - dist / 2200);
        if (intensity > 0.08) {
          this.sfx.bhRumble(intensity);
          this.bhRumbleCooldown = 0.55;
        }
      }

      // BH camera shake — escalates as shrinkTimer grows (every 5s → every 1.5s)
      this.bhCameraShakeCooldown = Math.max(0, this.bhCameraShakeCooldown - dt);
      if (this.bhCameraShakeCooldown <= 0) {
        const shrinkP = Math.min(1, this.shrinkTimer / 90);
        const shakeInterval = Math.max(1.5, 5.0 - shrinkP * 3.5); // 5s → 1.5s
        const shakeIntensity = 0.003 + shrinkP * 0.013;            // 0.003 → 0.016
        this.cameras.main.shake(180, shakeIntensity);
        this.bhCameraShakeCooldown = shakeInterval;
      }

      // One-shot climax announcement when shrink has been running 60s
      if (!this.climaxWarningFired && this.shrinkTimer >= 60) {
        this.climaxWarningFired = true;
        this.warningFlash      = 2.0;
        this.warningFlashColor = 0xff0000;
        this.spawnFloatText(this.player.x, this.player.y - this.player.radius * 2,
          '⚠  FINAL STRETCH  ⚠', 0xff2200);
        this.sfx.warnCountdown(2); // red urgency beep
      }
    }

    // Tension drone: ramps from silence to ambient during play, peaks during shrink
    if (this.phase === 'playing') {
      const pp  = this.gameTimer / SHRINK_START_DELAY;   // 0..1
      this.sfx.setTensionDrone(35 + pp * 25, pp * pp * 0.06);
    } else if (this.phase === 'shrinking') {
      const sp = Math.min(1, this.shrinkTimer / 90);
      this.sfx.setTensionDrone(60 + sp * 80, 0.06 + sp * 0.16);
    } else {
      this.sfx.setTensionDrone(35, 0);
    }

    // Heartbeat when mass drops below 80% of starting mass
    if (this.phase === 'playing' || this.phase === 'shrinking') {
      this.heartbeatCooldown = Math.max(0, this.heartbeatCooldown - dt);
      if (this.heartbeatCooldown <= 0 && this.player.mass < STARTING_MASS * 0.8) {
        this.sfx.heartbeat();
        const ratio = Math.max(0.1, this.player.mass / (STARTING_MASS * 0.8));
        this.heartbeatCooldown = 0.25 + ratio * 0.85; // 0.25s (near-dead) → 1.1s (barely low)
      }
    }
  }

  /** Draw burst particles and engine exhaust trail into gfx. dt needed to tick trail. */
  private drawJuice(dt: number) {
    // Engine exhaust trail: push new point when thrusting
    if (this.player.thrustingThisFrame) {
      const cos = Math.cos(this.player.rotation);
      const sin = Math.sin(this.player.rotation);
      this.trailPoints.push({
        x: this.player.x - cos * this.player.radius * 0.8,
        y: this.player.y - sin * this.player.radius * 0.8,
        life: 0.35, maxLife: 0.35,
      });
    }
    // Age trail points and draw them
    for (const tp of this.trailPoints) {
      tp.life -= dt;
      if (tp.life <= 0) continue;
      const t = tp.life / tp.maxLife;           // 1 → 0
      const r = (3 + t * 5) * this.player.radius / 40; // scale with player size
      this.gfx.fillStyle(0xff5500, t * 0.55);
      this.gfx.fillCircle(tp.x, tp.y, r);
      this.gfx.fillStyle(0xffcc00, t * 0.35);
      this.gfx.fillCircle(tp.x, tp.y, r * 0.5);
    }

    // Burst particles
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      const t = p.life / p.maxLife;
      this.gfx.fillStyle(p.color, t * 0.85);
      this.gfx.fillCircle(p.x, p.y, Math.max(0.5, p.r * t));
    }
  }

  /** Speed lines drawn in screen-space into vignetteGfx (must be called AFTER clear). */
  private drawSpeedLines(speed: number) {
    const MIN_SPEED = 200;
    if (speed < MIN_SPEED) return;
    const t = Math.min(1, (speed - MIN_SPEED) / 300); // 0 at 200px/s → 1 at 500px/s
    if (t < 0.05) return;
    const gw    = this.scale.width;
    const gh    = this.scale.height;
    const cx    = gw / 2;
    const cy    = gh / 2;
    const angle = Math.atan2(this.player.vy, this.player.vx);
    const count = Math.floor(t * 10) + 2;
    for (let i = 0; i < count; i++) {
      // Spread evenly + slight offset — deterministic per i so no flicker
      const spread   = ((i / count) - 0.5) * Math.PI * 1.3;
      const lineAng  = angle + spread + Math.PI;
      const startD   = 50 + (i * 23) % 120;
      const len      = 25 + t * 70;
      const x0 = cx + Math.cos(lineAng) * startD;
      const y0 = cy + Math.sin(lineAng) * startD;
      const x1 = cx + Math.cos(lineAng) * (startD + len);
      const y1 = cy + Math.sin(lineAng) * (startD + len);
      this.vignetteGfx.lineStyle(0.8 + t * 1.2, 0x99ccff, t * 0.30);
      this.vignetteGfx.lineBetween(x0, y0, x1, y1);
    }
  }

  private drawAsteroid(a: Asteroid) {
    const r = a.radius;
    const n = ASTEROID_VERTICES;

    // Color: dark gray → brown → pale gold as mass grows (ASTEROID_THRESHOLD → PLANET_THRESHOLD)
    const t = Math.min(1, Math.log(Math.max(1, a.mass / ASTEROID_THRESHOLD)) / Math.log(PLANET_THRESHOLD / ASTEROID_THRESHOLD));
    const ri = Math.round(0x66 + t * (0xcc - 0x66));
    const gi = Math.round(0x55 + t * (0x99 - 0x55));
    const bi = Math.round(0x44 + t * (0x44 - 0x44));
    const fillColor = (ri << 16) | (gi << 8) | bi;

    // Draw filled polygon
    this.gfx.fillStyle(fillColor, 1);
    this.gfx.beginPath();
    for (let i = 0; i < n; i++) {
      const angle = a.rotation + (i / n) * Math.PI * 2;
      const vr = r * a.shapeOffsets[i];
      const vx = a.x + Math.cos(angle) * vr;
      const vy = a.y + Math.sin(angle) * vr;
      if (i === 0) this.gfx.moveTo(vx, vy);
      else         this.gfx.lineTo(vx, vy);
    }
    this.gfx.closePath();
    this.gfx.fillPath();

    // Craggy outline — brighter for larger bodies
    const outlineAlpha = 0.4 + t * 0.4;
    const outlineColor = t > 0.7 ? 0xffdd88 : 0xaaaaaa;
    this.gfx.lineStyle(Math.max(1, r * 0.06), outlineColor, outlineAlpha);
    this.gfx.beginPath();
    for (let i = 0; i < n; i++) {
      const angle = a.rotation + (i / n) * Math.PI * 2;
      const vr = r * a.shapeOffsets[i];
      const vx = a.x + Math.cos(angle) * vr;
      const vy = a.y + Math.sin(angle) * vr;
      if (i === 0) this.gfx.moveTo(vx, vy);
      else         this.gfx.lineTo(vx, vy);
    }
    this.gfx.closePath();
    this.gfx.strokePath();

    // Planet glow for large bodies
    if (a.mass >= PLANET_THRESHOLD) {
      this.gfx.fillStyle(0xffdd44, 0.06);
      this.gfx.fillCircle(a.x, a.y, r * 2.0);
    }
  }

  /** Render AI bots as colored circles with direction indicators and name labels. */
  private drawBots() {
    const seen = new Set<string>();

    for (const bot of this.bots) {
      if (!bot.active) continue;
      seen.add(bot.name);
      const r = bot.radius;

      // Subtle glow
      this.gfx.fillStyle(bot.color, 0.07);
      this.gfx.fillCircle(bot.x, bot.y, r * 2.0);

      // Body
      this.gfx.fillStyle(bot.color, 0.8);
      this.gfx.fillCircle(bot.x, bot.y, r);

      // Outline
      this.gfx.lineStyle(Math.max(1, r * 0.04), 0xffffff, 0.4);
      this.gfx.strokeCircle(bot.x, bot.y, r);

      // Direction indicator
      const cos = Math.cos(bot.rotation);
      const sin = Math.sin(bot.rotation);
      this.gfx.lineStyle(Math.max(1.5, r * 0.06), 0xffffff, 0.7);
      this.gfx.lineBetween(bot.x + cos * r * 0.3, bot.y + sin * r * 0.3, bot.x + cos * (r + 10), bot.y + sin * (r + 10));

      // Thrust flame
      if (bot.thrustingThisFrame) {
        const flameX = bot.x - cos * r;
        const flameY = bot.y - sin * r;
        this.gfx.fillStyle(0xff4400, 0.3);
        this.gfx.fillCircle(flameX, flameY, r * 0.55);
        this.gfx.fillStyle(0xffee00, 0.7);
        this.gfx.fillCircle(flameX, flameY, r * 0.25);
      }

      // Name label (world-space, above bot circle)
      if (!this.botNameLabels.has(bot.name)) {
        const lbl = this.add.text(0, 0, bot.name, {
          fontSize: '13px', fontFamily: 'monospace',
          color: '#ffffff', stroke: '#000000', strokeThickness: 3,
        }).setAlpha(0.85).setOrigin(0.5, 1).setDepth(15);
        this.botNameLabels.set(bot.name, lbl);
      }
      this.botNameLabels.get(bot.name)!.setPosition(bot.x, bot.y - r - 5);
    }

    // Destroy labels for inactive bots
    for (const [name, lbl] of this.botNameLabels) {
      if (!seen.has(name)) {
        lbl.destroy();
        this.botNameLabels.delete(name);
      }
    }
  }

  /** Render all remote players as tinted circles with name labels. */
  private drawRemotePlayers(dt: number = 0) {
    if (!this.net) return;
    // Dead-reckoning interpolation: lerp render positions toward
    // server pos + velocity * estimated network lag (50ms) each frame.
    // This hides the 20 Hz server tick rate with smooth motion.
    const TICK_LAG   = 0.05;  // assume ~50ms from when server sampled to when we apply it
    const INTERP_SPD = 14;    // lerp rate — converges in ~1/14 s ≈ 70ms

    const seen = new Set<string>();
    for (const [id, rp] of this.net.otherPlayers) {
      if (rp.phase !== "alive") continue;
      seen.add(id);

      // ── Interpolation ─────────────────────────────────────────────────
      const deadX = rp.x + rp.vx * TICK_LAG;
      const deadY = rp.y + rp.vy * TICK_LAG;
      if (!this.remoteRender.has(id)) {
        // First time we see this player: snap to position, no lerp
        this.remoteRender.set(id, { renderX: deadX, renderY: deadY });
      }
      const rr = this.remoteRender.get(id)!;
      const alpha = Math.min(dt * INTERP_SPD, 1);
      rr.renderX += (deadX - rr.renderX) * alpha;
      rr.renderY += (deadY - rr.renderY) * alpha;
      const rx = rr.renderX;
      const ry = rr.renderY;

      // ── Draw ──────────────────────────────────────────────────────────
      const r = Math.sqrt(rp.mass) * 2; // massToRadius
      const color = parseHslColor(rp.color);

      // Subtle glow
      this.gfx.fillStyle(color, 0.08);
      this.gfx.fillCircle(rx, ry, r * 2.0);

      // Body
      this.gfx.fillStyle(color, 0.75);
      this.gfx.fillCircle(rx, ry, r);

      // Outline
      this.gfx.lineStyle(Math.max(1, r * 0.04), 0xffffff, 0.5);
      this.gfx.strokeCircle(rx, ry, r);

      // Thrust flash
      if (rp.isThrusting) {
        this.gfx.fillStyle(0xff6600, 0.35);
        this.gfx.fillCircle(rx, ry, r * 0.4);
      }

      // Escape aura
      if (rp.isEscaping) {
        this.gfx.lineStyle(3, 0x00ffaa, 0.4);
        this.gfx.strokeCircle(rx, ry, r * 1.5);
      }

      // Name label above the player circle
      if (!this.nameLabels.has(id)) {
        const lbl = this.add.text(0, 0, rp.name, {
          fontSize: '13px', fontFamily: 'monospace',
          color: '#ffffff',
          stroke: '#000000', strokeThickness: 3,
        }).setAlpha(0.85).setOrigin(0.5, 1).setDepth(15);
        this.nameLabels.set(id, lbl);
      }
      const lbl = this.nameLabels.get(id)!;
      lbl.setPosition(rx, ry - r - 5);
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

  // ─── Minimap ───────────────────────────────────────────────────────────────
  private drawMinimap() {
    const gw = this.scale.width;
    const gh = this.scale.height;
    const MM_SIZE = 160;
    const MM_PAD  = 12;
    const mmX  = gw - MM_SIZE - MM_PAD;   // top-left of minimap in screen coords
    const mmY  = gh - MM_SIZE - MM_PAD;
    const sc   = MM_SIZE / WORLD_SIZE;     // world → minimap scale

    this.minimapGfx.clear();

    // Background
    this.minimapGfx.fillStyle(0x000818, 0.65);
    this.minimapGfx.fillRect(mmX, mmY, MM_SIZE, MM_SIZE);

    // Border
    this.minimapGfx.lineStyle(1, 0x334455, 0.9);
    this.minimapGfx.strokeRect(mmX, mmY, MM_SIZE, MM_SIZE);

    const wx = (wx: number) => mmX + wx * sc;
    const wy = (wy: number) => mmY + wy * sc;

    // Black hole at world center (visible during shrink phase)
    if (this.phase === 'shrinking' || this.phase === 'escaped' || this.phase === 'consumed') {
      const bhR = Math.max(3, Math.min(massToRadius(this.bhMass) * sc, 14));
      this.minimapGfx.fillStyle(0xff6600, 0.9);
      this.minimapGfx.fillCircle(wx(WORLD_SIZE / 2), wy(WORLD_SIZE / 2), bhR);
      this.minimapGfx.fillStyle(0x000000, 1);
      this.minimapGfx.fillCircle(wx(WORLD_SIZE / 2), wy(WORLD_SIZE / 2), bhR * 0.65);
    }

    // Asteroids — gray; planets — gold
    for (const a of this.asteroids) {
      const isPlanet = a.mass >= PLANET_THRESHOLD;
      this.minimapGfx.fillStyle(isPlanet ? 0xffdd88 : 0x778899, isPlanet ? 0.85 : 0.55);
      this.minimapGfx.fillCircle(wx(a.x), wy(a.y), isPlanet ? 3 : 1.5);
    }

    // Remote players — their hue-colored dots
    if (this.net) {
      for (const [, rp] of this.net.otherPlayers) {
        if (rp.phase !== "alive") continue;
        this.minimapGfx.fillStyle(parseHslColor(rp.color), 0.9);
        this.minimapGfx.fillCircle(wx(rp.x), wy(rp.y), 3);
      }
    }

    // Bot players — colored dots
    for (const bot of this.bots) {
      if (!bot.active) continue;
      this.minimapGfx.fillStyle(bot.color, 0.9);
      this.minimapGfx.fillCircle(wx(bot.x), wy(bot.y), 2.5);
    }

    // Local player — bright white with cyan ring to distinguish
    this.minimapGfx.fillStyle(0xffffff, 1);
    this.minimapGfx.fillCircle(wx(this.player.x), wy(this.player.y), 3);
    this.minimapGfx.lineStyle(1.5, 0x00ffff, 0.9);
    this.minimapGfx.strokeCircle(wx(this.player.x), wy(this.player.y), 5);

    // "MAP" label at top-left corner of minimap
    // (skipped — minimalist look is cleaner)
  }

  // ─── Leaderboard ───────────────────────────────────────────────────────────
  private drawLeaderboard() {
    const myName = getOrCreatePlayerName();
    type Entry = { label: string; mass: number; isLocal: boolean };
    const entries: Entry[] = [
      { label: myName, mass: this.player.mass, isLocal: true },
    ];
    if (this.net) {
      for (const [, rp] of this.net.otherPlayers) {
        if (rp.phase !== "alive") continue;
        entries.push({ label: rp.name, mass: rp.mass, isLocal: false });
      }
    }
    for (const bot of this.bots) {
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

  shutdown() {
    for (const lbl of this.nameLabels.values()) lbl.destroy();
    this.nameLabels.clear();
    for (const lbl of this.botNameLabels.values()) lbl.destroy();
    this.botNameLabels.clear();
    this.net?.disconnect();
    this.net = null;
  }

  private drawGrid() {
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

  changeScene() {
    this.scene.start("GameOver");
  }
}
