import { Scene, GameObjects } from "phaser";
import { EventBus } from "../EventBus";
import {
  NetworkManager,
  getOrCreatePlayerName,
  setStoredName,
  getStoredTier,
  setStoredTier,
  TIER_INFO,
  LobbyState,
  getViBalance,
} from "../NetworkManager";
import { connectWallet, approveAndStake } from "../blockchain/ClaimClient";

// Mass IS VI — no dollar conversion
const ELO_KEY = "omnivi_elo";

function getStoredElo(): number {
  return parseInt(localStorage.getItem(ELO_KEY) ?? "1000", 10);
}

interface Star {
  x: number; y: number; r: number; speed: number;
  color: number; alpha: number; twinklePhase: number; twinkleSpeed: number;
}

interface OrbitalDebris {
  x: number; y: number; size: number;
  orbitRadius: number; orbitAngle: number; orbitSpeed: number;
  orbitCX: number; orbitCY: number;
  vertices: number;
}

export class Lobby extends Scene {
  private net: NetworkManager | null = null;
  private selectedTier: number = 1;
  private walletAddress: string = "";
  private walletStatusText!: GameObjects.Text;
  private practiceMode: boolean = false;

  // Background layers
  private starGfx!: GameObjects.Graphics;
  private nebulaGfx!: GameObjects.Graphics;
  private debrisGfx!: GameObjects.Graphics;
  private tierGfx!: GameObjects.Graphics;
  private stars: Star[] = [];
  private debris: OrbitalDebris[] = [];
  private t: number = 0;

  // UI elements
  private titleText!: GameObjects.Text;
  private nameText!: GameObjects.Text;
  private statusText!: GameObjects.Text;
  private playersOnlineText!: GameObjects.Text;
  private countdownText!: GameObjects.Text;
  private playerListText!: GameObjects.Text;
  private tierBtns: GameObjects.Text[] = [];
  private tierDescText!: GameObjects.Text;
  private cancelText!: GameObjects.Text;
  private tryAgainBtn: GameObjects.Text | null = null;
  private waitDots: number = 0;
  private waitDotTimer: number = 0;
  private statsTimer: Phaser.Time.TimerEvent | null = null;

  // Lobby state
  private lobbyPhase: string = "lobby";
  private lobbyCountdown: number = 0;
  private lobbyPlayerCount: number = 0;
  private roundStarting: boolean = false;

  private readonly NEBULAE: [number, number, number, number, number][] = [
    [0.15, 0.25, 220, 0x2200aa, 0.040],
    [0.80, 0.70, 190, 0x001188, 0.035],
    [0.50, 0.10, 170, 0x550055, 0.030],
    [0.70, 0.20, 250, 0x001155, 0.025],
    [0.25, 0.75, 200, 0x220033, 0.033],
    [0.90, 0.45, 150, 0x003322, 0.025],
  ];

  constructor() {
    super("Lobby");
  }

  create() {
    const { width: W, height: H } = this.cameras.main;
    const cx = W / 2;
    const cy = H / 2;

    this.selectedTier = getStoredTier();
    this.practiceMode = new URLSearchParams(window.location.search).get("mode") === "practice";

    // ── Static nebula layer ───────────────────────────────────────────────────
    this.nebulaGfx = this.add.graphics().setDepth(0);
    for (const [fx, fy, r, color, alpha] of this.NEBULAE) {
      for (let ring = 0; ring < 5; ring++) {
        const ringR = r * (1 - ring * 0.18);
        const ringA = alpha * (1 - ring * 0.15);
        this.nebulaGfx.fillStyle(color, ringA);
        this.nebulaGfx.fillCircle(fx * W, fy * H, ringR);
      }
    }

    // ── Colored star field ────────────────────────────────────────────────────
    this.starGfx = this.add.graphics().setDepth(1);
    const STAR_COLORS = [0xffffff, 0xffffff, 0xffffff, 0xaaddff, 0xbbbbff, 0xffddaa, 0xccbbff];
    this.stars = Array.from({ length: 160 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.8 + 0.25,
      speed: Math.random() * 0.08 + 0.02,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      alpha: 0.3 + Math.random() * 0.55,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.6 + Math.random() * 1.4,
    }));

    // ── Orbital debris ────────────────────────────────────────────────────────
    this.debrisGfx = this.add.graphics().setDepth(2);
    const debrisAnchors = [
      { x: cx - 320, y: cy - 100 },
      { x: cx + 290, y: cy + 110 },
      { x: cx - 160, y: cy + 190 },
    ];
    this.debris = debrisAnchors.flatMap((anchor) =>
      Array.from({ length: 3 }, (_, j) => ({
        x: 0, y: 0,
        size: 3 + Math.random() * 5,
        orbitRadius: 28 + j * 18 + Math.random() * 10,
        orbitAngle: Math.random() * Math.PI * 2,
        orbitSpeed: (0.006 + Math.random() * 0.008) * (Math.random() < 0.5 ? 1 : -1),
        orbitCX: anchor.x,
        orbitCY: anchor.y,
        vertices: 5 + Math.floor(Math.random() * 4),
      }))
    );

    // ── Title ─────────────────────────────────────────────────────────────────
    this.titleText = this.add.text(cx, 52, "OMNIVI", {
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSize: "66px",
      color: "#00eeff",
      stroke: "#0033cc",
      strokeThickness: 9,
      shadow: { offsetX: 0, offsetY: 0, color: "#00ccff", blur: 22, stroke: true, fill: true },
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    this.add.text(cx, 110, "L O B B Y", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#334488",
      letterSpacing: 8,
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    if (this.practiceMode) {
      this.add.text(cx, 128, "PRACTICE — no crypto required", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#ffaa00",
        stroke: "#000000",
        strokeThickness: 2,
        align: "center",
        shadow: { offsetX: 0, offsetY: 0, color: "#ff8800", blur: 8, fill: true },
      }).setOrigin(0.5).setDepth(10);
    }

    // ── Separator ─────────────────────────────────────────────────────────────
    const sepGfx = this.add.graphics().setDepth(3);
    sepGfx.lineStyle(1, 0x1133aa, 0.30);
    sepGfx.lineBetween(cx - 280, 130, cx + 280, 130);

    // ── ELO display ───────────────────────────────────────────────────────────
    const elo = getStoredElo();
    this.add.text(cx, 152, `ELO: ${elo}`, {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#4466aa",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    // ── VI balance display ─────────────────────────────────────────────────────
    const bal = getViBalance();
    this.add.text(cx, 172, `BALANCE:  ${bal.toLocaleString()} VI`, {
      fontFamily: "monospace",
      fontSize: "13px",
      color: bal >= TIER_INFO[0].viCost ? "#00ffcc" : "#ff4444",
      stroke: "#000000",
      strokeThickness: 1,
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    // ── On-chain wallet status ────────────────────────────────────────────────
    this.walletStatusText = this.add.text(cx, 192, this.practiceMode ? "CHAIN: not required" : "CHAIN: checking...", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: this.practiceMode ? "#ffaa00" : "#334455",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    if (!this.practiceMode) {
      connectWallet().then((addr) => {
        this.walletAddress = addr;
        if (addr) {
          this.walletStatusText.setText(`CHAIN: ${addr.slice(0, 6)}…${addr.slice(-4)}`).setColor("#7755aa");
        } else {
          this.walletStatusText.setText("CHAIN: no MetaMask").setColor("#334455");
        }
      });
    }

    // ── Player name (click to edit) ───────────────────────────────────────────
    const currentName = getOrCreatePlayerName();
    this.nameText = this.add.text(cx, 218, `PILOT: ${currentName}  [edit]`, {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#4488aa",
      align: "center",
    })
      .setOrigin(0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.nameText.setColor("#88ccee"))
      .on("pointerout",  () => this.nameText.setColor("#4488aa"))
      .on("pointerdown", () => this.editPlayerName());

    // ── Tier selection label ───────────────────────────────────────────────────
    this.add.text(cx, cy - 85, "SELECT BUY-IN TIER", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#445566",
      letterSpacing: 2,
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    this.tierGfx = this.add.graphics().setDepth(9);
    const TIER_COLORS_S: string[] = ["#44aaff", "#00ff88", "#ffaa00"];
    const tierSpacing = 138;
    const tierY = cy - 32;

    this.tierBtns = TIER_INFO.map((info, i) => {
      const bx = cx + (i - 1) * tierSpacing;
      const label = `${info.label}\n${info.viCost} VI`;
      const btn = this.add.text(bx, tierY, label, {
        fontFamily: '"Arial Black", Gadget, sans-serif',
        fontSize: "12px",
        color: TIER_COLORS_S[i],
        stroke: "#000000",
        strokeThickness: 2,
        align: "center",
        lineSpacing: 6,
      })
        .setOrigin(0.5)
        .setDepth(11)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.selectTier(i))
        .on("pointerover", () => { if (this.selectedTier !== i) btn.setAlpha(0.75); })
        .on("pointerout",  () => { if (this.selectedTier !== i) btn.setAlpha(0.45); });
      return btn;
    });

    this.tierDescText = this.add.text(cx, cy + 55, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#556677",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    this.selectTier(this.selectedTier);

    // ── Separator ─────────────────────────────────────────────────────────────
    sepGfx.lineStyle(1, 0x1133aa, 0.20);
    sepGfx.lineBetween(cx - 220, cy + 74, cx + 220, cy + 74);

    // ── Status / countdown ────────────────────────────────────────────────────
    this.statusText = this.add.text(cx, cy + 96, "Connecting...", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#556677",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    this.playersOnlineText = this.add.text(cx, cy + 118, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#334455",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    void this._fetchStats();
    this.statsTimer = this.time.addEvent({ delay: 5000, loop: true, callback: this._fetchStats, callbackScope: this });

    this.countdownText = this.add.text(cx, cy + 142, "", {
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSize: "52px",
      color: "#00ff88",
      stroke: "#003322",
      strokeThickness: 5,
      shadow: { offsetX: 0, offsetY: 0, color: "#00ff88", blur: 18, stroke: true, fill: true },
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    this.tryAgainBtn = this.add.text(cx, cy + 136, "▷  TRY AGAIN", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#ffaa00",
      stroke: "#000000",
      strokeThickness: 2,
      align: "center",
      shadow: { offsetX: 0, offsetY: 0, color: "#ff8800", blur: 8, fill: true },
    })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.tryAgainBtn?.setColor("#ffffff"))
      .on("pointerout",  () => this.tryAgainBtn?.setColor("#ffaa00"))
      .on("pointerdown", () => {
        if (this.roundStarting) return;
        this.roundStarting = true;
        this.tryAgainBtn?.setVisible(false);
        void this._enterRound();
      });

    this.playerListText = this.add.text(cx, cy + 196, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#3d5a7a",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    // ── Cancel button ─────────────────────────────────────────────────────────
    this.cancelText = this.add.text(cx, H - 30, "[ ESC ]  Back to menu", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#2a3a4a",
      align: "center",
    })
      .setOrigin(0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.cancelText.setColor("#8899bb"))
      .on("pointerout",  () => this.cancelText.setColor("#2a3a4a"))
      .on("pointerdown", () => this.cancelLobby());

    // ── Version ───────────────────────────────────────────────────────────────
    this.add.text(W - 10, H - 10, "α0.1", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#1a2a3a",
    }).setOrigin(1, 1).setDepth(10);

    this.input.keyboard!.on("keydown-ESC", () => this.cancelLobby());

    this.connectToServer();
    EventBus.emit("current-scene-ready", this);
  }

  private async connectToServer(): Promise<void> {
    const name = getOrCreatePlayerName();
    const elo  = getStoredElo();

    this.net = new NetworkManager();

    this.net.onLobbyState((state: LobbyState) => {
      this.lobbyPhase       = state.phase;
      this.lobbyCountdown   = state.lobbyCountdown;
      this.lobbyPlayerCount = state.playerCount;
      this.updateLobbyUI();
    });

    this.net.onRoundStarted(() => {
      if (this.roundStarting) return;
      this.roundStarting = true;
      this.statusText.setText("ROUND STARTING!").setColor("#00ff88");
      this.countdownText.setVisible(false);
      void this._enterRound();
    });

    try {
      await this.net.connect(name, this.selectedTier, elo, this.practiceMode);
      this.statusText.setText("Waiting for players...");
    } catch (err) {
      console.error("[Lobby] Connect failed:", err);
      this.statusText.setText("Connection failed. Playing solo.");
      this.net = null;
      this.time.delayedCall(1200, () => {
        this.scene.start("Main", { net: null, tier: this.selectedTier, practiceMode: this.practiceMode });
      });
    }
  }

  private async _enterRound(): Promise<void> {
    this.tryAgainBtn?.setVisible(false);
    // Attempt on-chain stake when contracts are configured and wallet is connected
    const vaultAddr: string = (import.meta as any).env?.VITE_GAME_VAULT_ADDRESS ?? "";
    let stakeTxHash = "";
    if (!this.practiceMode && this.walletAddress && vaultAddr) {
      this.statusText.setText("Step 1/2: Approving VI tokens... (check MetaMask)").setColor("#ffaa00");
      try {
        stakeTxHash = await approveAndStake(this.selectedTier, (step) => {
          if (step === 2) this.statusText.setText("Step 2/2: Staking... (check MetaMask)").setColor("#ffaa00");
        });
        this.statusText.setText("Staked! Entering round...").setColor("#00ff88");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Lobby] Stake failed:", msg);
        // Hard-fail: reset so player knows they didn't stake
        this.statusText.setText(`Stake failed — ${msg.slice(0, 60)}`).setColor("#ff4444");
        this.roundStarting = false;
        this.tryAgainBtn?.setVisible(true);
        return;
      }
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    // Disconnect lobby connection — Main will open its own fresh connection
    this.net?.disconnect();
    this.net = null;
    this.scene.start("Main", { tier: this.selectedTier, walletAddress: this.walletAddress, practiceMode: this.practiceMode, stakeTxHash });
  }

  private updateLobbyUI(): void {
    if (this.roundStarting) return;

    if (this.lobbyPhase === "ended") {
      this.statusText.setText("Round ended. Next round starting soon...").setColor("#ffaa00");
      this.countdownText.setVisible(true).setText(`${Math.ceil(this.lobbyCountdown)}s`).setColor("#ffaa00");
      return;
    }

    if (this.lobbyPhase === "playing" || this.lobbyPhase === "shrinking") {
      this.statusText.setText("Round in progress. Joining next round...").setColor("#ffdd00");
      this.countdownText.setVisible(false);
      return;
    }

    const count = this.lobbyPlayerCount;
    if (count < 2) {
      this.statusText.setText(`Waiting for pilots... (${count}/2)`).setColor("#445566");
      this.countdownText.setVisible(false);
    } else {
      this.statusText.setText("Round starting!").setColor("#00ffaa");
      const secs = Math.ceil(this.lobbyCountdown);
      this.countdownText
        .setVisible(true)
        .setText(`${secs}`)
        .setColor(secs <= 5 ? "#ff4400" : "#00ff88");
    }

    const playersLine = count === 1 ? "1 pilot ready" : `${count} pilots ready`;
    this.playerListText.setText(playersLine);
  }

  private selectTier(index: number): void {
    this.selectedTier = index;
    setStoredTier(index);

    const { width: W } = this.cameras.main;
    const cx = W / 2;
    const tierSpacing = 138;
    const tierY = this.cameras.main.height / 2 - 32;
    const CARD_W = 120;
    const CARD_H = 68;
    const TIER_COLORS: number[] = [0x44aaff, 0x00ff88, 0xffaa00];
    const TIER_COLORS_S: string[] = ["#44aaff", "#00ff88", "#ffaa00"];

    this.tierGfx.clear();

    const balance = getViBalance();
    this.tierBtns.forEach((btn, i) => {
      const bx = cx + (i - 1) * tierSpacing;
      const canAfford = balance >= TIER_INFO[i].viCost;
      if (i === index) {
        this.tierGfx.fillStyle(TIER_COLORS[i], canAfford ? 0.12 : 0.06);
        this.tierGfx.fillRoundedRect(bx - CARD_W / 2, tierY - CARD_H / 2, CARD_W, CARD_H, 8);
        this.tierGfx.lineStyle(2, canAfford ? TIER_COLORS[i] : 0x444444, canAfford ? 0.9 : 0.4);
        this.tierGfx.strokeRoundedRect(bx - CARD_W / 2, tierY - CARD_H / 2, CARD_W, CARD_H, 8);
        if (canAfford) {
          this.tierGfx.lineStyle(4, TIER_COLORS[i], 0.22);
          this.tierGfx.strokeRoundedRect(bx - CARD_W / 2 - 3, tierY - CARD_H / 2 - 3, CARD_W + 6, CARD_H + 6, 10);
        }
        btn.setAlpha(canAfford ? 1.0 : 0.4).setStyle({ fontSize: "13px" });
      } else {
        this.tierGfx.lineStyle(1, canAfford ? TIER_COLORS[i] : 0x333333, canAfford ? 0.25 : 0.15);
        this.tierGfx.strokeRoundedRect(bx - CARD_W / 2, tierY - CARD_H / 2, CARD_W, CARD_H, 8);
        btn.setAlpha(canAfford ? 0.45 : 0.2).setStyle({ fontSize: "12px" });
      }
    });

    const info = TIER_INFO[index];
    const canAffordSelected = balance >= info.viCost;
    const remaining = balance - info.viCost;
    const descLine = canAffordSelected
      ? `stake ${info.viCost.toLocaleString()} VI  ·  ${remaining.toLocaleString()} remaining  ·  top-3 earns x1.5`
      : `INSUFFICIENT VI  ·  need ${(info.viCost - balance).toLocaleString()} more`;
    this.tierDescText
      .setText(descLine)
      .setColor(canAffordSelected ? TIER_COLORS_S[index] : "#ff4444");
  }

  private editPlayerName(): void {
    const current = getOrCreatePlayerName();
    const input = window.prompt("Enter your pilot name (max 20 chars):", current);
    if (input === null) return;
    const trimmed = input.trim().slice(0, 20);
    if (!trimmed) return;
    setStoredName(trimmed);
    this.nameText.setText(`PILOT: ${trimmed}  [edit]`);
  }

  private async _fetchStats(): Promise<void> {
    const serverBase = (import.meta as any).env?.VITE_SERVER_URL
      ?.replace("ws://", "http://").replace("wss://", "https://")
      ?? "http://localhost:8000";
    try {
      const res = await fetch(`${serverBase}/stats`);
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.activePlayers === "number" && this.sys.isActive()) {
        const n = data.activePlayers;
        this.playersOnlineText.setText(n === 1 ? "1 player online" : `${n} players online`).setColor("#445566");
      }
    } catch {
      // silently ignore — transient network errors
    }
  }

  private cancelLobby(): void {
    this.net?.disconnect();
    this.net = null;
    this.scene.start("MainMenu");
  }

  update(_time: number, delta: number) {
    this.t += delta * 0.001;

    const { height: H } = this.cameras.main;

    // ── Stars ─────────────────────────────────────────────────────────────────
    this.starGfx.clear();
    for (const s of this.stars) {
      s.y += s.speed;
      if (s.y > H) s.y = 0;
      const twinkle = 0.75 + 0.25 * Math.sin(this.t * s.twinkleSpeed + s.twinklePhase);
      this.starGfx.fillStyle(s.color, s.alpha * twinkle);
      this.starGfx.fillCircle(s.x, s.y, s.r);
    }

    // ── Orbital debris ────────────────────────────────────────────────────────
    this.debrisGfx.clear();
    for (const d of this.debris) {
      d.orbitAngle += d.orbitSpeed;
      const px = d.orbitCX + Math.cos(d.orbitAngle) * d.orbitRadius;
      const py = d.orbitCY + Math.sin(d.orbitAngle) * d.orbitRadius;
      const spin = d.orbitAngle * 2.3;
      this.debrisGfx.fillStyle(0x8899bb, 0.30);
      this.debrisGfx.beginPath();
      for (let v = 0; v < d.vertices; v++) {
        const ang = spin + (v / d.vertices) * Math.PI * 2;
        const r = d.size * (0.7 + 0.3 * Math.sin(ang * 1.7));
        if (v === 0) this.debrisGfx.moveTo(px + Math.cos(ang) * r, py + Math.sin(ang) * r);
        else this.debrisGfx.lineTo(px + Math.cos(ang) * r, py + Math.sin(ang) * r);
      }
      this.debrisGfx.closePath();
      this.debrisGfx.fillPath();
    }

    // ── Title pulse (cyan ↔ electric blue) ───────────────────────────────────
    const hueT = (Math.sin(this.t * 0.5) + 1) / 2;
    const r = Math.round(0 + hueT * 44);
    const g = Math.round(200 + hueT * 30);
    const b = 255;
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    const pulse = 0.82 + 0.18 * Math.sin(this.t * 1.6);
    this.titleText.setColor(hex);
    this.titleText.setShadow(0, 0, hex, 18 + pulse * 12, true, true);
    this.titleText.setAlpha(0.88 + 0.12 * pulse);

    // ── Waiting dots animation ────────────────────────────────────────────────
    this.waitDotTimer += delta;
    if (this.waitDotTimer >= 420) {
      this.waitDotTimer = 0;
      this.waitDots = (this.waitDots + 1) % 4;
      const statusStr = this.statusText.text.replace(/\.+$/, "");
      const isWaiting = statusStr.includes("Waiting") || statusStr.includes("Connecting");
      if (isWaiting) {
        this.statusText.setText(statusStr + ".".repeat(this.waitDots));
      }
    }
  }

  shutdown() {
    this.statsTimer?.remove();
    this.statsTimer = null;
    if (!this.roundStarting) {
      this.net?.disconnect();
      this.net = null;
    }
    this.input.keyboard?.off("keydown-ESC");
  }
}
