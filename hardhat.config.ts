import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig, task } from "hardhat/config";

const selectors = task("selectors", "Generate new selectors file")
  .setAction(() => import("./tasks/selectors.js"))
  .build();

function diamondTask(
  name: string,
  description: string,
  action: () => Promise<any>,
) {
  return task(name, description)
    .addFlag({
      name: "deploy",
      description: `Deploy new ${name}`,
    })
    .addFlag({
      name: "upgrade",
      description: `Upgrade existing ${name}`,
    })
    .setAction(action)
    .build();
}

// Diamond tasks
const customNFT = diamondTask(
  "customNFT",
  "Deploy & upgrade customNFT",
  () => import("@/tasks/customNFT.js"),
);

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.33",
        settings: {
          evmVersion: "prague",
          optimizer: {
            enabled: true,
            runs: 999999,
          },
          viaIR: true,
        },
      },
      production: {
        version: "0.8.33",
        settings: {
          evmVersion: "prague",
          optimizer: {
            enabled: true,
            runs: 999999,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    localhost: {
      type: "http",
      url: process.env.LOCALHOST_RPC_URL ?? "http://127.0.0.1:8545",
    },
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
  },
  tasks: [selectors, customNFT],
});
