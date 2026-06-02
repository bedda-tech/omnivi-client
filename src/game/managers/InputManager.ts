import Phaser from "phaser";

export interface MovementResult {
  dx: number;        // aim unit vector x (mouse/gamepad); 0 for keyboard
  dy: number;        // aim unit vector y (mouse/gamepad); 0 for keyboard
  rotDelta: number;  // keyboard rotation change this frame; 0 for mouse/gamepad
  thrusting: boolean;
}

export interface ActionResult {
  boost: boolean;   // Shift JustDown
  eject: boolean;   // Q JustDown
  shield: boolean;  // F JustDown
  escape: boolean;  // E JustDown
}

export class InputManager {
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW: Phaser.Input.Keyboard.Key;
  private keyA: Phaser.Input.Keyboard.Key;
  private keyS: Phaser.Input.Keyboard.Key;
  private keyD: Phaser.Input.Keyboard.Key;
  private keyE: Phaser.Input.Keyboard.Key;
  private keyShift: Phaser.Input.Keyboard.Key;
  private keyQ: Phaser.Input.Keyboard.Key;
  private keyF: Phaser.Input.Keyboard.Key;

  private pointer: Phaser.Input.Pointer;
  private mouseDown = false;
  private gamepad: Phaser.Input.Gamepad.Gamepad | null = null;

  private useKeyboard = false;
  private useGamepad = false;
  readonly useTouch: boolean;

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;
    this.cursors  = kb.createCursorKeys();
    this.keyW     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyE     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyShift = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyQ     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.keyF     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.F);

    this.useTouch = scene.sys.game.device.input.touch;
    this.pointer  = scene.input.activePointer;

    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.pointer     = p;
      this.useKeyboard = false;
      this.useGamepad  = false;
    });
    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.pointer   = p;
      this.mouseDown = true;
      if (this.useTouch) {
        this.useKeyboard = false;
        this.useGamepad  = false;
      }
    });
    scene.input.on("pointerup", () => {
      this.mouseDown = false;
    });

    scene.input.gamepad?.once(
      Phaser.Input.Gamepad.Events.CONNECTED,
      (pad: Phaser.Input.Gamepad.Gamepad) => {
        this.gamepad     = pad;
        this.useGamepad  = true;
        this.useKeyboard = false;
      }
    );
  }

  getMovement(playerX: number, playerY: number, dt: number): MovementResult {
    const keyLeft  = this.cursors.left?.isDown  || this.keyA.isDown;
    const keyRight = this.cursors.right?.isDown || this.keyD.isDown;
    const keyUp    = this.cursors.up?.isDown    || this.keyW.isDown;
    const keyDown  = this.cursors.down?.isDown  || this.keyS.isDown;

    if (keyLeft || keyRight || keyUp || keyDown) {
      this.useKeyboard = true;
      this.useGamepad  = false;
    }

    if (this.useKeyboard) {
      let rotDelta = 0;
      if (keyLeft)  rotDelta -= 2.2 * dt;
      if (keyRight) rotDelta += 2.2 * dt;
      return { dx: 0, dy: 0, rotDelta, thrusting: keyUp || keyDown };
    }

    if (this.useGamepad && this.gamepad) {
      const lx  = this.gamepad.leftStick?.x ?? 0;
      const ly  = this.gamepad.leftStick?.y ?? 0;
      const rt  = (this.gamepad as any).R2 ?? 0;
      const len = Math.hypot(lx, ly);
      const dx  = len > 0.1 ? lx : 0;
      const dy  = len > 0.1 ? ly : 0;
      return { dx, dy, rotDelta: 0, thrusting: rt > 0.1 };
    }

    // Mouse / touch
    const rawDx = this.pointer.worldX - playerX;
    const rawDy = this.pointer.worldY - playerY;
    const len   = Math.hypot(rawDx, rawDy);
    const dx    = len > 0 ? rawDx / len : 1;
    const dy    = len > 0 ? rawDy / len : 0;
    return { dx, dy, rotDelta: 0, thrusting: this.mouseDown };
  }

  getActions(): ActionResult {
    return {
      boost:  Phaser.Input.Keyboard.JustDown(this.keyShift),
      eject:  Phaser.Input.Keyboard.JustDown(this.keyQ),
      shield: Phaser.Input.Keyboard.JustDown(this.keyF),
      escape: Phaser.Input.Keyboard.JustDown(this.keyE),
    };
  }
}
