/**
 * Common Diamond Task Utilities
 *
 * Factory for creating Hardhat tasks for Diamond deployment and upgrades.
 */

import {
  deployDiamond,
  upgradeDiamond,
  deployOrUpgrade,
} from "@/scripts/libraries/index.js";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import type { TaskArguments } from "hardhat/types/tasks";
import type { DiamondConfig } from "@/scripts/libraries/index.js";

// ============================================================================
// Task Factory
// ============================================================================

/**
 * Creates a Hardhat task for Diamond deployment and upgrades.
 *
 * @param getConfig - Function that returns the Diamond configuration for a network
 * @returns Hardhat task action function
 *
 * @example
 * ```ts
 * // In tasks/customNFT.ts
 * import { createDiamondTask } from "./common.js";
 * import { getCustomNFTConfig } from "@/config/customNFT.js";
 *
 * export default createDiamondTask(getCustomNFTConfig);
 * ```
 */
export function createDiamondTask(
  getConfig: (networkName: string) => DiamondConfig,
) {
  return async function diamondTask(
    taskArguments: TaskArguments,
    hre: HardhatRuntimeEnvironment,
  ): Promise<void> {
    const { viem, networkName } = await hre.network.connect();
    const config = getConfig(networkName);

    // Determine operation mode
    const isDeployOnly = Boolean(taskArguments.deploy);
    const isUpgradeOnly = Boolean(taskArguments.upgrade);

    if (isDeployOnly && isUpgradeOnly) {
      throw new Error("Cannot specify both --deploy and --upgrade");
    }

    // Execute appropriate operation
    let result;

    if (isDeployOnly) {
      console.log(`\n🚀 Deploying ${config.name}...\n`);
      result = await deployDiamond(viem, networkName, config);
    } else if (isUpgradeOnly) {
      console.log(`\n🔄 Upgrading ${config.name}...\n`);
      result = await upgradeDiamond(viem, networkName, config);
    } else {
      // Smart mode: deploy if not exists, upgrade if exists
      console.log(`\n💎 Deploy/Upgrade ${config.name}...\n`);
      result = await deployOrUpgrade(viem, networkName, config);
    }

    if (!result) {
      console.log("\n⚠️  Operation cancelled or no changes applied.\n");
      return;
    }

    console.log(`\n✅ ${config.name} ready at ${result.diamondAddress}\n`);
  };
}
