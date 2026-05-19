#![allow(ambiguous_glob_reexports)]

pub mod attest_scope;
pub mod register_agent;
pub mod revoke;

// Glob re-exports for Anchor #[program] macro compatibility.
// The 'handler' name collision is suppressed: each module's handler
// is invoked via qualified path in lib.rs (e.g. register_agent::handler).
pub use attest_scope::*;
pub use register_agent::*;
pub use revoke::*;
