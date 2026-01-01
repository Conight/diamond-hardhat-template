import hre, { network } from "hardhat";
import type { NetworkConnection } from "hardhat/types/network";
import { DiamondChanges, loadDeployment } from "./libraries/diamond.js";
import { zeroAddress, zeroHash } from "viem";

export const upgradeDiamond = async (
  viem: NetworkConnection<"generic">["viem"],
  networkName: string
) => {
  await hre.tasks.getTask("selectors").run();

  /**
   * Read deployed contracts
   */
  const deployedContracts = await loadDeployment(networkName);

  const diamondAddress = deployedContracts.diamond;

  const diamondLoupe = await viem.getContractAt(
    "DiamondInspectFacet",
    diamondAddress
  );

  const previousFacets = await diamondLoupe.read.functionFacetPairs();
  const changes = await DiamondChanges.create(
    ["AFacets", "CFacets"],
    previousFacets
  );
  const shouldUpgrade = await changes.verify();
  if (!shouldUpgrade) {
    console.log("Upgrade aborted");
    return;
  }

  await changes.deploy(viem);

  const diamondUpgrade = await viem.getContractAt(
    "DiamondUpgradeFacet",
    diamondAddress
  );

  // upgrade Diamond
  const publicClient = await viem.getPublicClient();
  const functionCall = "0x";
  const tx = await diamondUpgrade.write.upgradeDiamond([
    changes.getAddFunctions(),
    changes.getReplaceFunctions(),
    changes.getRemoveFunctions(),
    zeroAddress,
    functionCall,
    zeroHash,
    "0x",
  ]);
  console.log("tx:", tx);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("Upgrade done");

  return diamondAddress;
};

const main = async () => {
  const { viem, networkName } = await network.connect();

  console.log(`Upgrading diamond to ${networkName}...`);
  const diamondAddress = await upgradeDiamond(viem, networkName);
  console.log(`Diamond upgraded: ${diamondAddress}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
