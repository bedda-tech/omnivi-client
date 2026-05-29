import { EventBus } from "../EventBus";
import { Scene } from "phaser";

export interface GameOverData {
  absorberName?: string;
  finalMass: number;
  buyIn: number;
  reason: "absorbed" | "consumed";
}

interface Star {
  x: number; y: number; r: number; speed: number; color: number; alpha: number;
}

const STAR_COLORS = [0xffffff, 0xffffff, 0xaaddff, 0xbbbbff, 0xffddaa];

export class GameOver extends Scene {
  private starGfx!: Phaser.GameObjects.Graphics;
  private stars: Star[] = [];

  constructor() {
    super("GameOver");
  }

  create(data?: GameOverData) {
    const { width: W, height: H } = this.cameras.main;
    const cx = W / 2;
    const cy = H / 2;

    const finalMass = data?.finalMass ?? 0;
    const buyIn = data?.buyIn ?? 0;
    const isAbsorbed = (data?.reason ?? "consumed") === "absorbed";
    const absorberName = data?.absorberName ?? "";

    this.cameras.main.setBackgroundColor(0x000811);

    this.starGfx = this.add.graphics().setDepth(0);
    this.stars = Array.from({ length: 130 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.6 + 0.2,
      speed: Math.random() * 0.06 + 0.02,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      alpha: 0.25 + Math.random() * 0.5,
    }));

    // ── Nebula tint ───────────────────────────────────────────────────────────
    const nebGfx = this.add.graphics().setDepth(0);
    nebGfx.fillStyle(0x440000, 0.06);
    nebGfx.fillCircle(cx * 0.6, cy * 0.4, 230);
    nebGfx.fillStyle(0x220011, 0.05);
    nebGfx.fillCircle(cx * 1.5, cy * 1.6, 200);

    // ── Title ─────────────────────────────────────────────────────────────────
    const titleText = isAbsorbed ? "ABSORBED" : "CONSUMED BY THE SHRINK";
    const titleColor = "#ff5500";
    const titleSize = isAbsorbed ? "64px" : "42px";

    this.add.text(cx, cy - 148, titleText, {
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSize: titleSize,
      color: titleColor,
      stroke: "#330000",
      strokeThickness: 8,
      shadow: { offsetX: 0, offsetY: 0, color: "#ff3300", blur: 22, stroke: true, fill: true },
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    // ── Absorber sub-line ─────────────────────────────────────────────────────
    if (isAbsorbed && absorberName) {
      this.add.text(cx, cy - 88, `by  ${absorberName}`, {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#ff8855",
        letterSpacing: 2,
        align: "center",
      }).setOrigin(0.5).setDepth(10);
    }

    // ── Separator ─────────────────────────────────────────────────────────────
    const sepGfx = this.add.graphics().setDepth(9);
    sepGfx.lineStyle(1, 0x331100, 0.55);
    sepGfx.lineBetween(cx - 210, cy - 52, cx + 210, cy - 52);

    // ── Final mass ────────────────────────────────────────────────────────────
    this.add.text(cx, cy - 24, `Final mass:  ${finalMass.toFixed(2)} VI`, {
      fontFamily: "monospace",
      fontSize: "17px",
      color: "#99aabc",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    // ── Profit / loss ─────────────────────────────────────────────────────────
    const delta = finalMass - buyIn;
    const deltaSign = delta >= 0 ? "+" : "";
    const deltaColor = delta >= 0 ? "#00ff88" : "#ff3333";

    this.add.text(cx, cy + 14, `${deltaSign}${delta.toFixed(2)} VI`, {
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSize: "30px",
      color: deltaColor,
      stroke: "#000000",
      strokeThickness: 4,
      shadow: { offsetX: 0, offsetY: 0, color: deltaColor, blur: 14, fill: true },
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    this.add.text(cx, cy + 48, `vs ${buyIn} VI buy-in`, {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#445566",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    sepGfx.lineStyle(1, 0x331100, 0.30);
    sepGfx.lineBetween(cx - 210, cy + 70, cx + 210, cy + 70);

    // ── Buttons ───────────────────────────────────────────────────────────────
    const btnY = cy + 110;
    const btnGfx = this.add.graphics().setDepth(9);
    const BTN_W = 180;
    const BTN_H = 42;
    const BTN_R = 9;

    const makeBtn = (
      bx: number,
      label: string,
      textColor: string,
      borderColor: number,
      onDown: () => void,
    ) => {
      btnGfx.fillStyle(borderColor, 0.10);
      btnGfx.fillRoundedRect(bx - BTN_W / 2, btnY - BTN_H / 2, BTN_W, BTN_H, BTN_R);
      btnGfx.lineStyle(1.5, borderColor, 0.55);
      btnGfx.strokeRoundedRect(bx - BTN_W / 2, btnY - BTN_H / 2, BTN_W, BTN_H, BTN_R);

      const txt = this.add.text(bx, btnY, label, {
        fontFamily: '"Arial Black", Gadget, sans-serif',
        fontSize: "16px",
        color: textColor,
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
      }).setOrigin(0.5).setDepth(11).setInteractive({ useHandCursor: true });

      txt
        .on("pointerover", () => {
          txt.setAlpha(1.0).setStyle({ color: "#ffffff" });
          btnGfx.lineStyle(2, borderColor, 0.85);
          btnGfx.strokeRoundedRect(bx - BTN_W / 2, btnY - BTN_H / 2, BTN_W, BTN_H, BTN_R);
        })
        .on("pointerout", () => {
          txt.setAlpha(0.9).setStyle({ color: textColor });
        })
        .on("pointerdown", onDown);

      return txt;
    };

    makeBtn(cx - 108, "▶  PLAY AGAIN", "#00ff88", 0x00ff88, () => this.scene.start("Lobby"));
    makeBtn(cx + 108, "⏎  MAIN MENU", "#4488ff", 0x4488ff, () => this.scene.start("MainMenu"));

    EventBus.emit("current-scene-ready", this);
  }

  update(_time: number, delta: number) {
    const { height: H } = this.cameras.main;
    this.starGfx.clear();
    for (const s of this.stars) {
      s.y += s.speed * (delta / 16.67);
      if (s.y > H) s.y = 0;
      this.starGfx.fillStyle(s.color, s.alpha);
      this.starGfx.fillCircle(s.x, s.y, s.r);
    }
  }

  changeScene() {
    this.scene.start("MainMenu");
  }
}
