import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig, task } from "hardhat/config";

const selectors = task("selectors", "Generate new selectors file")
  .addFlag({
    name: "overwrite",
    description: "Overwrite the exists selectors file",
  })
  .setAction(() => import("./tasks/selectors.js"))
  .build();

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.33",
        settings: {
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
          optimizer: {
            enabled: false,
          },
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
  },
  tasks: [selectors],
});
