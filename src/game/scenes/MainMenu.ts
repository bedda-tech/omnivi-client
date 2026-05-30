import { GameObjects, Scene } from "phaser";
import { EventBus } from "../EventBus";
import { TIER_INFO, getStoredTier, setStoredTier, getViBalance } from "../NetworkManager";

// Mass IS VI — no dollar conversion

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

export class MainMenu extends Scene {
  title!: GameObjects.Text;
  subtitle!: GameObjects.Text;
  playBtn!: GameObjects.Text;
  practiceBtn!: GameObjects.Text;
  private starGfx!: GameObjects.Graphics;
  private nebulaGfx!: GameObjects.Graphics;
  private tierGfx!: GameObjects.Graphics;
  private debrisGfx!: GameObjects.Graphics;
  private stars: Star[] = [];
  private debris: OrbitalDebris[] = [];
  private selectedTier: number = 0;
  private tierBtns: GameObjects.Text[] = [];
  private tierDescText!: GameObjects.Text;
  declare private _walletText: GameObjects.Text;
  private t: number = 0;
  private lbGfx: GameObjects.Graphics | null = null;

  // Nebula config: [cx_frac, cy_frac, r, color, alpha]
  private readonly NEBULAE: [number, number, number, number, number][] = [
    [0.15, 0.25, 220, 0x2200aa, 0.045],
    [0.80, 0.70, 190, 0x001188, 0.040],
    [0.50, 0.10, 170, 0x550055, 0.035],
    [0.70, 0.20, 250, 0x001155, 0.030],
    [0.25, 0.75, 200, 0x220033, 0.038],
    [0.90, 0.45, 150, 0x003322, 0.030],
  ];

  constructor() {
    super("MainMenu");
  }

  create() {
    const { width: W, height: H } = this.cameras.main;
    const cx = W / 2;
    const cy = H / 2;

    // ── Static nebula layer (drawn once, no per-frame update) ────────────────
    this.nebulaGfx = this.add.graphics().setDepth(0);
    for (const [fx, fy, r, color, alpha] of this.NEBULAE) {
      // Multi-ring gradient simulation: several concentric circles decreasing alpha
      for (let ring = 0; ring < 5; ring++) {
        const ringR = r * (1 - ring * 0.18);
        const ringA = alpha * (1 - ring * 0.15);
        this.nebulaGfx.fillStyle(color, ringA);
        this.nebulaGfx.fillCircle(fx * W, fy * H, ringR);
      }
    }

    // ── Star field ────────────────────────────────────────────────────────────
    this.starGfx = this.add.graphics().setDepth(1);
    const STAR_COLORS = [0xffffff, 0xffffff, 0xffffff, 0xaaddff, 0xbbbbff, 0xffddaa, 0xccbbff];
    this.stars = Array.from({ length: 180 }, () => ({
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
      { x: cx - 340, y: cy - 120 },
      { x: cx + 310, y: cy + 90 },
      { x: cx - 180, y: cy + 200 },
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

    // ── Background separator line ─────────────────────────────────────────────
    const sepGfx = this.add.graphics().setDepth(3);
    sepGfx.lineStyle(1, 0x1133aa, 0.35);
    sepGfx.lineBetween(cx - 280, cy - 105, cx + 280, cy - 105);
    sepGfx.lineStyle(1, 0x1133aa, 0.20);
    sepGfx.lineBetween(cx - 240, cy + 80, cx + 240, cy + 80);
    sepGfx.lineStyle(1, 0x1133aa, 0.20);
    sepGfx.lineBetween(cx - 240, cy + 125, cx + 240, cy + 125);

    // ── Title ─────────────────────────────────────────────────────────────────
    this.title = this.add
      .text(cx, cy - 145, "OMNIVI", {
        fontFamily: '"Arial Black", Gadget, sans-serif',
        fontSize: "76px",
        color: "#00eeff",
        stroke: "#0033cc",
        strokeThickness: 10,
        shadow: { offsetX: 0, offsetY: 0, color: "#00ccff", blur: 24, stroke: true, fill: true },
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.subtitle = this.add
      .text(cx, cy - 78, "mass  =  money", {
        fontFamily: "monospace",
        fontSize: "17px",
        color: "#6677ff",
        letterSpacing: 4,
        align: "center",
        shadow: { offsetX: 0, offsetY: 0, color: "#3344cc", blur: 8, fill: true },
      })
      .setOrigin(0.5)
      .setDepth(10);

    // ── Tier selection ────────────────────────────────────────────────────────
    this.selectedTier = getStoredTier();
    this.tierGfx = this.add.graphics().setDepth(9);

    this.add.text(cx, cy - 36, "SELECT BUY-IN TIER", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#445566",
      letterSpacing: 2,
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    const TIER_COLORS_S: string[] = ["#44aaff", "#00ff88", "#ffaa00"];
    const tierSpacing = 138;
    const tierY = cy + 16;

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
        .on("pointerover", () => {
          if (this.selectedTier !== i) btn.setAlpha(0.75);
        })
        .on("pointerout", () => {
          if (this.selectedTier !== i) btn.setAlpha(0.45);
        });
      return btn;
    });

    this.tierDescText = this.add.text(cx, cy + 94, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#556677",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    this.selectTier(this.selectedTier);

    // ── Play button ───────────────────────────────────────────────────────────
    this.playBtn = this.add
      .text(cx, cy + 139, "▶  ENTER THE ARENA", {
        fontFamily: '"Arial Black", Gadget, sans-serif',
        fontSize: "24px",
        color: "#00ff88",
        stroke: "#003322",
        strokeThickness: 5,
        shadow: { offsetX: 0, offsetY: 0, color: "#00ff88", blur: 16, stroke: true, fill: true },
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        this.playBtn.setStyle({ color: "#ffffff" });
        this.playBtn.setShadow(0, 0, "#00ff88", 26, true, true);
      })
      .on("pointerout", () => {
        this.playBtn.setStyle({ color: "#00ff88" });
        this.playBtn.setShadow(0, 0, "#00ff88", 16, true, true);
      })
      .on("pointerdown", () => this.changeScene());

    // ── Practice mode button ──────────────────────────────────────────────────
    this.practiceBtn = this.add
      .text(cx, cy + 170, "◇  FREE PLAY", {
        fontFamily: '"Arial Black", Gadget, sans-serif',
        fontSize: "15px",
        color: "#00ccaa",
        stroke: "#002211",
        strokeThickness: 3,
        shadow: { offsetX: 0, offsetY: 0, color: "#00ccaa", blur: 10, stroke: true, fill: true },
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        this.practiceBtn.setStyle({ color: "#ffffff" });
        this.practiceBtn.setShadow(0, 0, "#00ccaa", 18, true, true);
      })
      .on("pointerout", () => {
        this.practiceBtn.setStyle({ color: "#00ccaa" });
        this.practiceBtn.setShadow(0, 0, "#00ccaa", 10, true, true);
      })
      .on("pointerdown", () => {
        history.replaceState(null, "", "?mode=practice");
        this.scene.start("Lobby");
      });

    // ── Controls hint ─────────────────────────────────────────────────────────
    this.add
      .text(cx, cy + 195, "mouse · click thrust    WASD / arrows · rotate", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#334455",
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(10);

    // Score removed — VI is the only metric that matters

    // ── Corner decoration: version ────────────────────────────────────────────
    this.add.text(W - 10, H - 10, "α0.1", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#223344",
      align: "right",
    }).setOrigin(1, 1).setDepth(10);

    // ── Wallet balance (top-right) ────────────────────────────────────────────
    const balance = getViBalance();
    this._walletText = this.add.text(W - 12, 12, `◈ ${balance.toLocaleString()} VI`, {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#00ccaa",
      align: "right",
      shadow: { offsetX: 0, offsetY: 0, color: "#00aa88", blur: 6, fill: true },
    }).setOrigin(1, 0).setDepth(10);

    this.fetchLeaderboard();

    EventBus.emit("current-scene-ready", this);
  }

  private selectTier(index: number) {
    this.selectedTier = index;
    setStoredTier(index);

    const { width: W, height: H } = this.cameras.main;
    const cx = W / 2;
    const cy = H / 2;
    const tierSpacing = 138;
    const tierY = cy + 16;
    const CARD_W = 120;
    const CARD_H = 68;
    const TIER_COLORS: number[] = [0x44aaff, 0x00ff88, 0xffaa00];
    const TIER_COLORS_S: string[] = ["#44aaff", "#00ff88", "#ffaa00"];

    const balance = getViBalance();
    this.tierGfx.clear();

    this.tierBtns.forEach((btn, i) => {
      const bx = cx + (i - 1) * tierSpacing;
      const canAfford = balance >= TIER_INFO[i].viCost;
      if (i === index) {
        // Selected card: glowing border + filled bg
        this.tierGfx.fillStyle(TIER_COLORS[i], 0.12);
        this.tierGfx.fillRoundedRect(bx - CARD_W / 2, tierY - CARD_H / 2, CARD_W, CARD_H, 8);
        this.tierGfx.lineStyle(2, TIER_COLORS[i], 0.9);
        this.tierGfx.strokeRoundedRect(bx - CARD_W / 2, tierY - CARD_H / 2, CARD_W, CARD_H, 8);
        // Outer glow ring
        this.tierGfx.lineStyle(4, TIER_COLORS[i], 0.22);
        this.tierGfx.strokeRoundedRect(bx - CARD_W / 2 - 3, tierY - CARD_H / 2 - 3, CARD_W + 6, CARD_H + 6, 10);
        btn.setAlpha(1.0).setStyle({ fontSize: "13px" });
      } else {
        // Unselected card: dim border
        this.tierGfx.fillStyle(0x000000, 0.0);
        this.tierGfx.lineStyle(1, canAfford ? TIER_COLORS[i] : 0x663333, canAfford ? 0.25 : 0.50);
        this.tierGfx.strokeRoundedRect(bx - CARD_W / 2, tierY - CARD_H / 2, CARD_W, CARD_H, 8);
        btn.setAlpha(canAfford ? 0.45 : 0.25).setStyle({ fontSize: "12px" });
      }
      // "LOW FUNDS" overlay for unaffordable tiers
      if (!canAfford) {
        this.tierGfx.fillStyle(0xff2222, 0.08);
        this.tierGfx.fillRoundedRect(bx - CARD_W / 2, tierY - CARD_H / 2, CARD_W, CARD_H, 8);
        this.tierGfx.lineStyle(1, 0xff3333, 0.35);
        this.tierGfx.lineBetween(bx - CARD_W / 2 + 8, tierY + CARD_H / 2 + 10, bx + CARD_W / 2 - 8, tierY + CARD_H / 2 + 10);
      }
    });

    // Play button background card — red tint if can't afford selected tier
    const btnCY = cy + 139;
    const btnW = 310;
    const btnH = 44;
    const canAffordSelected = balance >= TIER_INFO[index].viCost;
    this.tierGfx.fillStyle(canAffordSelected ? 0x003322 : 0x220000, 0.35);
    this.tierGfx.fillRoundedRect(cx - btnW / 2, btnCY - btnH / 2, btnW, btnH, 10);
    this.tierGfx.lineStyle(2, canAffordSelected ? 0x00ff88 : 0xff3333, 0.45);
    this.tierGfx.strokeRoundedRect(cx - btnW / 2, btnCY - btnH / 2, btnW, btnH, 10);

    const info = TIER_INFO[index];
    const descSuffix = canAffordSelected ? "  ·  top-3 earns up to x1.5" : "  ·  INSUFFICIENT FUNDS";
    this.tierDescText
      .setText(`start ${info.viCost} VI${descSuffix}`)
      .setColor(canAffordSelected ? TIER_COLORS_S[index] : "#ff4444");
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
      this.debrisGfx.fillStyle(0x8899bb, 0.35);
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

    // ── Title pulse ───────────────────────────────────────────────────────────
    const pulse = 0.82 + 0.18 * Math.sin(this.t * 1.6);
    // Cycle hue between cyan and electric blue for title
    const hueT = (Math.sin(this.t * 0.5) + 1) / 2;
    const r = Math.round(0 + hueT * 44);
    const g = Math.round(200 + hueT * 30);
    const b = Math.round(255);
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    this.title.setColor(hex);
    this.title.setShadow(0, 0, hex, 18 + pulse * 14, true, true);
    this.title.setAlpha(0.88 + 0.12 * pulse);

    // ── Play button pulse ─────────────────────────────────────────────────────
    const playPulse = 0.85 + 0.15 * Math.sin(this.t * 2.2);
    this.playBtn.setScale(0.97 + 0.03 * playPulse);
  }

  changeScene() {
    this.scene.start("Main");
  }

  private async fetchLeaderboard(): Promise<void> {
    const wsUrl: string = (import.meta as any).env?.VITE_SERVER_URL ?? "ws://localhost:8000";
    const httpUrl = wsUrl.replace(/^ws(s?):\/\//, "http$1://");

    interface LBEntry { wallet: string; name: string; mass: number; timestamp: number; }
    let entries: LBEntry[];
    try {
      const resp = await fetch(`${httpUrl}/leaderboard`);
      if (!resp.ok) return;
      entries = await resp.json() as LBEntry[];
    } catch {
      return;
    }

    if (!this.sys.isActive() || !entries || entries.length === 0) return;

    const { width: W, height: H } = this.cameras.main;
    const PANEL_W = 215;
    const rowCount = Math.min(entries.length, 8);
    const PANEL_H = 26 + rowCount * 18 + 8;
    const panelX = W - 14 - PANEL_W;
    const panelY = H - 14 - PANEL_H;

    this.lbGfx = this.add.graphics().setDepth(10);
    this.lbGfx.fillStyle(0x000d1a, 0.78);
    this.lbGfx.fillRoundedRect(panelX, panelY, PANEL_W, PANEL_H, 6);
    this.lbGfx.lineStyle(1, 0x00ccaa, 0.45);
    this.lbGfx.strokeRoundedRect(panelX, panelY, PANEL_W, PANEL_H, 6);

    this.add.text(panelX + PANEL_W / 2, panelY + 7, "TOP ESCAPEES", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#00ccaa",
      letterSpacing: 2,
      align: "center",
    }).setOrigin(0.5, 0).setDepth(11);

    const RANK_COLORS = ["#ffdd44", "#aaaaaa", "#cc8844"];
    entries.slice(0, 8).forEach((entry, i) => {
      const rowY = panelY + 23 + i * 18;
      const rankColor = i < 3 ? RANK_COLORS[i] : "#445566";
      const displayName = (entry.name || entry.wallet).slice(0, 13);
      const massStr = Math.floor(entry.mass).toLocaleString();

      this.add.text(panelX + 7, rowY, `${i + 1}`, {
        fontFamily: "monospace", fontSize: "10px", color: rankColor,
      }).setDepth(11);

      this.add.text(panelX + 22, rowY, displayName, {
        fontFamily: "monospace", fontSize: "10px", color: "#8899aa",
      }).setDepth(11);

      this.add.text(panelX + PANEL_W - 7, rowY, massStr, {
        fontFamily: "monospace", fontSize: "10px", color: "#44eeaa", align: "right",
      }).setOrigin(1, 0).setDepth(11);
    });
  }
}
