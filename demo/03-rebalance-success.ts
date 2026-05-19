/**
 * demo/03-rebalance-success.ts
 *
 * Demonstrates PatronusBroker.getScopedSigner(): the broker reads the onchain
 * AgentScope attestation, validates it is active and non-revoked, then returns
 * a ScopedSigner. The demo then uses that signer to sign a small SOL transfer
 * (0.001 SOL) from the agent keypair to the target account, submits it, and
 * logs the tx hash.
 *
 * This is the "happy path" for an AI agent operating within its attested scope.
 *
 * Run: npx ts-node --project tsconfig.demo.json demo/03-rebalance-success.ts
 */

import * as fs from "fs";
import * as path from "path";
import { AnchorProvider, Program, setProvider, Wallet } from "@anchor-lang/core";
import {
  Keypair,
  PublicKey,
  Connection,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const STATE_FILE = path.join(__dirname, ".demo-state.json");
const AGENT_KEYPAIR_FILE = path.join(__dirname, ".demo-agent-keypair.json");
const IDL_FILE = path.join(__dirname, "../anchor-program/target/idl/agent_trust_registry.json");
const DEVNET_RPC = "https://api.devnet.solana.com";

async function main() {
  console.log("=== Patronus Demo: 03-rebalance-success ===");

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  console.log("Agent pubkey:   ", state.agentPubkey);
  console.log("Scope URI:      ", state.scopeUri);
  console.log("Target account: ", state.targetAccount);

  // Load deployer keypair (authority/payer)
  const keypairPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const deployerRaw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const deployer = Keypair.fromSecretKey(new Uint8Array(deployerRaw));

  // Load agent keypair (generated in 00-setup)
  const agentRaw = JSON.parse(fs.readFileSync(AGENT_KEYPAIR_FILE, "utf-8"));
  const agentKeypair = Keypair.fromSecretKey(new Uint8Array(agentRaw));

  const connection = new Connection(DEVNET_RPC, "confirmed");

  // Fund agent with enough SOL for the transfer + fees
  // (deployer airdrops 0.01 SOL to agent so it can pay fees and transfer 0.001)
  console.log("\nFunding agent keypair for demo transfer...");
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: agentKeypair.publicKey,
      lamports: 0.01 * LAMPORTS_PER_SOL,
    })
  );
  const fundSig = await sendAndConfirmTransaction(connection, fundTx, [deployer], {
    commitment: "confirmed",
  });
  console.log("Agent funded. Fund tx:", fundSig);

  // Setup Anchor provider (authority reads the program for scope validation)
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

  console.log("\nCalling broker.getScopedSigner()...");
  const scopedSigner = await broker.getScopedSigner(
    state.scopeUri,
    agentKeypair,
    deployer.publicKey
  );
  console.log("ScopedSigner granted. publicKey:", scopedSigner.publicKey.toBase58());

  // Build a small SOL transfer tx from agent to target
  const TRANSFER_AMOUNT = 0.001 * LAMPORTS_PER_SOL;
  const targetAccount = new PublicKey(state.targetAccount);

  const transferTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: agentKeypair.publicKey,
      toPubkey: targetAccount,
      lamports: TRANSFER_AMOUNT,
    })
  );

  // Set recent blockhash and fee payer
  const { blockhash } = await connection.getLatestBlockhash();
  transferTx.recentBlockhash = blockhash;
  transferTx.feePayer = agentKeypair.publicKey;

  console.log("\nSigning transfer with ScopedSigner...");
  // ScopedSigner validates the tx targets the attested program (or SystemProgram)
  // before signing. This will succeed because SystemProgram is always allowed.
  const signedTx = await scopedSigner.signTransaction(transferTx);

  console.log("Submitting transfer transaction...");
  const txSig = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(txSig, "confirmed");

  console.log("\nTransaction signature:", txSig);
  console.log("Solscan:", `https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
  console.log("Transfer amount:    ", TRANSFER_AMOUNT / LAMPORTS_PER_SOL, "SOL");

  // Persist tx hash
  state.txHashes.rebalanceSuccess = txSig;
  state.rebalanceAmountLamports = TRANSFER_AMOUNT;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log("\n[03-rebalance-success] DONE");
}

main().catch((err) => {
  console.error("rebalance-success failed:", err);
  process.exit(1);
});
