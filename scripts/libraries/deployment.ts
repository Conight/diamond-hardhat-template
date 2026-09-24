/** ERC-8153 deployment records. Only the current format is supported. */
import hre from "hardhat";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isAddress, keccak256, type Hex } from "viem";
import type { DiamondDeployment } from "./types.js";

export function getDeploymentPath(
  networkName: string,
  diamondName: string,
): string {
  return path.join(
    hre.config.paths.root,
    "deployment",
    networkName,
    `${diamondName}.json`,
  );
}
export async function deploymentExists(
  networkName: string,
  diamondName: string,
): Promise<boolean> {
  try {
    await fs.access(getDeploymentPath(networkName, diamondName));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export function validateDeployment(
  value: unknown,
): asserts value is DiamondDeployment {
  if (!value || typeof value !== "object")
    throw new Error("Invalid deployment record");
  const d = value as Partial<DiamondDeployment>;
  if (d.version !== 3 || d.standard !== "ERC-8153") {
    throw new Error(
      "Only ERC-8153 deployment records (version 3) are supported. Deploy a new diamond.",
    );
  }
  if (
    !d.diamond ||
    !isAddress(d.diamond) ||
    !d.owner ||
    !isAddress(d.owner) ||
    !Number.isSafeInteger(d.chainId) ||
    !d.facets ||
    !Array.isArray(d.functions) ||
    !Array.isArray(d.upgradeHistory) ||
    typeof d.blockNumber !== "string" ||
    !d.blockHash
  ) {
    throw new Error("Invalid ERC-8153 deployment record");
  }
  const addresses = new Set<string>();
  for (const facet of Object.values(d.facets)) {
    if (
      !isAddress(facet.address) ||
      !Array.isArray(facet.selectors) ||
      facet.selectors.length === 0 ||
      facet.selectors.some((s) => !/^0x[0-9a-f]{8}$/.test(s)) ||
      addresses.has(facet.address.toLowerCase())
    ) {
      throw new Error("Invalid facet in deployment record");
    }
    addresses.add(facet.address.toLowerCase());
  }
}
export async function loadDeployment(
  networkName: string,
  diamondName: string,
): Promise<DiamondDeployment> {
  const value: unknown = JSON.parse(
    await fs.readFile(getDeploymentPath(networkName, diamondName), "utf8"),
  );
  validateDeployment(value);
  return value;
}
export async function saveDeployment(
  networkName: string,
  diamondName: string,
  deployment: DiamondDeployment,
): Promise<void> {
  validateDeployment(deployment);
  const target = getDeploymentPath(networkName, diamondName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(deployment, null, 2) + "\n");
  await fs.rename(temporary, target);
  console.log(`Deployment saved: ${target}`);
}
export function computeBytecodeHash(bytecode: Hex): Hex {
  return keccak256(bytecode);
}
