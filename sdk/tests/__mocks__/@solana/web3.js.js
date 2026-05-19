/**
 * Manual Jest mock for @solana/web3.js
 *
 * Provides just enough implementation to run broker unit tests without
 * pulling in the full @solana/web3.js tree (which includes rpc-websockets
 * with ESM-only uuid, which breaks Jest's CommonJS transform).
 *
 * Only PublicKey, Keypair, SystemProgram, and Transaction are mocked here.
 * Integration tests that need real onchain behavior should run against localnet
 * with the full library outside Jest.
 */
"use strict";

const crypto = require("crypto");
const nacl = require("tweetnacl");

class PublicKey {
  constructor(value) {
    if (typeof value === "string") {
      // base58-ish decode: for tests we just hash the string to 32 bytes
      const buf = Buffer.alloc(32);
      Buffer.from(value).slice(0, 32).copy(buf);
      this._bytes = buf;
    } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      this._bytes = Buffer.from(value).slice(0, 32);
    } else {
      this._bytes = Buffer.from(value);
    }
  }

  toBase58() {
    return "Pub" + this._bytes.slice(0, 8).toString("hex");
  }

  toBuffer() {
    return Buffer.from(this._bytes);
  }

  equals(other) {
    return (
      other instanceof PublicKey &&
      Buffer.from(this._bytes).equals(Buffer.from(other._bytes))
    );
  }

  static findProgramAddressSync(seeds, programId) {
    // Deterministic but fake PDA derivation for tests
    const combined = Buffer.concat(seeds.map((s) => Buffer.from(s)));
    const hash = crypto.createHash("sha256").update(combined).digest();
    return [new PublicKey(hash), 255];
  }
}

class Keypair {
  constructor() {
    const pair = nacl.sign.keyPair();
    this.secretKey = pair.secretKey;
    this.publicKey = new PublicKey(pair.publicKey);
  }

  static generate() {
    return new Keypair();
  }

  static fromSecretKey(secretKey) {
    const kp = new Keypair();
    kp.secretKey = secretKey;
    kp.publicKey = new PublicKey(secretKey.slice(32));
    return kp;
  }
}

const SystemProgram = {
  programId: new PublicKey("11111111111111111111111111111111"),
};

class Transaction {
  constructor() {
    this.instructions = [];
    this.signatures = [];
  }
  sign(signers) {
    this.signatures.push(...signers.map((s) => ({ publicKey: s.publicKey })));
    return this;
  }
}

class Connection {
  constructor() {}
}

module.exports = {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  Connection,
};
