import { artifacts } from "hardhat";
import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type Hex,
  type PublicClient,
} from "viem";
import { formatAbiItem } from "viem/utils";
import type { FacetArtifact, Selector } from "./types.js";

export const facetAbi = parseAbi([
  "function exportSelectors() pure returns (bytes)",
]);
export const exportSelectorsSelector = toFunctionSelector("exportSelectors()");

export function getAbiFunctions(abi: Abi): AbiFunction[] {
  return abi.filter((item): item is AbiFunction => item.type === "function");
}

export function unpackSelectors(packed: Hex): Selector[] {
  if (!/^0x(?:[a-fA-F0-9]{8})+$/.test(packed)) {
    throw new Error(
      "exportSelectors() must return nonempty packed bytes4 selectors",
    );
  }
  const selectors = packed
    .slice(2)
    .match(/.{8}/g)!
    .map((s) => `0x${s.toLowerCase()}` as Selector);
  if (new Set(selectors).size !== selectors.length) {
    throw new Error("exportSelectors() returned duplicate selectors");
  }
  if (selectors.includes(exportSelectorsSelector)) {
    throw new Error("exportSelectors() must not export itself");
  }
  return selectors;
}

/** Executes the facet's actual creation code and export function in an eth_call.
 * No facet is deployed and no transaction is sent during planning.
 */
export async function inspectFacetArtifact(
  publicClient: PublicClient,
  contractName: string,
): Promise<FacetArtifact> {
  const artifact = await artifacts.readArtifact(contractName);
  const abi = artifact.abi as Abi;
  const discovery = getAbiFunctions(abi).find(
    (f) => f.name === "exportSelectors" && f.inputs.length === 0,
  );
  if (
    !discovery ||
    discovery.stateMutability !== "pure" ||
    discovery.outputs.length !== 1 ||
    discovery.outputs[0].type !== "bytes"
  ) {
    throw new Error(
      `${contractName} must implement exportSelectors() external pure returns (bytes)`,
    );
  }
  if (
    abi.some((item) => item.type === "constructor" && item.inputs.length > 0)
  ) {
    throw new Error(
      `${contractName}: facets with constructor arguments are not supported`,
    );
  }
  if (!/^0x[0-9a-fA-F]+$/.test(artifact.bytecode)) {
    throw new Error(
      `${contractName} has no deployable bytecode or has unlinked libraries`,
    );
  }
  const result = await publicClient.call({
    code: artifact.bytecode as Hex,
    data: encodeFunctionData({
      abi: facetAbi,
      functionName: "exportSelectors",
    }),
  });
  if (!result.data)
    throw new Error(`${contractName}: exportSelectors() returned no data`);
  const packed = decodeFunctionResult({
    abi: facetAbi,
    functionName: "exportSelectors",
    data: result.data,
  });
  const selectors = unpackSelectors(packed);
  const abiSelectors = new Set(
    getAbiFunctions(abi).map((f) => toFunctionSelector(f)),
  );
  for (const selector of selectors) {
    if (!abiSelectors.has(selector))
      throw new Error(
        `${contractName} exports ${selector}, which is missing from its ABI`,
      );
  }
  return {
    contractName,
    abi,
    bytecode: artifact.bytecode as Hex,
    deployedBytecode: artifact.deployedBytecode as Hex,
    selectors,
  };
}

export function selectorSignature(abi: Abi, selector: Selector): string {
  const fn = getAbiFunctions(abi).find(
    (f) => toFunctionSelector(f) === selector,
  );
  if (!fn) throw new Error(`Selector ${selector} is missing from ABI`);
  return formatAbiItem(fn);
}

export function assertUniqueSelectors(
  facets: readonly Pick<FacetArtifact, "contractName" | "selectors">[],
): void {
  const owners = new Map<Selector, string>();
  const names = new Set<string>();
  for (const facet of facets) {
    if (names.has(facet.contractName))
      throw new Error(`Duplicate facet: ${facet.contractName}`);
    names.add(facet.contractName);
    for (const selector of facet.selectors) {
      const previous = owners.get(selector);
      if (previous)
        throw new Error(
          `Selector collision ${selector}: ${previous} and ${facet.contractName}`,
        );
      owners.set(selector, facet.contractName);
    }
  }
}
