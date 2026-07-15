# OMNIVI

**Physics-based multiplayer space battle — in your browser, no download required.**

Grow your mass by absorbing everything around you, then escape before the black hole collapses and destroys the universe.

## What it is

Omnivi is a real-time multiplayer `.io` game where mass is physics. You control a celestial body drifting in a collapsing universe. Absorb dust, asteroids, and weaker players to grow — then thrust your way to safety before the event horizon swallows everything.

- **Barnes-Hut gravity** — real n-body physics simulation, not simple attraction rules
- **Real-time multiplayer** — Colyseus WebSocket server, client-side prediction, dead-reckoning interpolation
- **Skill ceiling** — gravity slingshots, mass ejection weapon, boost bursts, feint mechanics
- **Mounting tension** — shrinking world boundary, escalating black hole pull, escape countdown

## Controls

| Input | Action |
|-------|--------|
| WASD / Arrow keys | Aim direction |
| Left click / Touch | Thrust toward cursor |
| Shift | Boost burst |
| Q | Eject mass (ranged weapon) |
| E | Begin escape sequence |
| F | Shield |

## Stack

- **Client**: Vite + React + PixiJS v8 (game canvas) + TypeScript
- **Server**: Colyseus 0.15 + Node.js
- **Physics**: Barnes-Hut quadtree, spatial grid culling
- **Contracts**: Hardhat + Solidity on Base L2

## Development

```bash
# Client
cd repos/omnivi-client
npm install
npm run dev        # http://localhost:5173

# Server
cd repos/omnivi-server
npm install
npm run dev        # ws://localhost:8000
```

## Build

```bash
npm run build      # in each repo
```

## Deployed alpha

- Client: http://192.168.68.62:8001
- Server: ws://192.168.68.62:8000

Restart after code changes: `sudo systemctl restart omnivi-server omnivi-client`

## Optional: real-stakes mode

Players can stake tokens to enter a paid round and claim rewards on escape. Powered by `GameVault.sol` on Base. Staking is entirely opt-in — the game is fully playable without a wallet at any time.

To enable: fund the deployer wallet, set `PRIVATE_KEY` in `repos/omnivi-server/.env`, and run `npm run deploy:contracts`.
