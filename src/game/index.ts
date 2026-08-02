import { Boot } from "./scenes/Boot";
import { GameOver } from "./scenes/GameOver";
import { Lobby } from "./scenes/Lobby";
import { Main } from "./scenes/Main";
import { MainMenu } from "./scenes/MainMenu";
import { RoundResults } from "./scenes/RoundResults";
import { AUTO, Game, Scale } from "phaser";
import { Preloader } from "./scenes/Preloader";

//  Find out more information about the Game Config at:
//  https://newdocs.phaser.io/docs/3.70.0/Phaser.Types.Core.GameConfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: 1024,
  height: 768,
  parent: "game-container",
  backgroundColor: "#000000",
  scale: {
    // Canvas resolution tracks the actual container size (no fixed desktop
    // resolution) — without this, mobile viewports render a clipped slice
    // of a fixed 1024x768 canvas: HUD text anchored near x=0 and touch
    // controls anchored near the canvas edges end up off-screen.
    mode: Scale.RESIZE,
    parent: "game-container",
    autoCenter: Scale.NO_CENTER,
    width: 1024,
    height: 768,
  },
  scene: [Boot, Preloader, MainMenu, Lobby, Main, RoundResults, GameOver],
  input: {
    gamepad: true,
    activePointers: 3, // virtual joystick + on-screen action button, concurrently
  },
  physics: {
    default: "arcade",
    arcade: {
      debug: false,
    },
  },
};

const StartGame = (parent: string) => {
  return new Game({ ...config, parent });
};

export default StartGame;
