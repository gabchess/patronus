/**
 * demo/04-revoke.ts
 *
 * Calls the revoke instruction on devnet, permanently setting revoked=true
 * on the AgentScope PDA. After this transaction, the broker will reject all
 * signing requests for this scope.
 *
 * Run: npx ts-node --project tsconfig.demo.json demo/04-revoke.ts
 */

import * as fs from "fs";
import * as path from "path";
import { AnchorProvider, Program, setProvider, Wallet } from "@anchor-lang/core";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";

const STATE_FILE = path.join(__dirname, ".demo-state.json");
const IDL_FILE = path.join(__dirname, "../anchor-program/target/idl/agent_trust_registry.json");

/** Convert scope URI to 32-byte seed array */
function uriToSeedArray(uri: string): number[] {
  const seed = Buffer.alloc(32);
  Buffer.from(uri, "utf8").copy(seed);
  return Array.from(seed);
}

async function main() {
  console.log("=== Patronus Demo: 04-revoke ===");

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  console.log("Authority:         ", state.authority);
  console.log("AgentRegistry PDA: ", state.agentRegistryPda);
  console.log("AgentScope PDA:    ", state.agentScopePda);
  console.log("Scope URI:         ", state.scopeUri);

  // Load deployer keypair
  const keypairPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const deployerRaw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const deployer = Keypair.fromSecretKey(new Uint8Array(deployerRaw));

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(deployer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(IDL_FILE, "utf-8"));
  const program = new Program(idl, provider);

  const agentRegistryPda = new PublicKey(state.agentRegistryPda);
  const agentScopePda = new PublicKey(state.agentScopePda);
  const scopeSeed = uriToSeedArray(state.scopeUri);

  console.log("\nSending revoke transaction...");

  const txSig = await program.methods
    .revoke(scopeSeed)
    .accounts({
      authority: deployer.publicKey,
      agentRegistry: agentRegistryPda,
      agentScope: agentScopePda,
    })
    .rpc();

  console.log("\nTransaction signature:", txSig);
  console.log("Solscan:", `https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

  // Verify on-chain state shows revoked=true
  const scope = await (program.account as any).agentScope.fetch(agentScopePda);
  console.log("\nAgentScope post-revoke:");
  console.log("  revoked:", scope.revoked);

  if (!scope.revoked) {
    console.error("ERROR: scope.revoked is not true after revoke tx. Unexpected.");
    process.exit(1);
  }
  console.log("Scope revoked confirmed onchain.");

  // Persist tx hash
  state.txHashes.revoke = txSig;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log("\n[04-revoke] DONE");
}

main().catch((err) => {
  console.error("revoke failed:", err);
  process.exit(1);
});
