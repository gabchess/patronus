pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

// Placeholder program ID: replace with `anchor keys list` output after first build.
// Deploy: `anchor deploy` on localnet/devnet will assign the real program ID.
declare_id!("7p132Pbb94oeDpuBA82jceYY7zqnbhEFbuzwTpwx2pMt");

#[program]
pub mod agent_trust_registry {
    use super::*;

    /// Registers an AI agent with the protocol authority.
    /// Creates an AgentRegistry PDA keyed by (authority, agent_pubkey).
    pub fn register_agent(ctx: Context<RegisterAgent>, agent_pubkey: Pubkey) -> Result<()> {
        register_agent::handler(ctx, agent_pubkey)
    }

    /// Attests an AgentScope for a registered agent.
    /// The scope names the program, instruction bitmask, and expiry the agent may sign.
    pub fn attest_scope(
        ctx: Context<AttestScope>,
        scope_seed: [u8; 32],
        allowed_program_id: Pubkey,
        instructions_allowed_mask: u64,
        expiry: i64,
    ) -> Result<()> {
        attest_scope::handler(ctx, scope_seed, allowed_program_id, instructions_allowed_mask, expiry)
    }

    /// Revokes an AgentScope in a single transaction.
    /// Sets revoked = true permanently; the broker will reject the agent's signing requests.
    pub fn revoke(ctx: Context<Revoke>, scope_seed: [u8; 32]) -> Result<()> {
        revoke::handler(ctx, scope_seed)
    }
}
