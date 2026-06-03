import { ethers } from "ethers";

// Minimal ABI — only the functions we call client-side
const GAME_VAULT_ABI = [
  "function claim(uint256 finalAmount, uint256 nonce, bytes calldata signature) external",
  "function restake(uint256 finalAmount, uint256 nonce, bytes calldata signature, uint8 newTier) external",
  "function stakeForTier(uint8 tier) external",
  "function tierAmount(uint8 tier) external pure returns (uint256)",
];

const VI_TOKEN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
];

const VAULT_ADDRESS: string =
  (import.meta as any).env?.VITE_GAME_VAULT_ADDRESS ?? "";

const VI_TOKEN_ADDRESS: string =
  (import.meta as any).env?.VITE_VI_TOKEN_ADDRESS ?? "";

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

/**
 * Approve VI tokens for the vault and stake for a tier in two sequential txs.
 * Shows MetaMask twice: once for approve, once for stakeForTier.
 * Returns the stakeForTier transaction hash on success.
 * Throws if contracts not configured, MetaMask absent, or user rejects.
 */
export async function approveAndStake(tier: number, onProgress?: (step: 1 | 2) => void): Promise<string> {
  if (!VAULT_ADDRESS) throw new Error("VITE_GAME_VAULT_ADDRESS not configured");
  if (!VI_TOKEN_ADDRESS) throw new Error("VITE_VI_TOKEN_ADDRESS not configured");

  const eth = (window as any).ethereum;
  if (!eth) throw new Error("MetaMask not found");

  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();

  const vault = new ethers.Contract(VAULT_ADDRESS, GAME_VAULT_ABI, signer);
  const token = new ethers.Contract(VI_TOKEN_ADDRESS, VI_TOKEN_ABI, signer);

  // Fetch the exact tier amount from the contract so client/contract stay in sync
  const amount: bigint = await vault.tierAmount(tier);

  // Step 1: approve vault to spend the stake amount
  onProgress?.(1);
  const approveTx = await token.approve(VAULT_ADDRESS, amount);
  await approveTx.wait();

  // Step 2: stake (transfers tokens into vault)
  onProgress?.(2);
  const stakeTx = await vault.stakeForTier(tier);
  await stakeTx.wait();

  return stakeTx.hash as string;
}
