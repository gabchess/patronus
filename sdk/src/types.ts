import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";

/**
 * AgentRegistry account shape, as returned by the Anchor program.
 * One per (authority, agentPubkey) pair.
 */
export interface AgentRegistryAccount {
  authority: PublicKey;
  agentPubkey: PublicKey;
  registeredAt: BN;
  bump: number;
}

/**
 * AgentScope account shape, as returned by the Anchor program.
 *
 * This is the Patronus AgentScope attestation: the onchain record naming
 * exactly what an agent may sign. The broker reads this at signing time
 * and refuses to release a credential if revoked = true or expiry is past.
 */
export interface AgentScopeAccount {
  agentRegistry: PublicKey;
  allowedProgramId: PublicKey;
  /** Bitmask of allowed instruction discriminators (64 instructions max). */
  instructionsAllowedMask: BN;
  /** Unix timestamp. 0 = no expiry. */
  expiry: BN;
  /** True if governance has revoked this scope. Permanent. */
  revoked: boolean;
  bump: number;
}

/**
 * Options for PatronusBroker construction.
 */
export interface PatronusBrokerOptions {
  /** Solana Connection instance. */
  connection: import("@solana/web3.js").Connection;
  /** The Anchor Program instance for AgentTrustRegistry. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: import("@coral-xyz/anchor").Program<any>;
}

/**
 * A Solana Signer that is scoped to a single attested operation.
 * The PatronusBroker returns this after verifying the onchain attestation.
 */
export interface ScopedSigner {
  /** The agent's public key. */
  publicKey: PublicKey;
  /**
   * Signs a message buffer. Only valid for transactions that match the
   * attested scope (checked by the caller / program-side).
   */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  /**
   * Signs a transaction. The broker validates that the transaction's
   * program IDs are within the attested scope before signing.
   */
  signTransaction: <T extends import("@solana/web3.js").Transaction | import("@solana/web3.js").VersionedTransaction>(
    tx: T
  ) => Promise<T>;
}

/**
 * Error thrown when the broker denies a signing request:
 * - no matching attestation
 * - attestation revoked
 * - attestation expired
 * - programme ID outside attested scope
 */
export class ScopeDenied extends Error {
  constructor(
    public readonly reason: "NOT_REGISTERED" | "NOT_ATTESTED" | "REVOKED" | "EXPIRED" | "OUT_OF_SCOPE",
    message: string
  ) {
    super(message);
    this.name = "ScopeDenied";
  }
}
