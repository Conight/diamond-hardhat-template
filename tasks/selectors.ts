import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { type AbiFunction, toFunctionSelector } from "viem";
import { formatAbiItem } from "viem/utils";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface TaskArguments {
  /** if overwrite the existing selectors.json */
  overwrite: boolean;
}

interface SelectorInfo {
  signature: string;
  contracts: string[];
}

// Internal structure using Set for automatic deduplication
interface InternalSelectorInfo {
  signature: string;
  contracts: Set<string>;
}

export default async function selectorsTask(
  taskArguments: TaskArguments,
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  console.log("🚀 Starting selectors task...");

  // Run compile task to ensure artifacts are up to date
  console.log("🔨 Compiling contracts...");
  await hre.tasks.getTask("compile").run();
  console.log("✅ Compilation complete.\n");

  const outputDir = path.join(hre.config.paths.root, "scripts", "libraries");
  const outputPath = path.join(outputDir, "selectors.json");

  // Use a Map for better performance and order preservation during processing
  const selectorMap = new Map<string, InternalSelectorInfo>();

  // Load existing selectors
  const fileExists = await fs
    .access(outputPath)
    .then(() => true)
    .catch(() => false);

  if (fileExists && !taskArguments.overwrite) {
    try {
      console.log(`📂 Loading existing selectors from: ${outputPath}`);
      const fileContent = await fs.readFile(outputPath, "utf-8");
      const existingData: Record<string, SelectorInfo> =
        JSON.parse(fileContent);

      for (const [selector, info] of Object.entries(existingData)) {
        selectorMap.set(selector, {
          signature: info.signature,
          contracts: new Set(info.contracts),
        });
      }
      console.log(`✨ Loaded ${selectorMap.size} existing selectors.`);
    } catch (error) {
      console.warn(
        `⚠️ Could not parse existing selectors.json: ${
          (error as Error).message
        }`
      );
    }
  } else {
    console.log(
      "🆕 No existing selectors file found or overwrite flag is set. Creating new one."
    );
  }

  const fullyQualifiedNames = Array.from(
    await hre.artifacts.getAllFullyQualifiedNames()
  );
  console.log(`🔍 Found ${fullyQualifiedNames.length} artifacts to process.`);

  let newSelectorsCount = 0;
  let updatedContractsCount = 0;

  // Process artifacts in parallel for better performance
  await Promise.all(
    fullyQualifiedNames.map(async (name) => {
      try {
        const artifact = await hre.artifacts.readArtifact(name);
        // Filter for functions in the ABI using a type guard
        const functions = artifact.abi.filter(
          (item): item is AbiFunction => item.type === "function"
        );

        if (functions.length === 0) return;

        const shortName = name.split(":").pop() ?? name;

        for (const func of functions) {
          try {
            const selector = toFunctionSelector(func);
            const signature = formatAbiItem(func).replace(/^function /, "");

            let info = selectorMap.get(selector);

            if (!info) {
              info = {
                signature,
                contracts: new Set(),
              };
              selectorMap.set(selector, info);
              newSelectorsCount++;
            }

            // Using Set's size to check if an addition actually occurred
            const initialSize = info.contracts.size;
            info.contracts.add(shortName);
            if (info.contracts.size > initialSize) {
              updatedContractsCount++;
            }
          } catch (error) {
            console.warn(
              `  ⚠️ Skipping ${func.name}: ${(error as Error).message}`
            );
          }
        }
      } catch (error) {
        console.error(`  ❌ Failed to process artifact ${name}:`, error);
      }
    })
  );

  console.log(`\n🎉 Processed all artifacts.`);
  console.log(`   - New selectors found: ${newSelectorsCount}`);
  console.log(`   - Contract references updated: ${updatedContractsCount}`);

  // Ensure directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Convert Map to sorted object for consistency (ES2020+)
  // Using toSorted (ES2023) if available, or sort().
  // Sort by selector (key)
  const sortedEntries = Array.from(selectorMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const sortedSelectors: Record<string, SelectorInfo> = Object.fromEntries(
    sortedEntries.map(([selector, info]) => [
      selector,
      {
        signature: info.signature,
        // Sort contracts for deterministic output
        contracts: Array.from(info.contracts).sort(),
      },
    ])
  );

  await fs.writeFile(outputPath, JSON.stringify(sortedSelectors, null, 2));

  console.log(`\n💾 Selectors saved to: ${outputPath}`);
  console.log(
    `📊 Total unique selectors: ${Object.keys(sortedSelectors).length}`
  );
}
