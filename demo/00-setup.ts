/**
 * demo/00-setup.ts
 *
 * Loads the deployer keypair, generates a fresh agent keypair for the demo run,
 * derives the target (recipient) account, and logs all addresses so the remaining
 * scripts can pick them up from the shared state file at demo/.demo-state.json.
 *
 * Run: npx ts-node --project tsconfig.demo.json demo/00-setup.ts
 */

import * as fs from "fs";
import * as path from "path";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";

const PROGRAM_ID = "7p132Pbb94oeDpuBA82jceYY7zqnbhEFbuzwTpwx2pMt";
const DEVNET_RPC = "https://api.devnet.solana.com";
const STATE_FILE = path.join(__dirname, ".demo-state.json");
const AGENT_KEYPAIR_FILE = path.join(__dirname, ".demo-agent-keypair.json");

async function main() {
  console.log("=== Patronus Demo: 00-setup ===");
  console.log("Network: devnet");
  console.log("Program ID:", PROGRAM_ID);

  // Load deployer keypair (protocol authority)
  const keypairPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const deployerRaw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const deployer = Keypair.fromSecretKey(new Uint8Array(deployerRaw));
  console.log("\nAuthority (deployer):", deployer.publicKey.toBase58());

  // Generate a fresh agent keypair for this demo run
  const agentKeypair = Keypair.generate();
  console.log("Agent keypair:       ", agentKeypair.publicKey.toBase58());

  // Persist agent keypair so subsequent scripts can load it
  fs.writeFileSync(
    AGENT_KEYPAIR_FILE,
    JSON.stringify(Array.from(agentKeypair.secretKey))
  );
  console.log("Agent keypair saved: ", AGENT_KEYPAIR_FILE);

  // Target account: a deterministic address for demo SOL transfer (rebalance step)
  // Using a well-known devnet address (Solana Foundation) as placeholder target
  const targetAccount = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  console.log("Target account:      ", targetAccount.toBase58());

  // Scope URI used across demos
  const SCOPE_URI = "patronus://demo/rebalance-v1";
  console.log("Scope URI:           ", SCOPE_URI);

  // Check deployer balance
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const balanceLamports = await connection.getBalance(deployer.publicKey);
  const balanceSol = balanceLamports / LAMPORTS_PER_SOL;
  console.log("\nDeployer balance:    ", balanceSol.toFixed(4), "SOL");

  if (balanceSol < 0.1) {
    console.error("ERROR: Deployer balance too low. Run: solana airdrop 2 --url devnet");
    process.exit(1);
  }

  // Derive AgentRegistry PDA
  const AGENT_REGISTRY_SEED = Buffer.from("agent_registry");
  const [agentRegistryPda] = PublicKey.findProgramAddressSync(
    [AGENT_REGISTRY_SEED, deployer.publicKey.toBuffer(), agentKeypair.publicKey.toBuffer()],
    new PublicKey(PROGRAM_ID)
  );
  console.log("\nAgentRegistry PDA:   ", agentRegistryPda.toBase58());

  // Derive AgentScope PDA (scope seed = first 32 bytes of scope URI UTF-8)
  const AGENT_SCOPE_SEED = Buffer.from("agent_scope");
  const scopeSeedBuf = Buffer.alloc(32);
  Buffer.from(SCOPE_URI, "utf8").copy(scopeSeedBuf);
  const [agentScopePda] = PublicKey.findProgramAddressSync(
    [AGENT_SCOPE_SEED, agentRegistryPda.toBuffer(), scopeSeedBuf],
    new PublicKey(PROGRAM_ID)
  );
  console.log("AgentScope PDA:      ", agentScopePda.toBase58());

  // Write shared state for subsequent scripts
  const state = {
    network: "devnet",
    programId: PROGRAM_ID,
    authority: deployer.publicKey.toBase58(),
    agentPubkey: agentKeypair.publicKey.toBase58(),
    agentRegistryPda: agentRegistryPda.toBase58(),
    agentScopePda: agentScopePda.toBase58(),
    targetAccount: targetAccount.toBase58(),
    scopeUri: SCOPE_URI,
    setupAt: new Date().toISOString(),
    txHashes: {
      registerAgent: null,
      attestScope: null,
      rebalanceSuccess: null,
      revoke: null,
    },
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log("\nState written to:    ", STATE_FILE);
  console.log("\n[00-setup] DONE");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
