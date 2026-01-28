import { network } from "hardhat";
import { deployDiamond } from "./libraries/diamond.js";
import { getCustomNFTConfig } from "@/config/customNFT.js";

const main = async () => {
  const { viem, networkName } = await network.connect();

  const config = getCustomNFTConfig(networkName);

  // Ensure migration is defined, or use a default compatible with deployDiamond
  const migration = config.migration || { facetName: "", args: {} };

  await deployDiamond(viem, networkName, config.name, config.facets, migration);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
