/** ERC-8153 orchestration: plan, confirm, transact, verify, persist. */
import {
  parseAbi,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import type { NetworkConnection } from "hardhat/types/network";
import { computeDiamondDiff, assertDeploymentMatchesChain } from "./diffing.js";
import {
  deploymentExists,
  loadDeployment,
  saveDeployment,
} from "./deployment.js";
import {
  buildDeploymentFunctions,
  deployDiamondContract,
  deployFacets,
  executeDiamondUpgrade,
  prepareMigration,
  readOnChainFacets,
} from "./executor.js";
import { inspectFacetArtifact } from "./selectors.js";
import { confirmChanges } from "./prompts.js";
import type {
  DiamondConfig,
  DiamondDeployment,
  FacetArtifact,
  OperationOptions,
  UpgradeRecord,
} from "./types.js";

export type { DiamondConfig, MigrationConfig } from "./types.js";
export { loadDeployment } from "./deployment.js";
type ViemConnection = NetworkConnection<"generic">["viem"];
export interface DiamondOperationResult {
  readonly diamondAddress: Address;
  readonly deployment: DiamondDeployment;
}
const ownerAbi = parseAbi(["function owner() view returns (address)"]);

async function inspectConfiguredFacets(
  client: PublicClient,
  config: DiamondConfig,
): Promise<FacetArtifact[]> {
  const names = [...config.facets];
  if (config.migration && !names.includes(config.migration.facetName))
    names.push(config.migration.facetName);
  const facets = await Promise.all(
    names.map((name) => inspectFacetArtifact(client, name)),
  );
  const selectors = new Set(facets.flatMap((f) => f.selectors));
  for (const signature of [
    "facets()",
    "facetAddress(bytes4)",
    "facetAddresses()",
    "facetFunctionSelectors(address)",
    "owner()",
    "upgradeDiamond(address[],(address,address)[],address[],address,bytes,bytes32,bytes)",
  ]) {
    if (!selectors.has(toFunctionSelector(signature)))
      throw new Error(`Configured diamond must expose ${signature}`);
  }
  return facets;
}

export async function deployDiamond(
  viem: ViemConnection,
  networkName: string,
  config: DiamondConfig,
  options: OperationOptions = {},
): Promise<DiamondOperationResult | undefined> {
  if (await deploymentExists(networkName, config.name)) {
    throw new Error(
      `Deployment already exists for ${config.name} on ${networkName}; use upgrade or a new deployment name`,
    );
  }
  const client = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("No deployment wallet configured");
  const local = await inspectConfiguredFacets(client, config);
  const diff = await computeDiamondDiff(
    client,
    local,
    undefined,
    [],
    config.replacements,
  );
  const migration = await prepareMigration(client, config.migration, local);
  if (
    !(await (options.confirm ?? confirmChanges)({
      diff,
      isUpgrade: false,
      migration: migration.willExecute
        ? config.migration?.facetName
        : undefined,
    }))
  )
    return;
  const facets = await deployFacets(client, wallet, local);
  const receipt = await deployDiamondContract(
    client,
    wallet,
    config.name,
    Object.values(facets).map((f) => f.address),
    wallet.account.address,
  );
  let deployment: DiamondDeployment = {
    version: 3,
    standard: "ERC-8153",
    chainId: await client.getChainId(),
    diamond: receipt.address,
    owner: wallet.account.address,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    functions: buildDeploymentFunctions(local),
    facets,
    upgradeHistory: [],
  };
  // Persist the deployment before the separate migration transaction, so a
  // failed migration can be retried with --upgrade without losing the address.
  await saveDeployment(networkName, config.name, deployment);
  assertDeploymentMatchesChain(
    deployment,
    await readOnChainFacets(client, receipt.address),
  );
  if (migration.willExecute && config.migration) {
    const result = await executeDiamondUpgrade(
      client,
      wallet,
      receipt.address,
      [],
      [],
      [],
      facets[config.migration.facetName].address,
      migration.calldata,
    );
    deployment = {
      ...deployment,
      upgradeHistory: [
        {
          timestamp: new Date().toISOString(),
          blockNumber: result.blockNumber.toString(),
          transactionHash: result.transactionHash,
          added: [],
          replaced: [],
          removed: [],
          migrationExecuted: true,
        },
      ],
    };
    await saveDeployment(networkName, config.name, deployment);
  }
  console.log(`Deployment complete: ${receipt.address}`);
  return { diamondAddress: receipt.address, deployment };
}

export async function upgradeDiamond(
  viem: ViemConnection,
  networkName: string,
  config: DiamondConfig,
  options: OperationOptions = {},
): Promise<DiamondOperationResult | undefined> {
  const client = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("No deployment wallet configured");
  const existing = await loadDeployment(networkName, config.name);
  if (existing.chainId !== (await client.getChainId()))
    throw new Error("Deployment chain ID does not match connected network");
  const owner = await client.readContract({
    address: existing.diamond,
    abi: ownerAbi,
    functionName: "owner",
  });
  if (owner.toLowerCase() !== wallet.account.address.toLowerCase())
    throw new Error("Deployment wallet is not the diamond owner");
  const onChain = await readOnChainFacets(client, existing.diamond);
  const local = await inspectConfiguredFacets(client, config);
  const diff = await computeDiamondDiff(
    client,
    local,
    existing,
    onChain,
    config.replacements,
  );
  const migration = await prepareMigration(
    client,
    config.migration,
    local,
    existing.diamond,
    onChain,
  );
  if (!diff.hasChanges && !migration.willExecute) {
    console.log("No facet changes or pending migration.");
    return { diamondAddress: existing.diamond, deployment: existing };
  }
  if (
    !(await (options.confirm ?? confirmChanges)({
      diff,
      isUpgrade: true,
      migration: migration.willExecute
        ? config.migration?.facetName
        : undefined,
    }))
  )
    return;
  const deployed = await deployFacets(client, wallet, [
    ...diff.adds,
    ...diff.replaces.map((r) => r.next),
  ]);
  const facets = { ...deployed };
  for (const unchanged of diff.unchanged)
    facets[unchanged.contractName] = existing.facets[unchanged.contractName];
  const added = diff.adds.map((f) => deployed[f.contractName].address);
  const replaced = diff.replaces.map(({ previous, next }) => ({
    oldFacet: previous.address,
    newFacet: deployed[next.contractName].address,
  }));
  const removed = diff.removes.map((f) => f.address);
  // Refuse stale plans if another operator changed routing while confirmation or facet deployments were pending.
  assertDeploymentMatchesChain(
    existing,
    await readOnChainFacets(client, existing.diamond),
  );
  const delegate =
    migration.willExecute && config.migration
      ? facets[config.migration.facetName].address
      : zeroAddress;
  const receipt = await executeDiamondUpgrade(
    client,
    wallet,
    existing.diamond,
    added,
    replaced,
    removed,
    delegate,
    migration.calldata,
  );
  const record: UpgradeRecord = {
    timestamp: new Date().toISOString(),
    blockNumber: receipt.blockNumber.toString(),
    transactionHash: receipt.transactionHash,
    added,
    replaced,
    removed,
    migrationExecuted: receipt.migrationExecuted,
  };
  const deployment: DiamondDeployment = {
    ...existing,
    owner: await client.readContract({
      address: existing.diamond,
      abi: ownerAbi,
      functionName: "owner",
    }),
    facets,
    functions: buildDeploymentFunctions(local),
    upgradeHistory: [...existing.upgradeHistory, record],
  };
  await saveDeployment(networkName, config.name, deployment);
  assertDeploymentMatchesChain(
    deployment,
    await readOnChainFacets(client, existing.diamond),
  );
  console.log(`Upgrade complete: ${receipt.transactionHash}`);
  return { diamondAddress: existing.diamond, deployment };
}

export async function deployOrUpgrade(
  viem: ViemConnection,
  networkName: string,
  config: DiamondConfig,
  options: OperationOptions = {},
): Promise<DiamondOperationResult | undefined> {
  return (await deploymentExists(networkName, config.name))
    ? upgradeDiamond(viem, networkName, config, options)
    : deployDiamond(viem, networkName, config, options);
}
