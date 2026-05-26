import { Scene, GameObjects } from "phaser";
import { RoundResult, TIER_INFO, ClaimReadyPayload } from "../NetworkManager";
import { connectWallet, submitClaim } from "../blockchain/ClaimClient";

export interface RoundResultsData {
  results: RoundResult[];
  mySessionId: string;
  playerTier: number;
  buyInTokens: number;
  timeSurvived: number;
  claimPayload?: ClaimReadyPayload;
  practiceMode?: boolean;
}

// Mass IS VI — no conversion needed
const TIER_COLORS_S  = ["#44aaff", "#00ff88", "#ffaa00"] as const;
const RANK_COLORS    = ["#ffd700", "#c0c0c0", "#cd7f32"] as const;
const RANK_GLOW      = [0xffd700, 0xc0c0c0, 0xcd7f32] as const;

interface Star {
  x: number; y: number; r: number; speed: number;
  color: number; alpha: number; twinklePhase: number; twinkleSpeed: number;
}

export class RoundResults extends Scene {
  private starGfx!: GameObjects.Graphics;
  private stars: Star[] = [];
  private t: number = 0;

  // Animated outcome elements
  private outcomePulse: number = 0;
  private outcomeText!: GameObjects.Text;
  private outcomeSurvived: boolean = false;

  // Claim UI (only present when server sent a signed claim payload)
  private claimBtn: GameObjects.Text | null = null;
  private claimStatusText: GameObjects.Text | null = null;

  private readonly NEBULAE: [number, number, number, number, number][] = [
    [0.10, 0.20, 200, 0x2200aa, 0.040],
    [0.85, 0.75, 180, 0x001188, 0.035],
    [0.55, 0.08, 160, 0x550055, 0.030],
    [0.30, 0.85, 190, 0x220033, 0.030],
    [0.88, 0.30, 140, 0x003322, 0.025],
  ];

  constructor() {
    super("RoundResults");
  }

  create(data: RoundResultsData) {
    const { width: W, height: H } = this.cameras.main;
    const cx = W / 2;

    // ── Static nebula ─────────────────────────────────────────────────────────
    const nebulaGfx = this.add.graphics().setDepth(0);
    for (const [fx, fy, r, color, alpha] of this.NEBULAE) {
      for (let ring = 0; ring < 5; ring++) {
        const ringR = r * (1 - ring * 0.18);
        const ringA = alpha * (1 - ring * 0.15);
        nebulaGfx.fillStyle(color, ringA);
        nebulaGfx.fillCircle(fx * W, fy * H, ringR);
      }
    }

    // ── Animated star field ───────────────────────────────────────────────────
    this.starGfx = this.add.graphics().setDepth(1);
    const STAR_COLORS = [0xffffff, 0xffffff, 0xffffff, 0xaaddff, 0xbbbbff, 0xffddaa, 0xccbbff];
    this.stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.6 + 0.2,
      speed: Math.random() * 0.10 + 0.03,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      alpha: 0.25 + Math.random() * 0.50,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.5 + Math.random() * 1.2,
    }));

    const results  = data?.results      ?? [];
    const myId     = data?.mySessionId  ?? "";
    const buyIn    = data?.buyInTokens  ?? TIER_INFO[data?.playerTier ?? 1].viCost;
    const survived = data?.timeSurvived ?? 0;
    const myIdx    = results.findIndex(r => r.id === myId);
    const myResult = myIdx >= 0 ? results[myIdx] : null;
    const myRank   = myIdx + 1;

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add.text(cx, 26, "ROUND OVER", {
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSize: "38px",
      color: "#00eeff",
      stroke: "#0033cc",
      strokeThickness: 7,
      shadow: { offsetX: 0, offsetY: 0, color: "#00ccff", blur: 18, stroke: true, fill: true },
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    this.add.graphics().setDepth(3).lineStyle(1, 0x1133aa, 0.30)
      .lineBetween(cx - 260, 58, cx + 260, 58);

    // ── My result panel ───────────────────────────────────────────────────────
    let nextY = 72;
    if (myResult) {
      const escaped    = myResult.phase === "escaped";
      const BONUS_TABLE = [1.50, 1.25, 1.10] as const;
      const bonusMult  = escaped && myRank >= 1 && myRank <= 3 ? BONUS_TABLE[myRank - 1] : 1.0;
      const finalVI    = Math.floor(myResult.mass);
      const boostedVI  = Math.floor(finalVI * bonusMult);
      const netVI      = Math.floor(boostedVI * 0.97);
      const profitVI   = netVI - buyIn;

      const panelW = 520;
      const panelH = 62;
      const panelX = cx - panelW / 2;
      const panelY = nextY - 6;
      const panelColor = escaped ? 0x003322 : 0x220011;
      const borderColor = escaped ? 0x00ff88 : 0xff3300;

      const panelGfx = this.add.graphics().setDepth(8);
      panelGfx.fillStyle(panelColor, 0.35);
      panelGfx.fillRoundedRect(panelX, panelY, panelW, panelH, 8);
      panelGfx.lineStyle(2, borderColor, 0.7);
      panelGfx.strokeRoundedRect(panelX, panelY, panelW, panelH, 8);
      panelGfx.lineStyle(4, borderColor, 0.15);
      panelGfx.strokeRoundedRect(panelX - 3, panelY - 3, panelW + 6, panelH + 6, 10);

      let outcomeLabel = escaped ? "ESCAPED!" : "CONSUMED BY THE VOID";
      if (escaped && bonusMult > 1.0) outcomeLabel += `  ×${bonusMult} TOP-${myRank} BONUS`;

      this.outcomeText = this.add.text(cx, nextY + 8, outcomeLabel, {
        fontFamily: '"Arial Black", Gadget, sans-serif',
        fontSize: "20px",
        color: escaped ? "#00ffaa" : "#ff5500",
        stroke: "#000000",
        strokeThickness: 3,
        shadow: { offsetX: 0, offsetY: 0, color: escaped ? "#00ff88" : "#ff3300", blur: 12, fill: true },
        align: "center",
      }).setOrigin(0.5).setDepth(11);

      this.outcomeSurvived = escaped;

      const mins    = Math.floor(survived / 60);
      const secs    = survived % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

      let economyLine: string;
      if (escaped) {
        const sign = profitVI >= 0 ? "+" : "";
        economyLine =
          `Payout: ${netVI} VI  (${sign}${profitVI} VI)` +
          `  ·  Time: ${timeStr}  ·  Rank: #${myRank}/${results.length}`;
      } else {
        economyLine =
          `Stake lost: -${buyIn} VI` +
          `  ·  Time: ${timeStr}  ·  Rank: #${myRank}/${results.length}`;
      }

      const tierColor = myResult.tier >= 0 && myResult.tier < TIER_COLORS_S.length
        ? TIER_COLORS_S[myResult.tier]
        : "#aaaaaa";

      this.add.text(cx, nextY + 36, economyLine, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: tierColor,
        align: "center",
      }).setOrigin(0.5).setDepth(11);

      nextY += panelH + 12;
    }

    // ── Rankings panel border ─────────────────────────────────────────────────
    const tableTop = nextY + 4;
    const rowH     = 28;
    const maxRows  = Math.min(results.length, Math.floor((H - tableTop - 90) / rowH));
    const tableH   = 24 + maxRows * rowH + 4;

    const tblGfx = this.add.graphics().setDepth(4);
    tblGfx.fillStyle(0x000d1a, 0.55);
    tblGfx.fillRoundedRect(28, tableTop - 4, W - 56, tableH, 8);
    tblGfx.lineStyle(1, 0x1a3355, 0.8);
    tblGfx.strokeRoundedRect(28, tableTop - 4, W - 56, tableH, 8);

    // ── Column headers ────────────────────────────────────────────────────────
    const col = {
      rank:   55,
      name:   120,
      mass:   cx + 20,
      kills:  cx + 130,
      tier:   cx + 220,
      status: cx + 320,
    };

    const headerStyle = { fontFamily: "monospace", fontSize: "11px", color: "#334d66" } as const;
    this.add.text(col.rank,   tableTop, "RANK",   headerStyle).setOrigin(0.5, 0).setDepth(10);
    this.add.text(col.name,   tableTop, "PILOT",  headerStyle).setOrigin(0, 0).setDepth(10);
    this.add.text(col.mass,   tableTop, "VI",     headerStyle).setOrigin(0.5, 0).setDepth(10);
    this.add.text(col.kills,  tableTop, "KILLS",  headerStyle).setOrigin(0.5, 0).setDepth(10);
    this.add.text(col.tier,   tableTop, "TIER",   headerStyle).setOrigin(0.5, 0).setDepth(10);
    this.add.text(col.status, tableTop, "STATUS", headerStyle).setOrigin(0.5, 0).setDepth(10);

    const divGfx = this.add.graphics().setDepth(5);
    divGfx.lineStyle(1, 0x1a3355, 0.9);
    divGfx.lineBetween(34, tableTop + 18, W - 34, tableTop + 18);

    // ── Rows ──────────────────────────────────────────────────────────────────
    for (let i = 0; i < maxRows; i++) {
      const r        = results[i];
      const rank     = i + 1;
      const ry       = tableTop + 22 + i * rowH;
      const isMe     = r.id === myId;
      const isTop3   = rank <= 3;

      if (isMe) {
        const hl = this.add.graphics().setDepth(5);
        hl.fillStyle(0x001133, 0.65);
        hl.fillRoundedRect(30, ry - 3, W - 60, rowH - 2, 4);
        hl.lineStyle(1, 0x1155aa, 0.4);
        hl.strokeRoundedRect(30, ry - 3, W - 60, rowH - 2, 4);
      } else if (isTop3) {
        const hl = this.add.graphics().setDepth(5);
        hl.fillStyle(RANK_GLOW[rank - 1], 0.04);
        hl.fillRoundedRect(30, ry - 3, W - 60, rowH - 2, 4);
      }

      const rankColor  = isTop3 ? RANK_COLORS[rank - 1] : (isMe ? "#c0d8ff" : "#445566");
      const nameColor  = isMe ? "#ffffff" : (isTop3 ? "#aabbcc" : "#556677");
      const tierColor  = r.tier >= 0 && r.tier < TIER_COLORS_S.length ? TIER_COLORS_S[r.tier] : "#aaaaaa";
      const tierLabel  = TIER_INFO[r.tier]?.label ?? "?";
      const statusLbl  = r.phase === "escaped" ? "ESCAPED" : "CONSUMED";
      const statusClr  = r.phase === "escaped" ? "#00ffaa" : "#ff5500";
      const rankLabel  = isTop3 ? ["★", "✦", "◆"][rank - 1] + ` #${rank}` : `#${rank}`;

      const rowStyle = (color: string, size: string = "12px") =>
        ({ fontFamily: "monospace", fontSize: size, color }) as const;

      this.add.text(col.rank,   ry, rankLabel,              rowStyle(rankColor, "12px")).setOrigin(0.5, 0).setDepth(10);
      this.add.text(col.name,   ry, r.name.slice(0, 13),     rowStyle(nameColor)).setOrigin(0, 0).setDepth(10);
      this.add.text(col.mass,   ry, r.mass.toLocaleString(),  rowStyle(nameColor)).setOrigin(0.5, 0).setDepth(10);
      this.add.text(col.kills,  ry, String(r.kills),          rowStyle(r.kills > 0 ? "#ff9966" : "#334455")).setOrigin(0.5, 0).setDepth(10);
      this.add.text(col.tier,   ry, tierLabel,                rowStyle(tierColor, "11px")).setOrigin(0.5, 0).setDepth(10);
      this.add.text(col.status, ry, statusLbl,                rowStyle(statusClr, "11px")).setOrigin(0.5, 0).setDepth(10);
    }

    // ── Buttons ───────────────────────────────────────────────────────────────
    const btnY  = H - 50;
    const btnGfx = this.add.graphics().setDepth(9);

    // Rematch button
    const rematchW = 220;
    const rematchX = cx - 140;
    btnGfx.fillStyle(0x003322, 0.40);
    btnGfx.fillRoundedRect(rematchX - rematchW / 2, btnY - 20, rematchW, 40, 8);
    btnGfx.lineStyle(2, 0x00ff88, 0.50);
    btnGfx.strokeRoundedRect(rematchX - rematchW / 2, btnY - 20, rematchW, 40, 8);

    const rematchBtn = this.add.text(rematchX, btnY, "▶  QUICK REMATCH", {
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSize: "17px",
      color: "#00ff88",
      stroke: "#002211",
      strokeThickness: 3,
      shadow: { offsetX: 0, offsetY: 0, color: "#00ff88", blur: 10, fill: true },
    })
      .setOrigin(0.5)
      .setDepth(11)
      .setInteractive({ useHandCursor: true })
      .on("pointerover",  () => rematchBtn.setColor("#ffffff"))
      .on("pointerout",   () => rematchBtn.setColor("#00ff88"))
      .on("pointerdown",  () => this.scene.start("Lobby"));

    // Menu button
    const menuW  = 140;
    const menuX  = cx + 160;
    btnGfx.fillStyle(0x001133, 0.40);
    btnGfx.fillRoundedRect(menuX - menuW / 2, btnY - 20, menuW, 40, 8);
    btnGfx.lineStyle(2, 0x4488ff, 0.50);
    btnGfx.strokeRoundedRect(menuX - menuW / 2, btnY - 20, menuW, 40, 8);

    const menuBtn = this.add.text(menuX, btnY, "◀  MENU", {
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSize: "17px",
      color: "#4488ff",
      stroke: "#001133",
      strokeThickness: 3,
    })
      .setOrigin(0.5)
      .setDepth(11)
      .setInteractive({ useHandCursor: true })
      .on("pointerover",  () => menuBtn.setColor("#ffffff"))
      .on("pointerout",   () => menuBtn.setColor("#4488ff"))
      .on("pointerdown",  () => this.scene.start("MainMenu"));

    // ── Claim VI button (only when server sent a signed payload and player escaped) ──
    if (!data?.practiceMode && data?.claimPayload && myResult?.phase === "escaped") {
      this.buildClaimButton(cx, btnY - 65, data.claimPayload);
    }

    // ── Practice mode CTA: invite to join a staked room ──
    if (data?.practiceMode) {
      const ctaY = btnY - 68;
      btnGfx.fillStyle(0x1a0033, 0.60);
      btnGfx.fillRoundedRect(cx - 160, ctaY - 20, 320, 40, 8);
      btnGfx.lineStyle(2, 0xcc88ff, 0.80);
      btnGfx.strokeRoundedRect(cx - 160, ctaY - 20, 320, 40, 8);
      const ctaBtn = this.add.text(cx, ctaY, "⬡  PLAY STAKED — win real VI tokens", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#cc88ff",
        stroke: "#1a0033",
        strokeThickness: 2,
        shadow: { offsetX: 0, offsetY: 0, color: "#cc88ff", blur: 8, fill: true },
        align: "center",
      })
        .setOrigin(0.5)
        .setDepth(11)
        .setInteractive({ useHandCursor: true })
        .on("pointerover", () => ctaBtn.setColor("#ffffff"))
        .on("pointerout",  () => ctaBtn.setColor("#cc88ff"))
        .on("pointerdown", () => {
          window.history.replaceState({}, "", "/");
          this.scene.start("Lobby");
        });
    }

    this.add.text(cx, btnY + 26, "[ R ]  Rematch    [ M ]  Menu    [ ESC ]  Menu", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#233344",
      align: "center",
    }).setOrigin(0.5).setDepth(10);

    this.input.keyboard!.once("keydown-R",   () => this.scene.start("Lobby"));
    this.input.keyboard!.once("keydown-M",   () => this.scene.start("MainMenu"));
    this.input.keyboard!.once("keydown-ESC", () => this.scene.start("MainMenu"));
  }

  private buildClaimButton(cx: number, y: number, payload: ClaimReadyPayload): void {
    const btnW = 240;
    const gfx = this.add.graphics().setDepth(9);
    gfx.fillStyle(0x220044, 0.40);
    gfx.fillRoundedRect(cx - btnW / 2, y - 20, btnW, 40, 8);
    gfx.lineStyle(2, 0xaa44ff, 0.70);
    gfx.strokeRoundedRect(cx - btnW / 2, y - 20, btnW, 40, 8);
    gfx.lineStyle(4, 0xaa44ff, 0.15);
    gfx.strokeRoundedRect(cx - btnW / 2 - 3, y - 23, btnW + 6, 46, 10);

    this.claimBtn = this.add.text(cx, y, "⬡  CLAIM VI TOKENS", {
      fontFamily: '"Arial Black", Gadget, sans-serif',
      fontSize: "16px",
      color: "#cc88ff",
      stroke: "#110022",
      strokeThickness: 3,
      shadow: { offsetX: 0, offsetY: 0, color: "#aa44ff", blur: 10, fill: true },
    })
      .setOrigin(0.5)
      .setDepth(11)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.claimBtn?.setColor("#ffffff"))
      .on("pointerout",  () => this.claimBtn?.setColor("#cc88ff"))
      .on("pointerdown", () => { if (this.claimBtn) void this.handleClaim(payload); });

    const rankStr = payload.massRank ? `Rank #${payload.massRank} · ` : "";
    this.claimStatusText = this.add.text(cx, y + 28, `${rankStr}${payload.finalMass} VI ready to claim`, {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#7755aa",
      align: "center",
    }).setOrigin(0.5).setDepth(10);
  }

  private async handleClaim(payload: ClaimReadyPayload): Promise<void> {
    if (!this.claimBtn) return;
    this.claimBtn.disableInteractive().setColor("#555555").setText("⬡  CONNECTING...");

    try {
      const addr = await connectWallet();
      if (!addr) {
        this.claimBtn.setInteractive({ useHandCursor: true }).setColor("#cc88ff").setText("⬡  CLAIM VI TOKENS");
        this.claimStatusText?.setText("MetaMask not found or request denied").setColor("#ff4444");
        return;
      }

      this.claimBtn.setColor("#666666").setText("⬡  PENDING TX...");
      this.claimStatusText?.setText("Submitting transaction to GameVault...").setColor("#ffaa44");

      const txHash = await submitClaim({
        finalMass:  payload.finalMass,
        nonce:      payload.nonce,
        signature:  payload.signature,
      });

      this.claimBtn.setColor("#00ff88").setText("✓  CLAIMED!");
      this.claimStatusText?.setText(`TX: ${txHash.slice(0, 22)}...`).setColor("#00ff88");
      console.log("[Claim] Success:", txHash);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.claimBtn?.setInteractive({ useHandCursor: true }).setColor("#cc88ff").setText("⬡  RETRY CLAIM");
      this.claimStatusText?.setText(`Error: ${msg.slice(0, 44)}`).setColor("#ff4444");
      console.error("[Claim] Error:", err);
    }
  }

  update(_time: number, delta: number) {
    this.t += delta * 0.001;

    // Animated stars
    this.starGfx.clear();
    for (const s of this.stars) {
      s.y += s.speed;
      if (s.y > this.cameras.main.height) s.y = 0;
      const twinkle = 0.75 + 0.25 * Math.sin(this.t * s.twinkleSpeed + s.twinklePhase);
      this.starGfx.fillStyle(s.color, s.alpha * twinkle);
      this.starGfx.fillCircle(s.x, s.y, s.r);
    }

    // Outcome text glow pulse
    if (this.outcomeText) {
      this.outcomePulse += delta * 0.003;
      const pulse = 0.85 + 0.15 * Math.sin(this.outcomePulse * 2.0);
      const glowColor = this.outcomeSurvived ? "#00ff88" : "#ff3300";
      this.outcomeText.setShadow(0, 0, glowColor, 8 + pulse * 10, true, true);
      this.outcomeText.setAlpha(0.90 + 0.10 * pulse);
    }
  }
}
