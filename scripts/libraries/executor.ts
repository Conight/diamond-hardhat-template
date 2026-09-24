import { artifacts } from "hardhat";
import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  toFunctionSelector,
  zeroAddress,
  zeroHash,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { computeBytecodeHash } from "./deployment.js";
import { facetAbi, selectorSignature, unpackSelectors } from "./selectors.js";
import type {
  DeploymentFacet,
  DeploymentFunction,
  FacetArtifact,
  FacetReplacement,
  MigrationConfig,
  OnChainFacet,
} from "./types.js";

export type DeploymentWallet = WalletClient<Transport, Chain, Account>;
const migrationAbi = parseAbi([
  "function migrationId() pure returns (bytes32)",
  "function isMigrationCompleted(bytes32 id) view returns (bool)",
]);

export async function deployFacets(
  publicClient: PublicClient,
  walletClient: DeploymentWallet,
  facets: readonly FacetArtifact[],
): Promise<Record<string, DeploymentFacet>> {
  const deployed: Record<string, DeploymentFacet> = {};
  for (const facet of facets) {
    console.log(
      `Deploying ${facet.contractName} (${facet.selectors.length} selectors)`,
    );
    const hash = await walletClient.deployContract({
      abi: facet.abi,
      bytecode: facet.bytecode,
      args: [],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error(`Facet deployment failed: ${hash}`);
    const packed = await publicClient.readContract({
      address: receipt.contractAddress,
      abi: facetAbi,
      functionName: "exportSelectors",
    });
    const selectors = unpackSelectors(packed);
    if (JSON.stringify(selectors) !== JSON.stringify(facet.selectors))
      throw new Error(
        `${facet.contractName}: deployed selectors differ from the approved plan`,
      );
    const code = await publicClient.getCode({
      address: receipt.contractAddress,
    });
    if (code !== facet.deployedBytecode)
      throw new Error(
        `${facet.contractName}: deployed bytecode differs from artifact`,
      );
    deployed[facet.contractName] = {
      address: receipt.contractAddress,
      selectors,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      transactionHash: hash,
      transactionIndex: receipt.transactionIndex,
      bytecodeHash: computeBytecodeHash(code),
      from: receipt.from,
    };
  }
  return deployed;
}

export async function deployDiamondContract(
  publicClient: PublicClient,
  walletClient: DeploymentWallet,
  diamondName: string,
  facets: readonly Address[],
  owner: Address,
) {
  const artifact = await artifacts.readArtifact(diamondName);
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    args: [facets, owner],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`Diamond deployment failed: ${hash}`);
  return { ...receipt, address: receipt.contractAddress };
}

export async function readOnChainFacets(
  publicClient: PublicClient,
  diamond: Address,
): Promise<readonly OnChainFacet[]> {
  const artifact = await artifacts.readArtifact("DiamondInspectFacet");
  return (await publicClient.readContract({
    address: diamond,
    abi: artifact.abi,
    functionName: "facets",
  })) as readonly OnChainFacet[];
}

export async function executeDiamondUpgrade(
  publicClient: PublicClient,
  walletClient: DeploymentWallet,
  diamondAddress: Address,
  addFacets: readonly Address[],
  replaceFacets: readonly FacetReplacement[],
  removeFacets: readonly Address[],
  delegate: Address = zeroAddress,
  delegateCalldata: Hex = "0x",
  tag: Hex = zeroHash,
) {
  const artifact = await artifacts.readArtifact("DiamondUpgradeFacet");
  const { request } = await publicClient.simulateContract({
    account: walletClient.account,
    address: diamondAddress,
    abi: artifact.abi,
    functionName: "upgradeDiamond",
    args: [
      addFacets,
      replaceFacets,
      removeFacets,
      delegate,
      delegateCalldata,
      tag,
      "0x",
    ],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error(`Diamond upgrade reverted: ${hash}`);
  return { ...receipt, migrationExecuted: delegate !== zeroAddress };
}

/** Check the NEW migration's ID against diamond storage, including migration-only upgrades. */
export async function prepareMigration(
  publicClient: PublicClient,
  migration: MigrationConfig | undefined,
  facets: readonly FacetArtifact[],
  diamond?: Address,
  onChain: readonly OnChainFacet[] = [],
): Promise<{ willExecute: boolean; calldata: Hex }> {
  if (!migration) return { willExecute: false, calldata: "0x" };
  const facet = facets.find((f) => f.contractName === migration.facetName);
  if (!facet)
    throw new Error(`Migration facet ${migration.facetName} is not configured`);
  const result = await publicClient.call({
    code: facet.bytecode,
    data: encodeFunctionData({
      abi: migrationAbi,
      functionName: "migrationId",
    }),
  });
  if (!result.data)
    throw new Error("Migration facet must implement migrationId()");
  const id = decodeFunctionResult({
    abi: migrationAbi,
    functionName: "migrationId",
    data: result.data,
  });
  const checkSelector = toFunctionSelector("isMigrationCompleted(bytes32)");
  const canCheck = onChain.some((f) =>
    f.functionSelectors.includes(checkSelector),
  );
  if (diamond && canCheck) {
    const completed = await publicClient.readContract({
      address: diamond,
      abi: migrationAbi,
      functionName: "isMigrationCompleted",
      args: [id],
    });
    if (completed) return { willExecute: false, calldata: "0x" };
  }
  return {
    willExecute: true,
    calldata: encodeFunctionData({
      abi: facet.abi,
      functionName: "migrate",
      args: [migration.args],
    }),
  };
}

export function buildDeploymentFunctions(
  facets: readonly FacetArtifact[],
): DeploymentFunction[] {
  return facets.flatMap((facet) =>
    facet.selectors.map((selector) => ({
      selector,
      signature: selectorSignature(facet.abi, selector),
      contract: facet.contractName,
    })),
  );
}
