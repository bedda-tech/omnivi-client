import { Boot } from "./scenes/Boot";
import { GameOver } from "./scenes/GameOver";
import { Lobby } from "./scenes/Lobby";
import { Main } from "./scenes/Main";
import { MainMenu } from "./scenes/MainMenu";
import { RoundResults } from "./scenes/RoundResults";
import { AUTO, Game } from "phaser";
import { Preloader } from "./scenes/Preloader";

//  Find out more information about the Game Config at:
//  https://newdocs.phaser.io/docs/3.70.0/Phaser.Types.Core.GameConfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: 1024,
  height: 768,
  parent: "game-container",
  backgroundColor: "#000000",
  scene: [Boot, Preloader, MainMenu, Lobby, Main, RoundResults, GameOver],
  input: {
    gamepad: true,
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
