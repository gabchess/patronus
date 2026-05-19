import type { PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { AgentRegistryAccount, AgentScopeAccount } from "./types.js";

/** PDA seeds matching the Anchor program constants. */
const AGENT_REGISTRY_SEED = Buffer.from("agent_registry");
const AGENT_SCOPE_SEED = Buffer.from("agent_scope");

/**
 * AnchorAdapter: reads AgentRegistry and AgentScope PDAs from the onchain program.
 *
 * This is the Patronus enforcement read path. The broker calls getAgentScope()
 * at signing time; if the result is null, revoked, or expired, the broker throws
 * ScopeDenied and the agent never receives a credential.
 */
export class AnchorAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly program: Program<any>) {}

  /**
   * Derives the AgentRegistry PDA for (authority, agentPubkey).
   */
  getAgentRegistryPda(authority: PublicKey, agentPubkey: PublicKey): PublicKey {
    const [pda] = this.program.provider.publicKey
      ? // Use the program's PublicKey.findProgramAddressSync
        findPda(
          [AGENT_REGISTRY_SEED, authority.toBuffer(), agentPubkey.toBuffer()],
          this.program.programId
        )
      : (() => { throw new Error("Program not initialized"); })();
    return pda;
  }

  /**
   * Derives the AgentScope PDA for (agentRegistry, scopeSeed).
   */
  getAgentScopePda(agentRegistry: PublicKey, scopeSeed: Uint8Array): PublicKey {
    const seed = Buffer.from(scopeSeed).slice(0, 32);
    const paddedSeed = Buffer.alloc(32);
    seed.copy(paddedSeed);
    const [pda] = findPda(
      [AGENT_SCOPE_SEED, agentRegistry.toBuffer(), paddedSeed],
      this.program.programId
    );
    return pda;
  }

  /**
   * Fetches the AgentRegistry account for an agent.
   * Returns null if the account does not exist (agent not registered).
   */
  async getAgentRegistry(
    authority: PublicKey,
    agentPubkey: PublicKey
  ): Promise<AgentRegistryAccount | null> {
    try {
      const pda = this.getAgentRegistryPda(authority, agentPubkey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const account = await (this.program.account as any).agentRegistry.fetch(pda);
      return account as AgentRegistryAccount;
    } catch (err: unknown) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  /**
   * Fetches an AgentScope account.
   * Returns null if the scope does not exist.
   */
  async getAgentScope(
    agentRegistryPda: PublicKey,
    scopeSeed: Uint8Array
  ): Promise<AgentScopeAccount | null> {
    try {
      const pda = this.getAgentScopePda(agentRegistryPda, scopeSeed);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const account = await (this.program.account as any).agentScope.fetch(pda);
      return account as AgentScopeAccount;
    } catch (err: unknown) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findPda(seeds: Buffer[], programId: PublicKey): [PublicKey, number] {
  // Dynamic import to avoid bundler issues with @solana/web3.js
  const { PublicKey } = require("@solana/web3.js");
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("Account does not exist") ||
    err.message.includes("account not found") ||
    err.message.includes("AccountNotFound") ||
    err.message.includes("Could not find")
  );
}
