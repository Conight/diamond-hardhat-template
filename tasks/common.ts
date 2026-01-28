import { deployDiamond, upgradeDiamond } from "@/scripts/libraries/diamond.js";
import { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { TaskArguments } from "hardhat/types/tasks";
import { DiamondConfiguration } from "@/config/types.js";

const DefaultMigrationConfig = {
  facetName: "",
  args: {},
};

export const createDiamondTask = (
  getConfig: (networkName: string) => DiamondConfiguration,
) => {
  return async function (
    taskArguments: TaskArguments,
    hre: HardhatRuntimeEnvironment,
  ): Promise<void> {
    const { viem, networkName } = await hre.network.connect();

    const config = getConfig(networkName);
    const { name: diamondName, facets, migration } = config;

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
