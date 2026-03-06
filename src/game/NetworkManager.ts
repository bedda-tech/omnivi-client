import { Client, Room } from "colyseus.js";

// ─── Remote player snapshot (what the server tells us about other players) ───
export interface RemotePlayer {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  color: string;
  isThrusting: boolean;
  isEscaping: boolean;
  phase: string;
}

// ─── Server-authoritative game state ─────────────────────────────────────────
export interface ServerGameState {
  phase: string;
  shrinkTimer: number;
  bhMass: number;
  bhX: number;
  bhY: number;
}

// ─── Default server URL (override via VITE_SERVER_URL env var) ────────────────
const DEFAULT_SERVER_URL =
  (import.meta as any).env?.VITE_SERVER_URL ?? "ws://localhost:8000";

export class NetworkManager {
  private client: Client;
  private room: Room | null = null;
  private _mySessionId: string = "";
  private _players = new Map<string, RemotePlayer>();
  private _gameState: ServerGameState = {
    phase: "playing",
    shrinkTimer: 90,
    bhMass: 0,
    bhX: 0,
    bhY: 0,
  };

  constructor(serverUrl: string = DEFAULT_SERVER_URL) {
    this.client = new Client(serverUrl);
  }

  /** Join (or create) the shared "omnivi" room. Non-throwing — failures are logged. */
  async connect(): Promise<void> {
    this.room = await this.client.joinOrCreate<any>("omnivi");
    this._mySessionId = this.room.sessionId;

    // Track remote players (skip our own entry)
    this.room.state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === this._mySessionId) return;
      this._players.set(sessionId, mapPlayer(sessionId, player));
      player.onChange(() => {
        this._players.set(sessionId, mapPlayer(sessionId, player));
      });
    });

    this.room.state.players.onRemove((_player: any, sessionId: string) => {
      this._players.delete(sessionId);
    });

    // Mirror server game state (phase, timers, BH)
    this.room.state.onChange(() => {
      const s = this.room!.state;
      this._gameState = {
        phase: s.phase,
        shrinkTimer: s.shrinkTimer,
        bhMass: s.bhMass,
        bhX: s.bhX,
        bhY: s.bhY,
      };
    });

    console.log(`[Net] Joined room ${this.room.roomId} as ${this._mySessionId}`);
  }

  // ── Outbound messages ───────────────────────────────────────────────────────

  sendPlayerState(
    x: number,
    y: number,
    vx: number,
    vy: number,
    mass: number,
    isThrusting: boolean,
    isEscaping: boolean,
  ): void {
    if (!this.room) return;
    this.room.send("input", { x, y, vx, vy, mass, isThrusting, isEscaping });
  }

  /** Notify server that we absorbed another player (victimId = their sessionId). */
  sendAbsorbPlayer(victimId: string): void {
    this.room?.send("absorb_player", { victimId });
  }

  sendEscaped(): void {
    this.room?.send("escaped");
  }

  sendConsumed(): void {
    this.room?.send("consumed");
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  get mySessionId(): string { return this._mySessionId; }
  get otherPlayers(): Map<string, RemotePlayer> { return this._players; }
  get gameState(): ServerGameState { return this._gameState; }
  get connected(): boolean { return this.room !== null; }

  disconnect(): void {
    this.room?.leave();
    this.room = null;
    this._players.clear();
  }
}

function mapPlayer(sessionId: string, p: any): RemotePlayer {
  return {
    id: sessionId,
    x: p.x,
    y: p.y,
    vx: p.vx ?? 0,
    vy: p.vy ?? 0,
    mass: p.mass,
    color: p.color ?? "#ffffff",
    isThrusting: p.isThrusting ?? false,
    isEscaping: p.isEscaping ?? false,
    phase: p.phase ?? "alive",
  };
}
