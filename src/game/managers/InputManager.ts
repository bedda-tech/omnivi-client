import Phaser from "phaser";

export interface MovementResult {
  dx: number;        // aim unit vector x (mouse/gamepad/touch); 0 for keyboard
  dy: number;        // aim unit vector y (mouse/gamepad/touch); 0 for keyboard
  rotDelta: number;  // keyboard rotation change this frame; 0 for mouse/gamepad/touch
  thrusting: boolean;
}

export interface ActionResult {
  boost: boolean;   // Shift JustDown / BOOST button tap
  eject: boolean;   // Q JustDown / EJECT button tap
  shield: boolean;  // F JustDown / SHIELD button tap
  escape: boolean;  // E JustDown / ESC button tap
  brake: boolean;   // Space JustDown / BRK button tap
}

type ActionKey = "boost" | "eject" | "shield" | "escape" | "brake";

interface TouchButtonDef {
  key: ActionKey;
  label: string;
  x: number;
  y: number;
}

const JOY_HINT_R   = 50; // idle hint ring radius
const JOY_BASE_R   = 55; // active base ring radius
const JOY_THUMB_R  = 24;
const JOY_MAX_DRAG = 55; // thumb travel clamp == max stick throw
const JOY_DEADZONE = 12; // px of drag before thrust registers
const JOY_ANCHOR_X = 110;
const JOY_ANCHOR_Y_FROM_BOTTOM = 130;

const BTN_R   = 32;
const BTN_ANCHOR_X_FROM_RIGHT = 90;
const BTN_ANCHOR_Y_FROM_BOTTOM = 130;
const BTN_GAP = 76;

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
  private keySpace: Phaser.Input.Keyboard.Key;

  private pointer: Phaser.Input.Pointer;
  private mouseDown = false;
  private gamepad: Phaser.Input.Gamepad.Gamepad | null = null;

  private useKeyboard = false;
  private useGamepad = false;
  readonly useTouch: boolean;

  // ── Virtual joystick (touch) ────────────────────────────────────────────
  private joyPointerId: number | null = null;
  private joyBaseX = 0;
  private joyBaseY = 0;
  private joyThumbX = 0;
  private joyThumbY = 0;
  private joyDx = 0;
  private joyDy = 0;
  private joyThrusting = false;
  private joyHintX = 0;
  private joyHintY = 0;

  // ── On-screen action buttons (touch) ────────────────────────────────────
  private btnDefs: TouchButtonDef[] = [];
  private btnPointerIds: Record<ActionKey, number | null> = {
    boost: null, eject: null, shield: null, escape: null, brake: null,
  };
  private btnPending: Record<ActionKey, boolean> = {
    boost: false, eject: false, shield: false, escape: false, brake: false,
  };

  private touchGfx: Phaser.GameObjects.Graphics | null = null;
  private touchLabels: Phaser.GameObjects.Text[] = [];

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
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

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

    if (this.useTouch) this.setupTouchControls(scene);
  }

  // ── Touch control setup ──────────────────────────────────────────────────

  private layoutTouchControls(gw: number, gh: number) {
    this.joyHintX = JOY_ANCHOR_X;
    this.joyHintY = gh - JOY_ANCHOR_Y_FROM_BOTTOM;

    const anchorX = gw - BTN_ANCHOR_X_FROM_RIGHT;
    const anchorY = gh - BTN_ANCHOR_Y_FROM_BOTTOM;
    const half = BTN_GAP / 2;
    this.btnDefs = [
      { key: "shield", label: "SHLD", x: anchorX - half, y: anchorY - half },
      { key: "boost",  label: "BST",  x: anchorX + half, y: anchorY - half },
      { key: "eject",  label: "EJT",  x: anchorX - half, y: anchorY + half },
      { key: "escape", label: "ESC",  x: anchorX + half, y: anchorY + half },
      { key: "brake",  label: "BRK",  x: anchorX,         y: anchorY - half - BTN_GAP },
    ];
  }

  private setupTouchControls(scene: Phaser.Scene) {
    this.layoutTouchControls(scene.scale.width, scene.scale.height);

    this.touchGfx = scene.add.graphics().setScrollFactor(0).setDepth(40);
    this.touchLabels = this.btnDefs.map((b) =>
      scene.add
        .text(b.x, b.y, b.label, { fontSize: "11px", color: "#ffffff", stroke: "#000000", strokeThickness: 3 })
        .setScrollFactor(0).setDepth(41).setOrigin(0.5)
    );
    this.redrawTouchControls();

    scene.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onTouchDown(p));
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => this.onTouchMove(p));
    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => this.onTouchUp(p));
    scene.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => this.onTouchUp(p));

    scene.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      this.layoutTouchControls(gameSize.width, gameSize.height);
      this.btnDefs.forEach((b, i) => this.touchLabels[i].setPosition(b.x, b.y));
      this.redrawTouchControls();
    });
  }

  private hitButton(x: number, y: number): TouchButtonDef | null {
    for (const b of this.btnDefs) {
      if (Math.hypot(x - b.x, y - b.y) <= BTN_R) return b;
    }
    return null;
  }

  private onTouchDown(p: Phaser.Input.Pointer) {
    const btn = this.hitButton(p.x, p.y);
    if (btn) {
      this.btnPointerIds[btn.key] = p.id;
      this.btnPending[btn.key] = true;
      this.redrawTouchControls();
      return;
    }
    // Anything not on a button starts/re-anchors the joystick.
    if (this.joyPointerId === null) {
      this.joyPointerId = p.id;
      this.joyBaseX = this.joyThumbX = p.x;
      this.joyBaseY = this.joyThumbY = p.y;
      this.joyDx = 0;
      this.joyDy = 0;
      this.joyThrusting = false;
      this.redrawTouchControls();
    }
  }

  private onTouchMove(p: Phaser.Input.Pointer) {
    if (p.id !== this.joyPointerId) return;
    const dx = p.x - this.joyBaseX;
    const dy = p.y - this.joyBaseY;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, JOY_MAX_DRAG);
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    this.joyThumbX = this.joyBaseX + nx * clamped;
    this.joyThumbY = this.joyBaseY + ny * clamped;
    if (dist > JOY_DEADZONE) {
      this.joyDx = nx;
      this.joyDy = ny;
      this.joyThrusting = true;
    } else {
      this.joyThrusting = false;
    }
    this.redrawTouchControls();
  }

  private onTouchUp(p: Phaser.Input.Pointer) {
    if (p.id === this.joyPointerId) {
      this.joyPointerId = null;
      this.joyDx = 0;
      this.joyDy = 0;
      this.joyThrusting = false;
    }
    for (const key of Object.keys(this.btnPointerIds) as ActionKey[]) {
      if (this.btnPointerIds[key] === p.id) this.btnPointerIds[key] = null;
    }
    this.redrawTouchControls();
  }

  private redrawTouchControls() {
    if (!this.touchGfx) return;
    const g = this.touchGfx;
    g.clear();

    // Joystick
    if (this.joyPointerId !== null) {
      g.lineStyle(3, 0x66ccff, 0.55);
      g.strokeCircle(this.joyBaseX, this.joyBaseY, JOY_BASE_R);
      g.fillStyle(0x66ccff, this.joyThrusting ? 0.65 : 0.4);
      g.fillCircle(this.joyThumbX, this.joyThumbY, JOY_THUMB_R);
    } else {
      g.lineStyle(2, 0xaaaaaa, 0.3);
      g.strokeCircle(this.joyHintX, this.joyHintY, JOY_HINT_R);
      g.fillStyle(0xaaaaaa, 0.15);
      g.fillCircle(this.joyHintX, this.joyHintY, JOY_THUMB_R);
    }

    // Action buttons
    for (const b of this.btnDefs) {
      const pressed = this.btnPointerIds[b.key] !== null;
      g.lineStyle(2, 0xffffff, 0.5);
      g.strokeCircle(b.x, b.y, BTN_R);
      g.fillStyle(0xffffff, pressed ? 0.35 : 0.12);
      g.fillCircle(b.x, b.y, BTN_R);
    }
  }

  private consumeButton(key: ActionKey): boolean {
    const pending = this.btnPending[key];
    this.btnPending[key] = false;
    return pending;
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

    if (this.useTouch) {
      // Virtual joystick: direction is a vector from the drag origin, wholly
      // independent of thrust — unlike a raw touch point, aim survives lifting
      // and re-placing the thumb.
      return { dx: this.joyDx, dy: this.joyDy, rotDelta: 0, thrusting: this.joyThrusting };
    }

    // Mouse
    const rawDx = this.pointer.worldX - playerX;
    const rawDy = this.pointer.worldY - playerY;
    const len   = Math.hypot(rawDx, rawDy);
    const dx    = len > 0 ? rawDx / len : 1;
    const dy    = len > 0 ? rawDy / len : 0;
    return { dx, dy, rotDelta: 0, thrusting: this.mouseDown };
  }

  getActions(): ActionResult {
    const boost  = Phaser.Input.Keyboard.JustDown(this.keyShift);
    const eject  = Phaser.Input.Keyboard.JustDown(this.keyQ);
    const shield = Phaser.Input.Keyboard.JustDown(this.keyF);
    const escape = Phaser.Input.Keyboard.JustDown(this.keyE);
    const brake  = Phaser.Input.Keyboard.JustDown(this.keySpace);

    if (!this.useTouch) return { boost, eject, shield, escape, brake };
    return {
      boost:  boost  || this.consumeButton("boost"),
      eject:  eject  || this.consumeButton("eject"),
      shield: shield || this.consumeButton("shield"),
      escape: escape || this.consumeButton("escape"),
      brake:  brake  || this.consumeButton("brake"),
    };
  }
}
