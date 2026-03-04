import { GameObjects, Scene } from "phaser";
import { EventBus } from "../EventBus";

export class MainMenu extends Scene {
  title!: GameObjects.Text;
  subtitle!: GameObjects.Text;
  playBtn!: GameObjects.Text;

  constructor() {
    super("MainMenu");
  }

  create() {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    this.title = this.add
      .text(cx, cy - 80, "OMNIVI", {
        fontFamily: "Arial Black",
        fontSize: "52px",
        color: "#ffffff",
        stroke: "#0044ff",
        strokeThickness: 6,
        align: "center",
      })
      .setOrigin(0.5);

    this.subtitle = this.add
      .text(cx, cy - 20, "mass = money", {
        fontFamily: "Arial",
        fontSize: "18px",
        color: "#8888ff",
        align: "center",
      })
      .setOrigin(0.5);

    this.playBtn = this.add
      .text(cx, cy + 60, "[ PLAY ]", {
        fontFamily: "Arial Black",
        fontSize: "28px",
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
      .text(cx, cy + 120, "Mouse: aim & click to thrust\nWASD / Arrow keys: rotate & thrust", {
        fontFamily: "Arial",
        fontSize: "13px",
        color: "#666666",
        align: "center",
      })
      .setOrigin(0.5);

    EventBus.emit("current-scene-ready", this);
  }

  changeScene() {
    this.scene.start("Main");
  }
}
