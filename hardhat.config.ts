import type { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

// Load environment variables from .env file
dotenv.config();

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true, // Fix "Stack too deep" error
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.ALCHEMY_SEPOLIA_URL || '',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    "optimism-sepolia": {
      type: "http",
      chainType: "op",
      url: process.env.OPTIMISM_SEPOLIA_URL || "https://sepolia.optimism.io",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    "base-sepolia": {
      type: "http",
      chainType: "op", // Base is OP Stack
      url: process.env.BASE_SEPOLIA_URL || "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    "arbitrum-sepolia": {
      type: "http",
      chainType: "l1", // Arbitrum uses L1 chain type
      url: process.env.ARBITRUM_SEPOLIA_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  // @ts-ignore - etherscan config is supported by hardhat-verify plugin
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || '',
    },
  },
};

export default config;
