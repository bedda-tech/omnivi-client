import { useRef, useEffect, useState } from "react";
import { IRefPhaserGame, PhaserGame } from "./game/PhaserGame";
import { MainMenu } from "./game/scenes/MainMenu";
import { submitClaim, ClaimPayload } from "./game/blockchain/ClaimClient";

function App() {
  const phaserRef = useRef<IRefPhaserGame | null>(null);
  const [pendingClaim, setPendingClaim] = useState<ClaimPayload | null>(null);
  const [claimStatus, setClaimStatus] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [claimTx, setClaimTx] = useState<string>("");

  useEffect(() => {
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<ClaimPayload>).detail;
      setPendingClaim(payload);
      setClaimStatus("idle");
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

  const changeScene = () => {
    if (phaserRef.current) {
      const scene = phaserRef.current.scene as MainMenu;
      if (scene) scene.changeScene();
    }
  };

  const currentScene = (scene: Phaser.Scene) => {
    console.log("App -> scene", scene);
  };

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
          background: "rgba(0,0,0,0.85)", border: "2px solid #00ffaa",
          borderRadius: 12, padding: "18px 28px", zIndex: 9999,
          color: "#fff", fontFamily: "monospace", textAlign: "center",
          minWidth: 300,
        }}>
          {claimStatus === "done" ? (
            <>
              <div style={{ color: "#00ffaa", fontSize: 18, marginBottom: 8 }}>Tokens Claimed!</div>
              <div style={{ fontSize: 11, color: "#aaa", wordBreak: "break-all" }}>tx: {claimTx}</div>
              <button onClick={() => setPendingClaim(null)}
                style={{ marginTop: 12, padding: "6px 18px", background: "#333", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                Dismiss
              </button>
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
              <div style={{ color: "#ccc", fontSize: 13, marginBottom: 14 }}>
                Claim your VI token winnings on-chain
              </div>
              <button onClick={handleClaim} disabled={claimStatus === "pending"}
                style={{ padding: "10px 28px", background: "#00ffaa", color: "#000", border: "none", borderRadius: 8, cursor: claimStatus === "pending" ? "wait" : "pointer", fontWeight: "bold", fontSize: 15 }}>
                {claimStatus === "pending" ? "Claiming…" : "Claim VI Tokens"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
