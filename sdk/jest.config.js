/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json", "mjs", "cjs"],
  // Strip .js extensions from relative imports (TypeScript ESM source -> CJS test)
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Stub heavy deps to avoid ESM issues in Jest (rpc-websockets uuid chain)
    "@solana/web3.js": "<rootDir>/tests/__mocks__/@solana/web3.js.js",
    "@coral-xyz/anchor": "<rootDir>/tests/__mocks__/@coral-xyz/anchor.js",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
};
