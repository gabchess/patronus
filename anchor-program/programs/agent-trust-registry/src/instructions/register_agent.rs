use anchor_lang::prelude::*;
use crate::constants::{AGENT_REGISTRY_SEED};
use crate::state::AgentRegistry;

/// Registers an AI agent with the protocol authority, creating an AgentRegistry PDA.
/// Authority-signed: only the protocol's authority can register an agent.
#[derive(Accounts)]
#[instruction(agent_pubkey: Pubkey)]
pub struct RegisterAgent<'info> {
    /// The protocol authority registering the agent. Signs the transaction.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The AgentRegistry PDA, one per (authority, agent_pubkey) pair.
    /// Seeds: ["agent_registry", authority, agent_pubkey]
    #[account(
        init,
        payer = authority,
        space = AgentRegistry::LEN,
        seeds = [AGENT_REGISTRY_SEED, authority.key().as_ref(), agent_pubkey.as_ref()],
        bump
    )]
    pub agent_registry: Account<'info, AgentRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterAgent>, agent_pubkey: Pubkey) -> Result<()> {
    // CEI: checks done by Anchor constraints (init will fail on duplicate PDA)
    // Effects
    let registry = &mut ctx.accounts.agent_registry;
    registry.authority = ctx.accounts.authority.key();
    registry.agent_pubkey = agent_pubkey;
    registry.registered_at = Clock::get()?.unix_timestamp;
    registry.bump = ctx.bumps.agent_registry;

    emit!(AgentRegistered {
        authority: registry.authority,
        agent_pubkey: registry.agent_pubkey,
        registered_at: registry.registered_at,
    });

    Ok(())
}

#[event]
pub struct AgentRegistered {
    pub authority: Pubkey,
    pub agent_pubkey: Pubkey,
    pub registered_at: i64,
}
