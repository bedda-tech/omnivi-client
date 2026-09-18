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
| C | Cloak (invisibility) |
| X | Fragmentation Bomb |
| Z | Gravity Well |

## Stack

- **Client**: Vite + React + Phaser 3.55 + TypeScript
- **Server**: Colyseus 0.16 + Node.js (running on port 8000)
- **Physics**: Arcade physics engine, spatial grid (1000px cells)
- **Contracts**: Hardhat + Solidity (GameVault.sol on Base Sepolia testnet)
- **Testing**: Vitest (53 unit tests) + Playwright E2E tests

## Quick Start

```bash
# Prerequisites: Node.js 25.2.1, npm

# Client
cd repos/omnivi-client
npm install --include=dev
npm run build      # or: Vite dev server (requires server running)

# Server (already running as systemd service)
systemctl status omnivi-server.service

# Tests
npm run test       # unit + E2E (E2E requires server running)
```

## Building

```bash
cd repos/omnivi-client
npm run build      # → dist/

cd repos/omnivi-server
npm run build      # TypeScript → dist/
npm run test:unit  # Vitest game logic tests
npm run test:contracts  # Hardhat smart contract tests
```

## Running Locally

The server runs as a systemd service (port 8000). To restart:

```bash
sudo systemctl restart omnivi-server.service
```

The client connects to `ws://localhost:8000` by default. To run a dev build:

```bash
cd repos/omnivi-client
npm run dev        # Vite dev server on http://localhost:5173
```

Note: `NODE_ENV=production` in this agent skips devDependencies. Always use `npm install --include=dev` when installing.

## Optional: real-stakes mode

Players can stake tokens to enter a paid round and claim rewards on escape. Powered by `GameVault.sol` on Base. Staking is entirely opt-in — the game is fully playable without a wallet at any time.

To enable: fund the deployer wallet, set `PRIVATE_KEY` in `repos/omnivi-server/.env`, and run `npm run deploy:contracts`.
