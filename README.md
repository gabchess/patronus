# Patronus

Onchain-attested, runtime-scoped credentials for AI agents on Solana DeFi.

Patronus gives AI agents a credential layer: before an agent can sign a transaction, it must prove an onchain attestation exists granting it access to that exact scope. No attestation, no signature.

Solana Attestation Service (SAS) is the ledger. Patronus is the enforcement engine. SAS stores the `AgentScope` blob onchain; the Patronus broker reads it at signing time and refuses to release a signing key if the scope is absent, revoked, or expired. These two systems compose: Patronus does not replace SAS, it sits on top of it.

## Quick start

```bash
npm install @patronus/sdk
```

Replace the raw keypair pattern in your agent code:

```typescript
// Before: raw signer, no scope enforcement
const signer = new Connection(rpc).getSigner(seedPhrase);

// After: Patronus broker enforces the onchain attestation before signing
const broker = new PatronusBroker(agentId, { connection, program });
const signer = await broker.getScopedSigner(scopeUri, agentKeypair, authority);
// signer.signTransaction() validates the AgentScope attestation at signing time
```

If the scope is absent, revoked, or expired, `getScopedSigner` throws `ScopeDenied` and the agent never receives a credential for that operation.

## Architecture

The Anchor program exposes three instructions: `register_agent`, `attest_scope`, and `revoke`. `register_agent` creates an `AgentRegistry` account for a (authority, agent) pair. `attest_scope` writes an `AgentScope` account naming the allowed program ID, instruction bitmask, and optional expiry timestamp. `revoke` permanently sets `revoked = true` on a scope.

The SDK `PatronusBroker` reads the `AgentScope` PDA at signing time. If the scope is missing or invalid, `ScopeDenied` is thrown before the keypair is used. The agent receives a `ScopedSigner` only after the attestation passes all checks: registered, attested, not revoked, not expired.

## Repo layout

```
anchor-program/   Anchor program (register_agent, attest_scope, revoke)
sdk/              TypeScript broker SDK (@patronus/sdk on npm)
```

## Status

Devnet-targeted build. Submitted to TAIKAI Hackanation 2026.

See submission video and TAIKAI listing for full pitch and demo context.

## License

MIT
