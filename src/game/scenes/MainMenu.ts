import { GameObjects, Scene } from "phaser";
import { EventBus } from "../EventBus";

export class MainMenu extends Scene {
  title!: GameObjects.Text;
  subtitle!: GameObjects.Text;
  playBtn!: GameObjects.Text;
  private starGfx!: GameObjects.Graphics;
  private stars: { x: number; y: number; r: number; speed: number }[] = [];

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
      .text(cx, cy - 110, "OMNIVI", {
        fontFamily: "Arial Black",
        fontSize: "64px",
        color: "#ffffff",
        stroke: "#0044ff",
        strokeThickness: 8,
        align: "center",
      })
      .setOrigin(0.5);

    this.subtitle = this.add
      .text(cx, cy - 38, "mass = money", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#8888ff",
        align: "center",
      })
      .setOrigin(0.5);

    this.playBtn = this.add
      .text(cx, cy + 40, "[ PLAY ]", {
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
      .text(cx, cy + 105, "Mouse: aim & click to thrust\nWASD / Arrow keys: rotate & thrust", {
        fontFamily: "Arial",
        fontSize: "13px",
        color: "#666666",
        align: "center",
      })
      .setOrigin(0.5);

    // High score display
    const HS_KEY = "omnivi_highscore";
    const best = parseInt(localStorage.getItem(HS_KEY) ?? "0", 10);
    if (best > 0) {
      this.add
        .text(cx, cy + 150, `Best Score: ${best.toLocaleString()}`, {
          fontFamily: "monospace",
          fontSize: "15px",
          color: "#ffdd00",
          stroke: "#000000",
          strokeThickness: 2,
          align: "center",
        })
        .setOrigin(0.5);
    }

    EventBus.emit("current-scene-ready", this);
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
