/**
 * demo/05-rebalance-rejected.ts
 *
 * Post-revoke: demonstrates that PatronusBroker.getScopedSigner() now throws
 * ScopeDenied(REVOKED) and does NOT submit any transaction. This is the
 * governance kill switch working: one Solana tx from the authority voids
 * the agent's signing capability permanently.
 *
 * Expected behavior: broker.getScopedSigner() throws ScopeDenied with
 * reason="REVOKED". No tx hash is produced. The demo logs the error and
 * timestamps the rejection event.
 *
 * Run: npx ts-node --project tsconfig.demo.json demo/05-rebalance-rejected.ts
 */

import * as fs from "fs";
import * as path from "path";
import { AnchorProvider, Program, setProvider, Wallet } from "@anchor-lang/core";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";

const STATE_FILE = path.join(__dirname, ".demo-state.json");
const AGENT_KEYPAIR_FILE = path.join(__dirname, ".demo-agent-keypair.json");
const IDL_FILE = path.join(__dirname, "../anchor-program/target/idl/agent_trust_registry.json");

async function main() {
  console.log("=== Patronus Demo: 05-rebalance-rejected ===");

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  console.log("Agent pubkey: ", state.agentPubkey);
  console.log("Scope URI:    ", state.scopeUri);
  console.log("(Scope was revoked in demo step 04)");

  // Load deployer keypair
  const keypairPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const deployerRaw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const deployer = Keypair.fromSecretKey(new Uint8Array(deployerRaw));

  // Load agent keypair
  const agentRaw = JSON.parse(fs.readFileSync(AGENT_KEYPAIR_FILE, "utf-8"));
  const agentKeypair = Keypair.fromSecretKey(new Uint8Array(agentRaw));

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(deployer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(IDL_FILE, "utf-8"));
  const program = new Program(idl, provider);

  // Import PatronusBroker from the compiled SDK dist
  const { PatronusBroker } = require(path.join(__dirname, "../sdk/dist/broker.js"));

  const broker = new PatronusBroker(agentKeypair.publicKey.toBase58(), {
    connection,
    program,
  });

  console.log("\nCalling broker.getScopedSigner() on revoked scope...");

  const rejectedAt = new Date().toISOString();
  let errorMessage = "";
  let errorReason = "";

  try {
    await broker.getScopedSigner(
      state.scopeUri,
      agentKeypair,
      deployer.publicKey
    );
    // Should never reach here
    console.error("ERROR: getScopedSigner() did not throw on revoked scope. Test failed.");
    process.exit(1);
  } catch (err: any) {
    if (err && err.name === "ScopeDenied") {
      errorReason = err.reason;
      errorMessage = err.message;
      console.log("\nScopeDenied thrown as expected.");
      console.log("  reason: ", err.reason);
      console.log("  message:", err.message);
    } else {
      console.error("Unexpected error type:", err);
      process.exit(1);
    }
  }

  // Confirm the error reason is REVOKED (not some other failure)
  if (errorReason !== "REVOKED") {
    console.error(`ERROR: Expected reason=REVOKED, got reason=${errorReason}`);
    process.exit(1);
  }

  console.log("\nNo transaction submitted (broker blocked signing before any tx was built).");
  console.log("Rejection timestamp:", rejectedAt);

  // Persist rejection event
  state.rebalanceRejected = {
    error: "ScopeDenied",
    reason: errorReason,
    message: errorMessage,
    timestamp: rejectedAt,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log("\n[05-rebalance-rejected] DONE");
}

main().catch((err) => {
  console.error("rebalance-rejected failed:", err);
  process.exit(1);
});
