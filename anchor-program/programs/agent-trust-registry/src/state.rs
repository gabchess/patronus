use anchor_lang::prelude::*;

/// AgentRegistry PDA: one per agent, keyed by protocol authority + agent pubkey.
/// Seed: ["agent_registry", authority, agent_pubkey]
#[account]
#[derive(Default)]
pub struct AgentRegistry {
    /// The protocol authority (multisig or wallet) that registered this agent.
    pub authority: Pubkey,
    /// The agent's signing keypair pubkey.
    pub agent_pubkey: Pubkey,
    /// Unix timestamp when this agent was registered.
    pub registered_at: i64,
    /// PDA bump.
    pub bump: u8,
}

impl AgentRegistry {
    /// Space: discriminator (8) + authority (32) + agent_pubkey (32) + registered_at (8) + bump (1)
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1;
}

/// AgentScope PDA: one per (agent_registry, scope_uri). Encodes what a registered
/// agent may sign: which Solana program and which instruction discriminator bitmask.
///
/// This is Patronus' AgentScope primitive -- the onchain attestation that names
/// what an agent may sign for. Sibling to SAS attestations; enforcement is Patronus'
/// contribution on top of the attestation primitive.
///
/// Seed: ["agent_scope", agent_registry_pubkey, scope_uri_hash (first 32 bytes)]
#[account]
#[derive(Default)]
pub struct AgentScope {
    /// The AgentRegistry this scope is tied to.
    pub agent_registry: Pubkey,
    /// The Solana program this scope permits interactions with.
    pub allowed_program_id: Pubkey,
    /// Bitmask of allowed instruction discriminators (64 instructions max per scope).
    pub instructions_allowed_mask: u64,
    /// Unix timestamp when this scope expires. 0 = no expiry.
    pub expiry: i64,
    /// True if governance has revoked this scope. Revocation is permanent per scope.
    pub revoked: bool,
    /// PDA bump.
    pub bump: u8,
}

impl AgentScope {
    /// Space: discriminator (8) + agent_registry (32) + allowed_program_id (32)
    ///        + instructions_allowed_mask (8) + expiry (8) + revoked (1) + bump (1)
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1 + 1;
}
