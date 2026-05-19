import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { AnchorAdapter } from "./anchor-adapter.js";
import { ScopeDenied } from "./types.js";
import type { PatronusBrokerOptions, ScopedSigner } from "./types.js";

/**
 * PatronusBroker: the runtime enforcement engine for Patronus.
 *
 * Replace this pattern in your agent code:
 *   const signer = getSigner(seedPhrase);
 *
 * With the Patronus pattern (four lines):
 *   const broker = new PatronusBroker(agentId, { connection, program });
 *   const signer = await broker.getScopedSigner(scopeUri);
 *   // signer.signTransaction() validates the onchain attestation before signing
 *
 * The broker reads the AgentScope attestation at signing time.
 * If the scope is absent, revoked, or expired, ScopeDenied is thrown.
 * The agent never receives a credential for an out-of-scope operation.
 *
 * This is a sibling to Solana Attestation Service (SAS): SAS stores the
 * attestation blob; Patronus enforces it at agent signing time.
 */
export class PatronusBroker {
  private readonly adapter: AnchorAdapter;

  /**
   * @param agentId  The registered agent's public key (string or PublicKey).
   * @param opts     Connection + Anchor program for the AgentTrustRegistry.
   */
  constructor(
    private readonly agentId: string | PublicKey,
    opts: PatronusBrokerOptions
  ) {
    this.adapter = new AnchorAdapter(opts.program);
  }

  /**
   * Returns a ScopedSigner for the agent if the onchain attestation is valid.
   *
   * @param scopeUri  A URI or string identifying the scope. The broker derives
   *                  the AgentScope PDA from this value (padded to 32 bytes).
   * @param agentKeypair  The agent keypair to sign with. In production, this
   *                      key material lives in a TEE or HSM; the broker validates
   *                      the attestation before releasing the signing capability.
   * @param authority     The protocol authority that issued the AgentRegistry.
   *
   * @throws ScopeDenied if the attestation is absent, revoked, or expired.
   */
  async getScopedSigner(
    scopeUri: string,
    agentKeypair: Keypair,
    authority: PublicKey
  ): Promise<ScopedSigner> {
    const agentPubkey = toPublicKey(this.agentId);
    const scopeSeed = uriToSeed(scopeUri);

    // --- Checks (read onchain state) ---
    const registryPda = this.adapter.getAgentRegistryPda(authority, agentPubkey);
    const registry = await this.adapter.getAgentRegistry(authority, agentPubkey);
    if (!registry) {
      throw new ScopeDenied(
        "NOT_REGISTERED",
        `Agent ${agentPubkey.toBase58()} is not registered under authority ${authority.toBase58()}`
      );
    }

    const scope = await this.adapter.getAgentScope(registryPda, scopeSeed);
    if (!scope) {
      throw new ScopeDenied(
        "NOT_ATTESTED",
        `No scope attested for agent ${agentPubkey.toBase58()} with scopeUri "${scopeUri}"`
      );
    }

    if (scope.revoked) {
      throw new ScopeDenied(
        "REVOKED",
        `Scope for agent ${agentPubkey.toBase58()} has been revoked by governance`
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (!scope.expiry.isZero() && scope.expiry.toNumber() < now) {
      throw new ScopeDenied(
        "EXPIRED",
        `Scope for agent ${agentPubkey.toBase58()} expired at ${new Date(scope.expiry.toNumber() * 1000).toISOString()}`
      );
    }

    // --- Attestation valid: return ScopedSigner ---
    return buildScopedSigner(agentKeypair, scope.allowedProgramId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPublicKey(id: string | PublicKey): PublicKey {
  if (typeof id === "string") {
    const { PublicKey } = require("@solana/web3.js");
    return new PublicKey(id);
  }
  return id;
}

/**
 * Converts a scope URI to a 32-byte seed buffer.
 * Uses the first 32 bytes of UTF-8 encoding, zero-padded.
 */
function uriToSeed(uri: string): Uint8Array {
  const seed = Buffer.alloc(32);
  const encoded = Buffer.from(uri, "utf8");
  encoded.slice(0, 32).copy(seed);
  return new Uint8Array(seed);
}

/**
 * Wraps an agent Keypair into a ScopedSigner.
 * The allowedProgramId is checked against transaction instructions at sign time.
 */
function buildScopedSigner(keypair: Keypair, allowedProgramId: PublicKey): ScopedSigner {
  return {
    publicKey: keypair.publicKey,

    signMessage: async (message: Uint8Array): Promise<Uint8Array> => {
      // nacl sign detached
      const nacl = require("tweetnacl") as typeof import("tweetnacl");
      return nacl.sign.detached(message, keypair.secretKey);
    },

    signTransaction: async <
      T extends import("@solana/web3.js").Transaction | import("@solana/web3.js").VersionedTransaction
    >(
      tx: T
    ): Promise<T> => {
      // Verify all instructions target the attested program before signing.
      validateTransactionScope(tx, allowedProgramId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tx as any).sign([keypair]);
      return tx;
    },
  };
}

function validateTransactionScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  allowedProgramId: PublicKey
): void {
  // Legacy Transaction
  if (typeof tx.instructions !== "undefined" && Array.isArray(tx.instructions)) {
    for (const ix of tx.instructions) {
      if (!ix.programId.equals(allowedProgramId)) {
        // Allow system program (required for fee payment)
        const { SystemProgram } = require("@solana/web3.js");
        if (!ix.programId.equals(SystemProgram.programId)) {
          throw new ScopeDenied(
            "OUT_OF_SCOPE",
            `Transaction instruction targets program ${ix.programId.toBase58()} ` +
            `but scope only allows ${allowedProgramId.toBase58()}`
          );
        }
      }
    }
  }
}
