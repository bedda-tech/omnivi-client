import { GameObjects, Scene } from "phaser";
import { EventBus } from "../EventBus";
import { TIER_INFO, getStoredTier, setStoredTier } from "../NetworkManager";

const VI_PRICE_USD = 0.05; // demo price; matches Main.ts

export class MainMenu extends Scene {
  title!: GameObjects.Text;
  subtitle!: GameObjects.Text;
  playBtn!: GameObjects.Text;
  private starGfx!: GameObjects.Graphics;
  private stars: { x: number; y: number; r: number; speed: number }[] = [];
  private selectedTier: number = 0;
  private tierBtns: GameObjects.Text[] = [];
  private tierDescText!: GameObjects.Text;

  constructor() {
    super("MainMenu");
  }

  create() {
    const { width: W, height: H } = this.cameras.main;
    const cx = W / 2;
    const cy = H / 2;

    // Starfield background
    this.starGfx = this.add.graphics();
    this.stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.5 + 0.3,
      speed: Math.random() * 0.15 + 0.05,
    }));

    this.title = this.add
      .text(cx, cy - 150, "OMNIVI", {
        fontFamily: "Arial Black",
        fontSize: "64px",
        color: "#ffffff",
        stroke: "#0044ff",
        strokeThickness: 8,
        align: "center",
      })
      .setOrigin(0.5);

    this.subtitle = this.add
      .text(cx, cy - 78, "mass = money", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#8888ff",
        align: "center",
      })
      .setOrigin(0.5);

    // ── Tier selection ──────────────────────────────────────────────────────
    this.selectedTier = getStoredTier();

    this.add.text(cx, cy - 40, "Choose your buy-in:", {
      fontFamily: "Arial",
      fontSize: "14px",
      color: "#aaaaaa",
      align: "center",
    }).setOrigin(0.5);

    const tierColors  = ["#44aaff", "#00ff88", "#ffaa00"];  // Quick=blue, Std=green, HR=gold
    const tierSpacing = 130;
    const tierY = cy + 10;

    this.tierBtns = TIER_INFO.map((info, i) => {
      const bx = cx + (i - 1) * tierSpacing;
      const usd = (info.viCost * VI_PRICE_USD).toFixed(2);
      const label = `${info.label}\n${info.viCost} VI\n$${usd}`;
      const btn = this.add.text(bx, tierY, label, {
        fontFamily: "Arial Black",
        fontSize: "13px",
        color: tierColors[i],
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
        lineSpacing: 4,
      })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.selectTier(i))
        .on("pointerover", () => {
          if (this.selectedTier !== i) btn.setAlpha(0.8);
        })
        .on("pointerout", () => {
          if (this.selectedTier !== i) btn.setAlpha(0.5);
        });
      return btn;
    });

    this.tierDescText = this.add.text(cx, cy + 64, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#888888",
      align: "center",
    }).setOrigin(0.5);

    this.selectTier(this.selectedTier);  // apply highlight to initial tier

    // ── Play button ─────────────────────────────────────────────────────────
    this.playBtn = this.add
      .text(cx, cy + 100, "[ PLAY ]", {
        fontFamily: "Arial Black",
        fontSize: "32px",
        color: "#00ff88",
        stroke: "#000000",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.playBtn.setStyle({ color: "#ffffff" }))
      .on("pointerout", () => this.playBtn.setStyle({ color: "#00ff88" }))
      .on("pointerdown", () => this.changeScene());

    this.add
      .text(cx, cy + 150, "Mouse: aim & click to thrust\nWASD / Arrow keys: rotate & thrust", {
        fontFamily: "Arial",
        fontSize: "13px",
        color: "#555555",
        align: "center",
      })
      .setOrigin(0.5);

    // High score display
    const HS_KEY = "omnivi_highscore";
    const best = parseInt(localStorage.getItem(HS_KEY) ?? "0", 10);
    if (best > 0) {
      this.add
        .text(cx, cy + 195, `Best Score: ${best.toLocaleString()}`, {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#ffdd00",
          stroke: "#000000",
          strokeThickness: 2,
          align: "center",
        })
        .setOrigin(0.5);
    }

    EventBus.emit("current-scene-ready", this);
  }

  private selectTier(index: number) {
    this.selectedTier = index;
    setStoredTier(index);

    // Update button visual states
    const tierColors  = ["#44aaff", "#00ff88", "#ffaa00"];
    this.tierBtns.forEach((btn, i) => {
      if (i === index) {
        btn.setAlpha(1.0).setStyle({ fontSize: "14px" });
      } else {
        btn.setAlpha(0.45).setStyle({ fontSize: "13px" });
      }
    });

    // Description line below buttons
    const info = TIER_INFO[index];
    const usd = (info.viCost * VI_PRICE_USD).toFixed(2);
    const massStart = info.viCost * info.massPerToken;
    const color = tierColors[index];
    this.tierDescText
      .setText(`Starting mass: ${massStart}  ·  Buy-in: ${info.viCost} VI ($${usd})  ·  Top-3 bonus up to ×1.5`)
      .setColor(color);
  }

  update() {
    // Slowly drift stars downward for parallax effect
    this.starGfx.clear();
    for (const s of this.stars) {
      s.y += s.speed;
      if (s.y > this.cameras.main.height) s.y = 0;
      const alpha = 0.4 + s.r * 0.3;
      this.starGfx.fillStyle(0xffffff, alpha);
      this.starGfx.fillCircle(s.x, s.y, s.r);
    }
  }

  changeScene() {
    this.scene.start("Main");
  }
}
