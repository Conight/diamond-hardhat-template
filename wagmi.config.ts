import { defineConfig } from "@wagmi/cli";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Abi, Address } from "viem";
import { formatAbiItem } from "viem/utils";
import { buildDiamondAbi } from "./scripts/libraries/abi.js";
import type { DiamondDeployment } from "./scripts/libraries/types.js";

const artifactsDir = join(process.cwd(), "artifacts/contracts");
const deploymentsDir = join(process.cwd(), "deployment");
const artifactPaths = new Map<string, string[]>();
function collectArtifacts(directory: string): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) collectArtifacts(file);
    else if (entry.name.endsWith(".json")) {
      const name = entry.name.slice(0, -5);
      artifactPaths.set(name, [...(artifactPaths.get(name) ?? []), file]);
    }
  }
}
collectArtifacts(artifactsDir);
function loadAbi(name: string): Abi {
  const paths = artifactPaths.get(name) ?? [];
  if (paths.length !== 1)
    throw new Error(
      `Expected one artifact for ${name}, found ${paths.length}. Run pnpm compile.`,
    );
  return JSON.parse(readFileSync(paths[0], "utf8")).abi;
}

const contracts = new Map<
  string,
  {
    addresses: Record<number, Address>;
    blocks: Record<number, string>;
    abis: Abi[];
  }
>();
if (existsSync(deploymentsDir)) {
  for (const network of readdirSync(deploymentsDir, { withFileTypes: true })) {
    if (!network.isDirectory()) continue;
    const directory = join(deploymentsDir, network.name);
    for (const file of readdirSync(directory).filter((f) =>
      f.endsWith(".json"),
    )) {
      const data = JSON.parse(
        readFileSync(join(directory, file), "utf8"),
      ) as DiamondDeployment;
      if (
        data.version !== 3 ||
        data.standard !== "ERC-8153" ||
        !Number.isSafeInteger(data.chainId)
      ) {
        throw new Error(
          `${network.name}/${file}: expected an ERC-8153 deployment record`,
        );
      }
      const name = file.slice(0, -5);
      const entry = contracts.get(name) ?? {
        addresses: {},
        blocks: {},
        abis: [],
      };
      if (
        entry.addresses[data.chainId] &&
        entry.addresses[data.chainId].toLowerCase() !==
          data.diamond.toLowerCase()
      ) {
        throw new Error(
          `${name}: multiple deployment addresses for chain ${data.chainId}`,
        );
      }
      entry.addresses[data.chainId] = data.diamond;
      entry.blocks[data.chainId] = data.blockNumber;
      entry.abis.push(
        buildDiamondAbi(
          loadAbi(name),
          Object.entries(data.facets).map(([facetName, facet]) => ({
            abi: loadAbi(facetName),
            selectors: facet.selectors,
          })),
        ),
      );
      contracts.set(name, entry);
    }
  }
}
if (contracts.size === 0)
  throw new Error(
    "No ERC-8153 deployments found. Deploy a diamond before generating client ABIs.",
  );

// Each chain contributes only its routed functions. Canonical signatures preserve tuple overloads.
function mergeAbis(abis: Abi[]): Abi {
  const items = new Map<string, Abi[number]>();
  for (const item of abis.flat()) {
    const key =
      item.type === "function" || item.type === "event" || item.type === "error"
        ? `${item.type}:${formatAbiItem(item)}`
        : item.type;
    items.set(key, item);
  }
  return [...items.values()];
}
export default defineConfig({
  out: "abi.ts",
  contracts: [...contracts].map(([name, entry]) => ({
    name,
    address: entry.addresses,
    abi: mergeAbis(entry.abis),
  })),
  plugins: [
    {
      name: "deployment-blocks",
      run: async () => ({
        content: [...contracts]
          .map(
            ([name, entry]) =>
              `export const ${name[0].toLowerCase() + name.slice(1)}StartBlock = ${JSON.stringify(entry.blocks)} as const;`,
          )
          .join("\n"),
      }),
    },
  ],
});
