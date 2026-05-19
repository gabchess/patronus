use anchor_lang::prelude::*;
use crate::constants::{AGENT_REGISTRY_SEED, AGENT_SCOPE_SEED};
use crate::error::ErrorCode;
use crate::state::{AgentRegistry, AgentScope};

/// Revokes an AgentScope, permanently setting revoked = true in a single transaction.
/// Authority-signed: only the registry authority can revoke.
/// This is Patronus' governance kill switch: one Solana tx from any authority-controlled
/// multisig instantly voids the agent's scope.
#[derive(Accounts)]
#[instruction(scope_seed: [u8; 32])]
pub struct Revoke<'info> {
    /// The protocol authority. Must match agent_registry.authority.
    pub authority: Signer<'info>,

    /// The AgentRegistry PDA.
    /// Seeds: ["agent_registry", authority, agent_registry.agent_pubkey]
    #[account(
        seeds = [AGENT_REGISTRY_SEED, authority.key().as_ref(), agent_registry.agent_pubkey.as_ref()],
        bump = agent_registry.bump,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub agent_registry: Account<'info, AgentRegistry>,

    /// The AgentScope PDA being revoked.
    /// Seeds: ["agent_scope", agent_registry, scope_seed]
    #[account(
        mut,
        seeds = [AGENT_SCOPE_SEED, agent_registry.key().as_ref(), scope_seed.as_ref()],
        bump = agent_scope.bump,
        constraint = !agent_scope.revoked @ ErrorCode::ScopeAlreadyRevoked,
    )]
    pub agent_scope: Account<'info, AgentScope>,
}

pub fn handler(ctx: Context<Revoke>, _scope_seed: [u8; 32]) -> Result<()> {
    // CEI: checks done above by constraints
    // Effects: set revoked = true (permanent; no undo path by design)
    let scope = &mut ctx.accounts.agent_scope;
    scope.revoked = true;

    emit!(ScopeRevoked {
        agent_registry: scope.agent_registry,
        allowed_program_id: scope.allowed_program_id,
        revoked_at: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct ScopeRevoked {
    pub agent_registry: Pubkey,
    pub allowed_program_id: Pubkey,
    pub revoked_at: i64,
}
