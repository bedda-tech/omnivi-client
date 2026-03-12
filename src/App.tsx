import { useRef, useEffect, useState } from "react";
import { IRefPhaserGame, PhaserGame } from "./game/PhaserGame";
import { MainMenu } from "./game/scenes/MainMenu";
import { submitClaim, submitRestake, ClaimPayload } from "./game/blockchain/ClaimClient";
import { TIER_INFO, getStoredTier, setStoredTier } from "./game/NetworkManager";

// Demo token price — same as VI_PRICE_USD in Main.ts
const VI_PRICE_USD = 0.05;

/** Format wei string (18-decimal BigInt) to VI float */
function weiToVI(weiStr: string): number {
  try {
    const wei = BigInt(weiStr);
    return Number(wei) / 1e18;
  } catch {
    return 0;
  }
}

function App() {
  const phaserRef = useRef<IRefPhaserGame | null>(null);
  const [pendingClaim, setPendingClaim] = useState<ClaimPayload | null>(null);
  const [claimStatus, setClaimStatus] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [claimTx, setClaimTx] = useState<string>("");
  // Tier selected for re-stake (persisted; default from localStorage)
  const [restakeTier, setRestakeTier] = useState<number>(getStoredTier);
  const [restakeStatus, setRestakeStatus] = useState<"idle" | "pending" | "done" | "error">("idle");

  useEffect(() => {
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<ClaimPayload>).detail;
      setPendingClaim(payload);
      setClaimStatus("idle");
      setRestakeStatus("idle");
    };
    window.addEventListener("omnivi:claim_ready", handler);
    return () => window.removeEventListener("omnivi:claim_ready", handler);
  }, []);

  const handleClaim = async () => {
    if (!pendingClaim) return;
    setClaimStatus("pending");
    try {
      const txHash = await submitClaim(pendingClaim);
      setClaimTx(txHash);
      setClaimStatus("done");
    } catch (err) {
      console.error("[Claim] Failed:", err);
      setClaimStatus("error");
    }
  };

  const handleRestake = async (tier: number) => {
    if (!pendingClaim) return;
    setRestakeTier(tier);
    setStoredTier(tier);
    setRestakeStatus("pending");
    try {
      await submitRestake(pendingClaim, tier);
      setRestakeStatus("done");
      setPendingClaim(null);
      // Signal the Phaser scene to restart with the new tier
      window.dispatchEvent(new CustomEvent("omnivi:restake_done"));
    } catch (err) {
      console.error("[Restake] Failed:", err);
      setRestakeStatus("error");
    }
  };

  const changeScene = () => {
    if (phaserRef.current) {
      const scene = phaserRef.current.scene as MainMenu;
      if (scene) scene.changeScene();
    }
  };

  const currentScene = (scene: Phaser.Scene) => {
    console.log("App -> scene", scene);
  };

  // Compute payout display from claim payload
  const payoutVI  = pendingClaim ? weiToVI(pendingClaim.finalMass) : 0;
  const payoutUSD = payoutVI * VI_PRICE_USD;

  return (
    <div id="app">
      <PhaserGame ref={phaserRef} currentActiveScene={currentScene} />
      <div>
        <div>
          <button className="button" onClick={changeScene}>
            Change Scene
          </button>
        </div>
      </div>

      {/* On-chain claim overlay — shown after server sends a signed claim */}
      {pendingClaim && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.90)", border: "2px solid #00ffaa",
          borderRadius: 12, padding: "20px 32px", zIndex: 9999,
          color: "#fff", fontFamily: "monospace", textAlign: "center",
          minWidth: 340,
        }}>
          {claimStatus === "done" ? (
            <>
              <div style={{ color: "#00ffaa", fontSize: 18, marginBottom: 8 }}>Tokens Claimed!</div>
              <div style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}>
                ${payoutUSD.toFixed(2)} ({payoutVI.toFixed(2)} VI) sent to your wallet
              </div>
              <div style={{ fontSize: 11, color: "#666", wordBreak: "break-all", marginBottom: 10 }}>tx: {claimTx}</div>
              {/* Tier selector + instant re-stake */}
              <div style={{ marginBottom: 10, fontSize: 12, color: "#aaa" }}>Re-enter the arena:</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12 }}>
                {TIER_INFO.map((t, i) => (
                  <button key={i} onClick={() => { setRestakeTier(i); setStoredTier(i); }}
                    style={{
                      padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                      background: restakeTier === i ? "#00ffaa" : "#222",
                      color: restakeTier === i ? "#000" : "#aaa",
                      border: restakeTier === i ? "2px solid #00ffaa" : "2px solid #444",
                      fontWeight: restakeTier === i ? "bold" : "normal",
                    }}>
                    {t.label}<br/>${(t.viCost * VI_PRICE_USD).toFixed(2)}
                  </button>
                ))}
              </div>
              <button onClick={() => handleRestake(restakeTier)} disabled={restakeStatus === "pending"}
                style={{ padding: "8px 22px", background: "#00ffaa", color: "#000", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: "bold", fontSize: 14, marginRight: 8 }}>
                {restakeStatus === "pending" ? "Staking…" : `⚡ Re-stake ${TIER_INFO[restakeTier].viCost} VI`}
              </button>
              <button onClick={() => setPendingClaim(null)}
                style={{ padding: "8px 16px", background: "#333", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
                Dismiss
              </button>
              {restakeStatus === "error" && (
                <div style={{ color: "#ff5500", fontSize: 12, marginTop: 8 }}>Re-stake failed — check console</div>
              )}
            </>
          ) : claimStatus === "error" ? (
            <>
              <div style={{ color: "#ff5500", fontSize: 16, marginBottom: 8 }}>Claim Failed</div>
              <div style={{ color: "#aaa", fontSize: 12, marginBottom: 10 }}>Check console for details</div>
              <button onClick={handleClaim}
                style={{ padding: "8px 24px", background: "#00ffaa", color: "#000", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: "bold" }}>
                Retry
              </button>
              <button onClick={() => setPendingClaim(null)}
                style={{ marginLeft: 10, padding: "8px 16px", background: "#333", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              <div style={{ color: "#00ffaa", fontSize: 18, marginBottom: 4 }}>You Escaped!</div>
              <div style={{ color: "#ffdd00", fontSize: 22, fontWeight: "bold", marginBottom: 4 }}>
                ${payoutUSD.toFixed(2)}
              </div>
              <div style={{ color: "#888", fontSize: 12, marginBottom: 14 }}>
                {payoutVI.toFixed(2)} VI tokens · 3% rake deducted on-chain
              </div>

              {/* Tier selector */}
              <div style={{ marginBottom: 10, fontSize: 12, color: "#aaa" }}>Choose re-stake tier:</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 14 }}>
                {TIER_INFO.map((t, i) => (
                  <button key={i} onClick={() => { setRestakeTier(i); setStoredTier(i); }}
                    style={{
                      padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12,
                      background: restakeTier === i ? "#00ffaa" : "#1a1a1a",
                      color: restakeTier === i ? "#000" : "#bbb",
                      border: restakeTier === i ? "2px solid #00ffaa" : "2px solid #444",
                      fontWeight: restakeTier === i ? "bold" : "normal",
                    }}>
                    {t.label}<br/>
                    <span style={{ color: restakeTier === i ? "#000" : "#888" }}>
                      ${(t.viCost * VI_PRICE_USD).toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>

              {/* Primary: claim + re-stake in one click */}
              <button onClick={() => handleRestake(restakeTier)}
                disabled={restakeStatus === "pending"}
                style={{ padding: "11px 26px", background: "#00ffaa", color: "#000", border: "none", borderRadius: 8, cursor: restakeStatus === "pending" ? "wait" : "pointer", fontWeight: "bold", fontSize: 15, marginRight: 10 }}>
                {restakeStatus === "pending" ? "Processing…" : `⚡ Re-stake & Play  (${TIER_INFO[restakeTier].viCost} VI)`}
              </button>

              {/* Secondary: claim only */}
              <button onClick={handleClaim} disabled={claimStatus === "pending"}
                style={{ padding: "11px 20px", background: "#222", color: "#00ffaa", border: "2px solid #00ffaa", borderRadius: 8, cursor: claimStatus === "pending" ? "wait" : "pointer", fontWeight: "bold", fontSize: 13 }}>
                {claimStatus === "pending" ? "Claiming…" : "Claim & Exit"}
              </button>

              {restakeStatus === "error" && (
                <div style={{ color: "#ff5500", fontSize: 12, marginTop: 8 }}>Re-stake failed — check console</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
