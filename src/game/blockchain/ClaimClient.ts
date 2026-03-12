import { ethers } from "ethers";

// Minimal ABI — only the functions we call client-side
const GAME_VAULT_ABI = [
  "function claim(uint256 finalAmount, uint256 nonce, bytes calldata signature) external",
  "function restake(uint256 finalAmount, uint256 nonce, bytes calldata signature, uint8 newTier) external",
];

const VAULT_ADDRESS: string =
  (import.meta as any).env?.VITE_GAME_VAULT_ADDRESS ?? "";

export interface ClaimPayload {
  finalMass: string; // BigInt as decimal string (wei)
  nonce: number;
  signature: string;
}

/** Request MetaMask accounts. Returns the first account or "" if unavailable. */
export async function connectWallet(): Promise<string> {
  const eth = (window as any).ethereum;
  if (!eth) return "";
  try {
    const accounts: string[] = await eth.request({
      method: "eth_requestAccounts",
    });
    return accounts[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * Submit the server-signed claim to GameVault on-chain via MetaMask.
 * Returns the transaction hash on success.
 */
export async function submitClaim(payload: ClaimPayload): Promise<string> {
  if (!VAULT_ADDRESS) throw new Error("VITE_GAME_VAULT_ADDRESS not configured");

  const eth = (window as any).ethereum;
  if (!eth) throw new Error("MetaMask not found");

  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();
  const vault = new ethers.Contract(VAULT_ADDRESS, GAME_VAULT_ABI, signer);

  const tx = await vault.claim(payload.finalMass, payload.nonce, payload.signature);
  await tx.wait();
  return tx.hash as string;
}

/**
 * Claim winnings AND immediately re-stake for a new round in a single on-chain tx.
 * Requires the player to have pre-approved the new tier amount to the vault.
 * Returns the transaction hash on success.
 */
export async function submitRestake(payload: ClaimPayload, newTier: number): Promise<string> {
  if (!VAULT_ADDRESS) throw new Error("VITE_GAME_VAULT_ADDRESS not configured");

  const eth = (window as any).ethereum;
  if (!eth) throw new Error("MetaMask not found");

  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();
  const vault = new ethers.Contract(VAULT_ADDRESS, GAME_VAULT_ABI, signer);

  const tx = await vault.restake(payload.finalMass, payload.nonce, payload.signature, newTier);
  await tx.wait();
  return tx.hash as string;
}
