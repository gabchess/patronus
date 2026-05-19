/**
 * demo/02-attest-scope.ts
 *
 * Calls attest_scope for the registered agent, creating an AgentScope PDA that
 * names which program the agent is allowed to interact with and when it expires.
 *
 * Run: npx ts-node --project tsconfig.demo.json demo/02-attest-scope.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as anchor from "@anchor-lang/core";
import { AnchorProvider, Program, setProvider, Wallet, BN } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, Connection } from "@solana/web3.js";

const STATE_FILE = path.join(__dirname, ".demo-state.json");
const IDL_FILE = path.join(__dirname, "../anchor-program/target/idl/agent_trust_registry.json");

/** Convert scope URI to 32-byte seed array (same logic as broker.ts) */
function uriToSeedArray(uri: string): number[] {
  const seed = Buffer.alloc(32);
  Buffer.from(uri, "utf8").copy(seed);
  return Array.from(seed);
}

async function main() {
  console.log("=== Patronus Demo: 02-attest-scope ===");

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  console.log("Authority:         ", state.authority);
  console.log("AgentRegistry PDA: ", state.agentRegistryPda);
  console.log("AgentScope PDA:    ", state.agentScopePda);
  console.log("Scope URI:         ", state.scopeUri);

  // Load deployer keypair
  const keypairPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const deployerRaw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const deployer = Keypair.fromSecretKey(new Uint8Array(deployerRaw));

  // Setup provider
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(deployer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(IDL_FILE, "utf-8"));
  const program = new Program(idl, provider);

  const agentRegistryPda = new PublicKey(state.agentRegistryPda);
  const agentScopePda = new PublicKey(state.agentScopePda);

  // Scope parameters:
  // - allowed_program_id: the AgentTrustRegistry itself (demo: agent may call the registry)
  // - instructions_allowed_mask: 0b111 (first 3 instructions)
  // - expiry: 30 days from now
  const scopeSeed = uriToSeedArray(state.scopeUri);
  const allowedProgramId = new PublicKey(state.programId);
  const instructionsMask = new BN(0b111);
  const expiry = new BN(Math.floor(Date.now() / 1000) + 86400 * 30);

  console.log("\nScope parameters:");
  console.log("  allowedProgramId:       ", allowedProgramId.toBase58());
  console.log("  instructionsAllowedMask:", instructionsMask.toString());
  console.log("  expiry (unix):          ", expiry.toString(), " (~30 days from now)");

  console.log("\nSending attest_scope transaction...");

  const txSig = await program.methods
    .attestScope(
      scopeSeed,
      allowedProgramId,
      instructionsMask,
      expiry
    )
    .accounts({
      authority: deployer.publicKey,
      agentRegistry: agentRegistryPda,
      agentScope: agentScopePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("\nTransaction signature:", txSig);
  console.log("Solscan:", `https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

  // Verify on-chain state
  const scope = await (program.account as any).agentScope.fetch(agentScopePda);
  console.log("\nAgentScope on-chain:");
  console.log("  agentRegistry:          ", scope.agentRegistry.toBase58());
  console.log("  allowedProgramId:       ", scope.allowedProgramId.toBase58());
  console.log("  instructionsAllowedMask:", scope.instructionsAllowedMask.toString());
  console.log("  expiry:                 ", scope.expiry.toString());
  console.log("  revoked:                ", scope.revoked);

  // Persist tx hash and scope PDA
  state.txHashes.attestScope = txSig;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log("\n[02-attest-scope] DONE");
}

main().catch((err) => {
  console.error("attest-scope failed:", err);
  process.exit(1);
});
