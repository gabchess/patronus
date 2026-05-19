use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Agent is already registered with this authority")]
    AgentAlreadyRegistered,
    #[msg("Agent is not registered in this registry")]
    AgentNotRegistered,
    #[msg("This scope has already been revoked")]
    ScopeAlreadyRevoked,
    #[msg("This scope has expired")]
    ScopeExpired,
    #[msg("Caller is not the registry authority")]
    Unauthorized,
}
