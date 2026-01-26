import {
  deployDiamond,
  upgradeDiamond,
  type MigrationConfig,
} from "@/scripts/libraries/diamond.js";
import { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { TaskArguments } from "hardhat/types/tasks";

const DefaultMigrationConfig: MigrationConfig = {
  facetName: "",
  args: {},
};

export const createDiamondTask = (
  diamondName: string,
  facets: string[],
  migration?: MigrationConfig,
) => {
  return async function (
    taskArguments: TaskArguments,
    hre: HardhatRuntimeEnvironment,
  ): Promise<void> {
    const { viem, networkName } = await hre.network.connect();

    if (taskArguments.deploy) {
      console.log(`Deploying ${diamondName}...`);
      await deployDiamond(
        viem,
        networkName,
        diamondName,
        facets,
        migration ? migration : DefaultMigrationConfig,
      );
    } else if (taskArguments.upgrade) {
      console.log(`Upgrading ${diamondName}...`);
      await upgradeDiamond(
        viem,
        networkName,
        diamondName,
        facets,
        migration ? migration : DefaultMigrationConfig,
      );
    } else {
      throw new Error(
        "At least one of --deploy or --upgrade must be specified",
      );
    }
  };
};
