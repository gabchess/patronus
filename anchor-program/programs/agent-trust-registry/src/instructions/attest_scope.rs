use anchor_lang::prelude::*;
use crate::constants::{AGENT_REGISTRY_SEED, AGENT_SCOPE_SEED};
use crate::error::ErrorCode;
use crate::state::{AgentRegistry, AgentScope};

/// Attests a scope for a registered agent, creating an AgentScope PDA.
/// The scope names exactly which Solana program and which instruction bitmask
/// the agent may sign, with an optional expiry.
///
/// This is the Patronus AgentScope issuance: the authority attests what the agent
/// may sign. Composable with SAS as an enforcement layer on top.
#[derive(Accounts)]
#[instruction(scope_seed: [u8; 32], allowed_program_id: Pubkey, instructions_allowed_mask: u64, expiry: i64)]
pub struct AttestScope<'info> {
    /// The protocol authority that issued the AgentRegistry. Must match registry.authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The AgentRegistry PDA for the agent being scoped.
    /// Seeds: ["agent_registry", authority, agent_registry.agent_pubkey]
    #[account(
        seeds = [AGENT_REGISTRY_SEED, authority.key().as_ref(), agent_registry.agent_pubkey.as_ref()],
        bump = agent_registry.bump,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub agent_registry: Account<'info, AgentRegistry>,

    /// The AgentScope PDA being created.
    /// Seeds: ["agent_scope", agent_registry, scope_seed]
    #[account(
        init,
        payer = authority,
        space = AgentScope::LEN,
        seeds = [AGENT_SCOPE_SEED, agent_registry.key().as_ref(), scope_seed.as_ref()],
        bump
    )]
    pub agent_scope: Account<'info, AgentScope>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AttestScope>,
    _scope_seed: [u8; 32],
    allowed_program_id: Pubkey,
    instructions_allowed_mask: u64,
    expiry: i64,
) -> Result<()> {
    // Checks: expiry must be 0 (no expiry) or a future timestamp
    let now = Clock::get()?.unix_timestamp;
    if expiry != 0 && expiry <= now {
        return Err(ErrorCode::ScopeExpired.into());
    }

    // Effects
    let scope = &mut ctx.accounts.agent_scope;
    scope.agent_registry = ctx.accounts.agent_registry.key();
    scope.allowed_program_id = allowed_program_id;
    scope.instructions_allowed_mask = instructions_allowed_mask;
    scope.expiry = expiry;
    scope.revoked = false;
    scope.bump = ctx.bumps.agent_scope;

    emit!(ScopeAttested {
        agent_registry: scope.agent_registry,
        allowed_program_id: scope.allowed_program_id,
        instructions_allowed_mask: scope.instructions_allowed_mask,
        expiry: scope.expiry,
    });

    Ok(())
}

#[event]
pub struct ScopeAttested {
    pub agent_registry: Pubkey,
    pub allowed_program_id: Pubkey,
    pub instructions_allowed_mask: u64,
    pub expiry: i64,
}
