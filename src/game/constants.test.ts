import { describe, it, expect } from "vitest";
import { RAKE_PCT, NET_AFTER_RAKE } from "./constants";

describe("rake economy constants", () => {
  it("NET_AFTER_RAKE is the complement of RAKE_PCT (must agree with GameVault.sol RAKE_BPS)", () => {
    expect(NET_AFTER_RAKE).toBeCloseTo(1 - RAKE_PCT, 10);
  });

  it("RAKE_PCT matches the on-chain rake of 3% (RAKE_BPS = 300)", () => {
    expect(RAKE_PCT).toBeCloseTo(0.03, 10);
  });
});
