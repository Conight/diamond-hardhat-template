import { defineConfig } from "@wagmi/cli";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import type { Abi, Address } from "viem";

/**
 * This configuration automatically scans your Hardhat deployments and artifacts
 * to generate a unified Diamond ABI.
 *
 * Features:
 * 1. Deployment Awareness: Reads actual addresses from `deployment/<network>/`.
 * 2. ABI Deduplication: Merges Facets + Core without duplicate function signatures.
 * 3. Type Safety: Uses Viem types.
 */

// --- Constants ---
const PROJECT_ROOT = process.cwd();
const ARTIFACTS_DIR = join(PROJECT_ROOT, "artifacts", "contracts");
const DEPLOYMENTS_DIR = join(PROJECT_ROOT, "deployment");
const DEFAULT_NETWORK = process.env.NETWORK || "localhost";
const CONTRACT_NAME = "CustomNFTDiamond";

// --- Types ---
interface DeploymentData {
  diamond: Address;
  facets: Record<string, { address: Address }>;
}

// --- Helpers ---

/**
 * Finds a file recursively in the artifacts directory.
 * Optimized to stop at the first match for a given ContractName.json.
 */
function findArtifactPath(dir: string, contractName: string): string | null {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      const found = findArtifactPath(fullPath, contractName);
      if (found) return found;
    } else if (entry === `${contractName}.json`) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Loads and parses the ABI for a specific contract.
 */
function loadAbi(contractName: string): Abi {
  const path = findArtifactPath(ARTIFACTS_DIR, contractName);
  if (!path) {
    console.warn(`⚠️  Warning: Artifact not found for ${contractName}`);
    return [];
  }
  try {
    const content = readFileSync(path, "utf-8");
    const json = JSON.parse(content);
    return json.abi as Abi;
  } catch (error) {
    console.error(`❌ Error parsing artifact for ${contractName}:`, error);
    return [];
  }
}

/**
 * Merges multiple ABIs into one, removing duplicates based on function signature.
 * Essential for Diamonds where multiple facets might inherit similar standards.
 */
function mergeAbis(abis: Abi[]): Abi {
  const uniqueItems = new Map<string, any>();

  for (const abi of abis) {
    for (const item of abi) {
      if (
        item.type === "function" ||
        item.type === "event" ||
        item.type === "error"
      ) {
        // Create a unique key for deduplication
        // For functions: type + name + inputs types
        const inputs =
          "inputs" in item ? item.inputs.map((i: any) => i.type).join(",") : "";
        const key = `${item.type}:${item.name}(${inputs})`;

        if (!uniqueItems.has(key)) {
          uniqueItems.set(key, item);
        }
      } else {
        // Constructor, fallback, receive, etc.
        // We usually keep them, but for Diamond proxy, constructor is on the proxy itself.
        // We'll simplisticly stringify to dedupe generic items
        const key = JSON.stringify(item);
        if (!uniqueItems.has(key)) uniqueItems.set(key, item);
      }
    }
  }

  return Array.from(uniqueItems.values());
}

/**
 * Loads deployment data to get the active Facet list and Diamond address.
 */
function loadDeployment(network: string): DeploymentData | null {
  const path = join(DEPLOYMENTS_DIR, network, `${CONTRACT_NAME}.json`);
  if (!existsSync(path)) {
    console.warn(`⚠️  No deployment found for network "${network}" at ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as DeploymentData;
  } catch (e) {
    console.error(`❌ Error reading deployment file:`, e);
    return null;
  }
}

// --- Main Logic ---

console.log(`💎 Wagmi Generation - Network: ${DEFAULT_NETWORK}`);

const deployment = loadDeployment(DEFAULT_NETWORK);

// Determine which contracts to include.
// If deployment exists, we use its active facets.
// If not, we fall back to a "Default" set or just the Diamond itself (you might want to configure this).
// For now, if no deployment, we'll try to guess based on config or just warn.
let contractConfig: any = {
  name: CONTRACT_NAME,
  abi: [],
};

if (deployment) {
  console.log(`✅ Found deployment at ${deployment.diamond}`);

  const facetNames = Object.keys(deployment.facets);
  // Include the Diamond Proxy itself + all Facets
  const contractsToMerge = [CONTRACT_NAME, ...facetNames];

  console.log(`   Merging ABIs from ${contractsToMerge.length} contracts...`);

  const abis = contractsToMerge.map(loadAbi);
  const mergedAbi = mergeAbis(abis);

  contractConfig = {
    name: CONTRACT_NAME,
    address: deployment.diamond,
    abi: mergedAbi,
  };
} else {
  console.log(
    `⚠️  Generating ABI for ${CONTRACT_NAME} only (no deployment found)`,
  );
  contractConfig = {
    name: CONTRACT_NAME,
    abi: loadAbi(CONTRACT_NAME),
  };
}

export default defineConfig({
  out: "abi.ts",
  contracts: [contractConfig],
  plugins: [],
});
