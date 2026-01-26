import { defineConfig } from "@wagmi/cli";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { CustomNFT } from "./tasks/config.js";

// Helper: Recursively search for a file in a directory
function findFile(dir: string, filename: string): string | null {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      const found = findFile(filePath, filename);
      if (found) return found;
    } else if (file === filename) {
      return filePath;
    }
  }
  return null;
}

// Helper: Find artifact JSON path by Contract Name
function getArtifactPath(contractName: string): string {
  // Hardhat artifacts structure: artifacts/contracts/.../ContractName.sol/ContractName.json
  // We search inside artifacts/contracts
  const searchDir = "./artifacts/contracts";
  const fileName = `${contractName}.json`;
  const path = findFile(searchDir, fileName);

  if (!path) {
    throw new Error(`Artifact not found for contract: ${contractName}`);
  }
  return path;
}

// Helper: Load ABI from artifact path
function loadAbi(path: string) {
  try {
    const content = readFileSync(path, "utf8");
    return JSON.parse(content).abi;
  } catch (e) {
    console.warn(`Warning: Could not load artifact at ${path}`);
    return [];
  }
}

// Helper: Merge ABIs for a list of facet names + the Diamond contract itself
function getDiamondAbi(diamondName: string, facetNames: string[]) {
  // Always include the Diamond contract itself (e.g. CoreDiamond)
  const allNames = [...new Set([diamondName, ...facetNames])];

  return allNames.flatMap((name) => {
    try {
      const path = getArtifactPath(name);
      return loadAbi(path);
    } catch (e) {
      console.warn((e as Error).message);
      return [];
    }
  });
}

export default defineConfig({
  out: "abi.ts",
  contracts: [
    {
      name: "CustomNFTDiamond",
      abi: getDiamondAbi("CustomNFTDiamond", CustomNFT.facets),
    },
  ],
  plugins: [],
});
