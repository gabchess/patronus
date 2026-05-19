import * as anchor from "@anchor-lang/core";
import { Program, AnchorProvider, setProvider } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

// IDL and type imports from generated artifacts
import { AgentTrustRegistry } from "../target/types/agent_trust_registry";

const AGENT_REGISTRY_SEED = Buffer.from("agent_registry");
const AGENT_SCOPE_SEED = Buffer.from("agent_scope");

/** Derive AgentRegistry PDA */
function getAgentRegistryPda(
  authority: PublicKey,
  agentPubkey: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [AGENT_REGISTRY_SEED, authority.toBuffer(), agentPubkey.toBuffer()],
    programId
  );
}

/** Derive AgentScope PDA */
function getAgentScopePda(
  agentRegistry: PublicKey,
  scopeSeed: Uint8Array,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [AGENT_SCOPE_SEED, agentRegistry.toBuffer(), scopeSeed],
    programId
  );
}

/** Build a 32-byte scope seed from a string label */
function makeScopeSeed(label: string): number[] {
  const seed = Buffer.alloc(32);
  Buffer.from(label).copy(seed);
  return Array.from(seed);
}

describe("AgentTrustRegistry", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);

  const program = anchor.workspace.AgentTrustRegistry as Program<AgentTrustRegistry>;

  // Authority keypair = the protocol multisig (payer in tests)
  const authority = (provider.wallet as anchor.Wallet).payer;

  // A fresh agent keypair per test group
  let agentKeypair: Keypair;
  let agentRegistryPda: PublicKey;
  let agentRegistryBump: number;

  // Scope setup
  const dummyAllowedProgram = Keypair.generate().publicKey;
  const scopeSeedBytes = makeScopeSeed("test-scope-v1");
  let agentScopePda: PublicKey;

  before(async () => {
    agentKeypair = Keypair.generate();
    [agentRegistryPda, agentRegistryBump] = getAgentRegistryPda(
      authority.publicKey,
      agentKeypair.publicKey,
      program.programId
    );
    [agentScopePda] = getAgentScopePda(
      agentRegistryPda,
      Buffer.from(scopeSeedBytes),
      program.programId
    );
  });

  // ---------------------------------------------------------------------------
  // register_agent
  // ---------------------------------------------------------------------------
  describe("register_agent", () => {
    it("registers a new agent successfully", async () => {
      await program.methods
        .registerAgent(agentKeypair.publicKey)
        .accounts({
          authority: authority.publicKey,
          agentRegistry: agentRegistryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const registry = await program.account.agentRegistry.fetch(agentRegistryPda);
      assert.ok(registry.authority.equals(authority.publicKey), "authority mismatch");
      assert.ok(registry.agentPubkey.equals(agentKeypair.publicKey), "agent pubkey mismatch");
      assert.ok(registry.registeredAt.gt(new anchor.BN(0)), "registeredAt should be set");
      assert.strictEqual(registry.bump, agentRegistryBump, "bump mismatch");
    });

    it("fails to register the same agent twice (duplicate PDA)", async () => {
      try {
        await program.methods
          .registerAgent(agentKeypair.publicKey)
          .accounts({
            authority: authority.publicKey,
            agentRegistry: agentRegistryPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have thrown on duplicate PDA init");
      } catch (err: any) {
        // Anchor 1.x raises an account-already-initialized error on init conflict
        assert.ok(
          err.message?.includes("already in use") ||
          err.message?.includes("custom program error") ||
          err.logs?.some((l: string) => l.includes("already in use") || l.includes("0x0")),
          `Expected already-in-use error, got: ${err.message}`
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // attest_scope
  // ---------------------------------------------------------------------------
  describe("attest_scope", () => {
    it("attests a scope for a registered agent", async () => {
      const expiryFarFuture = new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 365);
      const mask = new anchor.BN(0b1111); // first 4 instructions allowed

      await program.methods
        .attestScope(
          scopeSeedBytes,
          dummyAllowedProgram,
          mask,
          expiryFarFuture
        )
        .accounts({
          authority: authority.publicKey,
          agentRegistry: agentRegistryPda,
          agentScope: agentScopePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const scope = await program.account.agentScope.fetch(agentScopePda);
      assert.ok(scope.agentRegistry.equals(agentRegistryPda), "agentRegistry mismatch");
      assert.ok(scope.allowedProgramId.equals(dummyAllowedProgram), "allowedProgramId mismatch");
      assert.ok(scope.instructionsAllowedMask.eq(mask), "mask mismatch");
      assert.ok(scope.expiry.eq(expiryFarFuture), "expiry mismatch");
      assert.strictEqual(scope.revoked, false, "should not be revoked");
    });

    it("fails to attest scope for an unregistered agent (wrong PDA)", async () => {
      const unknownAgent = Keypair.generate();
      const [unknownRegistry] = getAgentRegistryPda(
        authority.publicKey,
        unknownAgent.publicKey,
        program.programId
      );
      const unknownScopeSeed = makeScopeSeed("unknown-scope");
      const [unknownScopePda] = getAgentScopePda(
        unknownRegistry,
        Buffer.from(unknownScopeSeed),
        program.programId
      );

      try {
        await program.methods
          .attestScope(
            unknownScopeSeed,
            dummyAllowedProgram,
            new anchor.BN(1),
            new anchor.BN(0)
          )
          .accounts({
            authority: authority.publicKey,
            agentRegistry: unknownRegistry,
            agentScope: unknownScopePda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have thrown: unregistered agent PDA does not exist");
      } catch (err: any) {
        // The agentRegistry account does not exist, so seeds constraint or account load fails
        assert.ok(
          err.message?.includes("AccountNotInitialized") ||
          err.message?.includes("not initialized") ||
          err.message?.includes("does not exist") ||
          err.logs?.some((l: string) =>
            l.includes("AccountNotInitialized") || l.includes("not initialized")
          ),
          `Expected unregistered-agent error, got: ${err.message}`
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // revoke
  // ---------------------------------------------------------------------------
  describe("revoke", () => {
    it("revokes a valid scope", async () => {
      await program.methods
        .revoke(scopeSeedBytes)
        .accounts({
          authority: authority.publicKey,
          agentRegistry: agentRegistryPda,
          agentScope: agentScopePda,
        })
        .rpc();

      const scope = await program.account.agentScope.fetch(agentScopePda);
      assert.strictEqual(scope.revoked, true, "scope should be revoked");
    });

    it("fails when non-authority tries to revoke (wrong authority)", async () => {
      // Attest a fresh scope to have something to try revoking
      const otherAgent = Keypair.generate();
      const [otherRegistry] = getAgentRegistryPda(
        authority.publicKey,
        otherAgent.publicKey,
        program.programId
      );
      const freshSeed = makeScopeSeed("fresh-scope-revoke-test");
      const [freshScopePda] = getAgentScopePda(
        otherRegistry,
        Buffer.from(freshSeed),
        program.programId
      );

      // Register the other agent first
      await program.methods
        .registerAgent(otherAgent.publicKey)
        .accounts({
          authority: authority.publicKey,
          agentRegistry: otherRegistry,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Attest a scope for it
      await program.methods
        .attestScope(
          freshSeed,
          dummyAllowedProgram,
          new anchor.BN(1),
          new anchor.BN(0)
        )
        .accounts({
          authority: authority.publicKey,
          agentRegistry: otherRegistry,
          agentScope: freshScopePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Try to revoke with a different signer (not the authority)
      const attacker = Keypair.generate();
      // Fund attacker minimally so it can sign
      const airdropSig = await provider.connection.requestAirdrop(
        attacker.publicKey,
        0.1 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      try {
        await program.methods
          .revoke(freshSeed)
          .accounts({
            authority: attacker.publicKey,
            agentRegistry: otherRegistry,
            agentScope: freshScopePda,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Should have failed: non-authority cannot revoke");
      } catch (err: any) {
        assert.ok(
          err.message?.includes("Unauthorized") ||
          err.message?.includes("seeds constraint") ||
          err.message?.includes("ConstraintSeeds") ||
          err.message?.includes("has_one"),
          `Expected Unauthorized error, got: ${err.message}`
        );
      }
    });

    it("fails to revoke an already-revoked scope", async () => {
      // scopeSeedBytes scope was revoked in the first revoke test
      try {
        await program.methods
          .revoke(scopeSeedBytes)
          .accounts({
            authority: authority.publicKey,
            agentRegistry: agentRegistryPda,
            agentScope: agentScopePda,
          })
          .rpc();
        assert.fail("Should have thrown ScopeAlreadyRevoked");
      } catch (err: any) {
        assert.ok(
          err.message?.includes("ScopeAlreadyRevoked") ||
          err.message?.includes("already revoked") ||
          err.logs?.some((l: string) => l.includes("ScopeAlreadyRevoked")),
          `Expected ScopeAlreadyRevoked, got: ${err.message}`
        );
      }
    });

    it("post-revoke: scope.revoked is true", async () => {
      const scope = await program.account.agentScope.fetch(agentScopePda);
      assert.strictEqual(scope.revoked, true, "post-revoke scope.revoked must be true");
    });
  });
});
