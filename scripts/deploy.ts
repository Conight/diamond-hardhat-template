import hre, { artifacts, network } from "hardhat";
import type { NetworkConnection } from "hardhat/types/network";
import { DiamondChanges } from "./libraries/diamond.js";

export const deployDiamond = async (
  viem: NetworkConnection<"generic">["viem"],
  networkName: string
) => {
  await hre.tasks.getTask("selectors").run();

  const publicClient = await viem.getPublicClient();
  const [deployWallet] = await viem.getWalletClients();

  const changes = await DiamondChanges.create([
    "DiamondUpgradeFacet",
    "DiamondInspectFacet",
    "OwnerFacet",
    "AFacets",
    "CFacets",
  ]);
  const shouldUpgrade = await changes.verify();
  if (!shouldUpgrade) {
    console.log("Upgrade aborted");
    return;
  }
  await changes.deploy(viem);

  // deploy Diamond
  const diamondArtifact = await artifacts.readArtifact("ExampleDiamond");
  const hash = await deployWallet.deployContract({
    abi: diamondArtifact.abi,
    bytecode: diamondArtifact.bytecode as `0x${string}`,
    args: [changes.getAddFunctions(), deployWallet.account.address],
  });

  console.log(`${diamondArtifact.contractName} deploy hash: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error(`${diamondArtifact.contractName} deployment failed`);
  }

  changes.saveDeployment(receipt, networkName);

  return receipt.contractAddress;
};

const main = async () => {
  const { viem, networkName } = await network.connect();

  console.log(`Deploying diamond to ${networkName}...`);
  const diamondAddress = await deployDiamond(viem, networkName);
  console.log(`Diamond deployed: ${diamondAddress}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
