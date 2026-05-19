/**
 * demo/01-register-agent.ts
 *
 * Calls the register_agent instruction on devnet, creating an AgentRegistry PDA
 * that ties the protocol authority to the demo agent keypair.
 *
 * Run: npx ts-node --project tsconfig.demo.json demo/01-register-agent.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as anchor from "@anchor-lang/core";
import { AnchorProvider, Program, setProvider, Wallet, BN } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, Connection } from "@solana/web3.js";

const STATE_FILE = path.join(__dirname, ".demo-state.json");
const AGENT_KEYPAIR_FILE = path.join(__dirname, ".demo-agent-keypair.json");
const IDL_FILE = path.join(__dirname, "../anchor-program/target/idl/agent_trust_registry.json");

async function main() {
  console.log("=== Patronus Demo: 01-register-agent ===");

  // Load shared state
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  console.log("Authority:         ", state.authority);
  console.log("Agent pubkey:      ", state.agentPubkey);
  console.log("AgentRegistry PDA: ", state.agentRegistryPda);

  // Load deployer keypair
  const keypairPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const deployerRaw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const deployer = Keypair.fromSecretKey(new Uint8Array(deployerRaw));

  // Setup Anchor provider
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(deployer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  setProvider(provider);

  // Load program
  const idl = JSON.parse(fs.readFileSync(IDL_FILE, "utf-8"));
  const program = new Program(idl, provider);

  const agentPubkey = new PublicKey(state.agentPubkey);
  const agentRegistryPda = new PublicKey(state.agentRegistryPda);

  console.log("\nSending register_agent transaction...");

  const txSig = await program.methods
    .registerAgent(agentPubkey)
    .accounts({
      authority: deployer.publicKey,
      agentRegistry: agentRegistryPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("\nTransaction signature:", txSig);
  console.log("Solscan:", `https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

  // Verify on-chain state
  const registry = await (program.account as any).agentRegistry.fetch(agentRegistryPda);
  console.log("\nAgentRegistry on-chain:");
  console.log("  authority:   ", registry.authority.toBase58());
  console.log("  agentPubkey: ", registry.agentPubkey.toBase58());
  console.log("  registeredAt:", registry.registeredAt.toString());

  // Persist tx hash
  state.txHashes.registerAgent = txSig;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log("\n[01-register-agent] DONE");
}

main().catch((err) => {
  console.error("register-agent failed:", err);
  process.exit(1);
});
