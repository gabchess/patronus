/**
 * Minimal Jest mock for @coral-xyz/anchor.
 * AnchorAdapter is fully mocked in broker tests, so we only need the
 * Program type shape to satisfy TypeScript + Jest imports.
 */
"use strict";

class Program {
  constructor(idl, programId, provider) {
    this.programId = programId;
    this.provider = provider || { publicKey: null };
    this.account = {};
  }
}

module.exports = { Program };
