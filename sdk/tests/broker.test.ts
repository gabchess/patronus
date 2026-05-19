/**
 * broker.test.ts
 * Unit tests for PatronusBroker.getScopedSigner()
 *
 * All tests use mocked AnchorAdapter -- no localnet required.
 * The adapter is the only onchain read path; mocking it gives full
 * control over the four enforcement paths (valid, not-registered,
 * not-attested, revoked, expired).
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PatronusBroker } from "../src/broker.js";
import { AnchorAdapter } from "../src/anchor-adapter.js";
import { ScopeDenied } from "../src/types.js";
import type { AgentRegistryAccount, AgentScopeAccount, PatronusBrokerOptions } from "../src/types.js";

// ---------------------------------------------------------------------------
// Mock AnchorAdapter at the module level.
// PatronusBroker constructs AnchorAdapter internally; jest.mock replaces the
// entire class so every `new AnchorAdapter(...)` inside broker.ts returns the
// mocked instance.
// ---------------------------------------------------------------------------
jest.mock("../src/anchor-adapter.js");

const MockedAnchorAdapter = AnchorAdapter as jest.MockedClass<typeof AnchorAdapter>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a deterministic PublicKey for a given seed string. */
function pubkey(seed: string): PublicKey {
  // Hash seed to 32 bytes, keep it deterministic across test runs.
  const buf = Buffer.alloc(32);
  Buffer.from(seed).slice(0, 32).copy(buf);
  return new PublicKey(buf);
}

/** Builds a minimal valid AgentRegistryAccount stub. */
function makeRegistry(): AgentRegistryAccount {
  return {
    authority: pubkey("authority"),
    agentPubkey: pubkey("agent"),
    registeredAt: new BN(1_700_000_000),
    bump: 255,
  };
}

/** Builds a minimal valid AgentScopeAccount stub (not revoked, no expiry). */
function makeScope(overrides: Partial<AgentScopeAccount> = {}): AgentScopeAccount {
  return {
    agentRegistry: pubkey("registry"),
    allowedProgramId: pubkey("target-program"),
    instructionsAllowedMask: new BN(0xff),
    expiry: new BN(0), // 0 = no expiry
    revoked: false,
    bump: 254,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Common test fixtures
// ---------------------------------------------------------------------------

const agentKeypair = Keypair.generate();
const authority = pubkey("authority");

/** Minimal fake Anchor program object -- AnchorAdapter is fully mocked, so
 * the program value is never used internally; we pass a placeholder. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeProgramPlaceholder = {} as PatronusBrokerOptions["program"];

function makeBroker(): PatronusBroker {
  return new PatronusBroker(agentKeypair.publicKey, {
    connection: {} as PatronusBrokerOptions["connection"],
    program: fakeProgramPlaceholder,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PatronusBroker.getScopedSigner", () => {
  let mockGetAgentRegistry: jest.Mock;
  let mockGetAgentScope: jest.Mock;
  let mockGetAgentRegistryPda: jest.Mock;

  beforeEach(() => {
    // Reset mocks between tests so state does not leak.
    MockedAnchorAdapter.mockClear();

    // Stub prototype methods used by the broker.
    mockGetAgentRegistryPda = jest.fn().mockReturnValue(pubkey("registry-pda"));
    mockGetAgentRegistry = jest.fn();
    mockGetAgentScope = jest.fn();

    MockedAnchorAdapter.prototype.getAgentRegistryPda = mockGetAgentRegistryPda;
    MockedAnchorAdapter.prototype.getAgentRegistry = mockGetAgentRegistry;
    MockedAnchorAdapter.prototype.getAgentScope = mockGetAgentScope;
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("returns a ScopedSigner when attestation is valid, not revoked, not expired", async () => {
    mockGetAgentRegistry.mockResolvedValue(makeRegistry());
    mockGetAgentScope.mockResolvedValue(makeScope());

    const broker = makeBroker();
    const signer = await broker.getScopedSigner("solana:program:transfer", agentKeypair, authority);

    expect(signer).toBeDefined();
    expect(signer.publicKey.equals(agentKeypair.publicKey)).toBe(true);
    expect(typeof signer.signTransaction).toBe("function");
    expect(typeof signer.signMessage).toBe("function");
  });

  it("calls getAgentRegistry with the correct authority and agentPubkey", async () => {
    mockGetAgentRegistry.mockResolvedValue(makeRegistry());
    mockGetAgentScope.mockResolvedValue(makeScope());

    const broker = makeBroker();
    await broker.getScopedSigner("solana:program:transfer", agentKeypair, authority);

    expect(mockGetAgentRegistry).toHaveBeenCalledWith(
      authority,
      agentKeypair.publicKey
    );
  });

  // -------------------------------------------------------------------------
  // ScopeDenied: agent not registered
  // -------------------------------------------------------------------------

  it("throws ScopeDenied(NOT_REGISTERED) when getAgentRegistry returns null", async () => {
    mockGetAgentRegistry.mockResolvedValue(null);

    const broker = makeBroker();
    await expect(
      broker.getScopedSigner("solana:program:transfer", agentKeypair, authority)
    ).rejects.toThrow(ScopeDenied);

    await expect(
      broker.getScopedSigner("solana:program:transfer", agentKeypair, authority)
    ).rejects.toMatchObject({ reason: "NOT_REGISTERED" });
  });

  // -------------------------------------------------------------------------
  // ScopeDenied: scope not attested
  // -------------------------------------------------------------------------

  it("throws ScopeDenied(NOT_ATTESTED) when getAgentScope returns null", async () => {
    mockGetAgentRegistry.mockResolvedValue(makeRegistry());
    mockGetAgentScope.mockResolvedValue(null);

    const broker = makeBroker();
    await expect(
      broker.getScopedSigner("solana:program:swap", agentKeypair, authority)
    ).rejects.toThrow(ScopeDenied);

    await expect(
      broker.getScopedSigner("solana:program:swap", agentKeypair, authority)
    ).rejects.toMatchObject({ reason: "NOT_ATTESTED" });
  });

  // -------------------------------------------------------------------------
  // ScopeDenied: attestation revoked
  // -------------------------------------------------------------------------

  it("throws ScopeDenied(REVOKED) when the scope attestation is revoked", async () => {
    mockGetAgentRegistry.mockResolvedValue(makeRegistry());
    mockGetAgentScope.mockResolvedValue(makeScope({ revoked: true }));

    const broker = makeBroker();
    await expect(
      broker.getScopedSigner("solana:program:transfer", agentKeypair, authority)
    ).rejects.toThrow(ScopeDenied);

    await expect(
      broker.getScopedSigner("solana:program:transfer", agentKeypair, authority)
    ).rejects.toMatchObject({ reason: "REVOKED" });
  });

  // -------------------------------------------------------------------------
  // ScopeDenied: attestation expired
  // -------------------------------------------------------------------------

  it("throws ScopeDenied(EXPIRED) when expiry timestamp is in the past", async () => {
    // expiry = 1 second after Unix epoch -- definitely in the past
    const pastExpiry = new BN(1);
    mockGetAgentRegistry.mockResolvedValue(makeRegistry());
    mockGetAgentScope.mockResolvedValue(makeScope({ expiry: pastExpiry }));

    const broker = makeBroker();
    await expect(
      broker.getScopedSigner("solana:program:transfer", agentKeypair, authority)
    ).rejects.toThrow(ScopeDenied);

    await expect(
      broker.getScopedSigner("solana:program:transfer", agentKeypair, authority)
    ).rejects.toMatchObject({ reason: "EXPIRED" });
  });

  it("does NOT throw when expiry is zero (no expiry sentinel)", async () => {
    mockGetAgentRegistry.mockResolvedValue(makeRegistry());
    // expiry: new BN(0) = no expiry
    mockGetAgentScope.mockResolvedValue(makeScope({ expiry: new BN(0) }));

    const broker = makeBroker();
    const signer = await broker.getScopedSigner("solana:program:transfer", agentKeypair, authority);
    expect(signer).toBeDefined();
  });

  it("does NOT throw when expiry is far in the future", async () => {
    const futureExpiry = new BN(Math.floor(Date.now() / 1000) + 86400 * 365);
    mockGetAgentRegistry.mockResolvedValue(makeRegistry());
    mockGetAgentScope.mockResolvedValue(makeScope({ expiry: futureExpiry }));

    const broker = makeBroker();
    const signer = await broker.getScopedSigner("solana:program:transfer", agentKeypair, authority);
    expect(signer).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // ScopedSigner: signMessage
  // -------------------------------------------------------------------------

  it("ScopedSigner.signMessage returns a non-empty Uint8Array signature", async () => {
    mockGetAgentRegistry.mockResolvedValue(makeRegistry());
    mockGetAgentScope.mockResolvedValue(makeScope());

    const broker = makeBroker();
    const signer = await broker.getScopedSigner("solana:program:transfer", agentKeypair, authority);

    const message = Buffer.from("hello patronus");
    const sig = await signer.signMessage(message);

    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64); // nacl detached signature is always 64 bytes
  });
});
