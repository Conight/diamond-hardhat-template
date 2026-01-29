import { defineConfig } from "@wagmi/cli";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename, extname } from "path";
import type { Abi, Address } from "viem";

/**
 * Diamond-Standard Configuration
 *
 * Capabilities:
 * 1. Auto-Discovery: Scans `deployment/` for ANY contract that looks like a Diamond.
 * 2. Multi-Chain Aggregation: Aggregates deployments across all networks.
 * 3. Superset ABIs: Merges Facets from ALL chains into a single "Master Interface".
 * 4. Start Block Extraction: Exports deployment block numbers for Indexers.
 */

// --- Constants ---
const PROJECT_ROOT = process.cwd();
const ARTIFACTS_DIR = join(PROJECT_ROOT, "artifacts", "contracts");
const DEPLOYMENTS_DIR = join(PROJECT_ROOT, "deployment");

// Network -> ChainID Mapping
const NETWORK_TO_CHAIN_ID: Record<string, number> = {
  localhost: 31337,
};

// --- Types ---
interface DeploymentData {
  diamond: Address;
  blockNumber: string | number;
  facets: Record<string, { address: Address }>;
}

interface ContractMeta {
  addresses: Record<number, Address>;
  blockCreated: Record<number, number>;
  chainNames: Record<number, string>;
  uniqueFacets: Set<string>;
}

// --- Helpers ---

function findArtifactPath(dir: string, contractName: string): string | null {
  if (!existsSync(dir)) return null;
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

function loadAbi(contractName: string): Abi {
  const path = findArtifactPath(ARTIFACTS_DIR, contractName);
  if (!path) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")).abi as Abi;
  } catch (error) {
    console.error(`❌ Error parsing artifact ${contractName}:`, error);
    return [];
  }
}

function mergeAbis(abis: Abi[]): Abi {
  const uniqueItems = new Map<string, any>();
  for (const abi of abis) {
    for (const item of abi) {
      if (
        item.type === "function" ||
        item.type === "event" ||
        item.type === "error"
      ) {
        const inputs =
          "inputs" in item ? item.inputs.map((i: any) => i.type).join(",") : "";
        const key = `${item.type}:${item.name}(${inputs})`;
        if (!uniqueItems.has(key)) uniqueItems.set(key, item);
      } else {
        const key = JSON.stringify(item);
        if (!uniqueItems.has(key)) uniqueItems.set(key, item);
      }
    }
  }
  return Array.from(uniqueItems.values());
}

/**
 * Scans deployments, extracts Metadata (Address / Block).
 */
function scanDeployments() {
  const contracts = new Map<string, ContractMeta>();

  if (!existsSync(DEPLOYMENTS_DIR)) return contracts;

  const networks = readdirSync(DEPLOYMENTS_DIR);

  for (const network of networks) {
    const networkPath = join(DEPLOYMENTS_DIR, network);
    if (!statSync(networkPath).isDirectory()) continue;

    const chainId = NETWORK_TO_CHAIN_ID[network];
    if (!chainId) {
      console.warn(
        `⚠️  Skipping network "${network}": Add ID to NETWORK_TO_CHAIN_ID map.`,
      );
      continue;
    }

    const files = readdirSync(networkPath).filter(
      (f) => extname(f) === ".json",
    );

    for (const file of files) {
      const contractName = basename(file, ".json");
      const filePath = join(networkPath, file);

      try {
        const data = JSON.parse(
          readFileSync(filePath, "utf-8"),
        ) as DeploymentData;

        if (data.diamond && data.facets) {
          if (!contracts.has(contractName)) {
            contracts.set(contractName, {
              addresses: {},
              blockCreated: {},
              chainNames: {},
              uniqueFacets: new Set([contractName]),
            });
          }

          const meta = contracts.get(contractName)!;
          meta.addresses[chainId] = data.diamond;
          meta.blockCreated[chainId] = Number(data.blockNumber) || 0;
          meta.chainNames[chainId] = network;
          Object.keys(data.facets).forEach((facet) =>
            meta.uniqueFacets.add(facet),
          );
        }
      } catch (e) {
        console.warn(`❌ Failed to process ${file} in ${network}`);
      }
    }
  }

  return contracts;
}

// --- Execution ---

console.log("💎 Wagmi Generator Starting...");
const detectedContracts = scanDeployments();
const wagmiContracts: any[] = [];
const extraExports: string[] = []; // We will inject block numbers here

for (const [name, meta] of detectedContracts.entries()) {
  const facetCount = meta.uniqueFacets.size;

  console.log(`\n📦 Contract: ${name}`);
  console.table(
    Object.entries(meta.addresses).map(([chainId, addr]) => {
      const id = Number(chainId);
      return {
        Chain: `${meta.chainNames[id]}(${id})`,
        DiamondAddress: addr,
        StartBlock: meta.blockCreated[id],
      };
    }),
  );
  console.log(`   --> Merging ${facetCount} Facets into Superset ABI...`);

  const unifiedAbi = mergeAbis(Array.from(meta.uniqueFacets).map(loadAbi));

  wagmiContracts.push({
    name: name,
    address: meta.addresses,
    abi: unifiedAbi,
  });

  // Generate the Start Block Map manually
  const camelName = name.charAt(0).toLowerCase() + name.slice(1);
  extraExports.push(
    `export const ${camelName}StartBlock = ${JSON.stringify(
      meta.blockCreated,
    )} as const;`,
  );
}

/**
 * Custom Plugin to inject extra metadata
 */
function metadataPlugin() {
  return {
    name: "metadata-plugin",
    run: async () => {
      // This plugin runs after generation, but Wagmi plugins usually return content.
      // We will simply return the extra exports as a "content" block to be appended?
      // Actually, Wagmi plugins don't easily append to the main file unless we use the 'actions' API.
      // A simpler hack: We return a standard script with the extra data.
      return {
        content: extraExports.join("\n"),
      };
    },
  };
}

export default defineConfig({
  out: "abi.ts",
  contracts: wagmiContracts,
  plugins: [metadataPlugin()],
});
