import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { type AbiFunction, toFunctionSelector } from "viem";
import { formatAbiItem } from "viem/utils";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ========== Constants ==========
const OUTPUT_SUBDIR = ["scripts", "libraries"] as const;
const OUTPUT_FILENAME = "selectors.json" as const;
const PARALLEL_BATCH_SIZE = 50; // Process artifacts in batches to prevent memory issues
const JSON_INDENT = 2 as const;

// ========== Type Definitions ==========
interface TaskArguments {
  /** If true, overwrite the existing selectors.json file */
  readonly overwrite: boolean;
}

interface SelectorInfo {
  readonly signature: string;
  readonly contracts: readonly string[];
}

// Internal structure using Set for automatic deduplication
interface InternalSelectorInfo {
  signature: string;
  contracts: Set<string>;
}

interface ProcessingStats {
  totalArtifacts: number;
  processedArtifacts: number;
  failedArtifacts: number;
  newSelectors: number;
  updatedContracts: number;
  totalFunctions: number;
  skippedFunctions: number;
}

interface SelectorMapData {
  readonly [selector: string]: SelectorInfo;
}

// Custom error types for better error handling
class SelectorTaskError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "SelectorTaskError";
  }
}

// ========== Helper Functions ==========

/**
 * Safely checks if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads existing selectors from disk with proper error handling
 */
async function loadExistingSelectors(
  outputPath: string
): Promise<Map<string, InternalSelectorInfo>> {
  const selectorMap = new Map<string, InternalSelectorInfo>();

  try {
    console.log(`📂 Loading existing selectors from: ${outputPath}`);
    const fileContent = await fs.readFile(outputPath, "utf-8");
    const existingData: SelectorMapData = JSON.parse(fileContent);

    for (const [selector, info] of Object.entries(existingData)) {
      selectorMap.set(selector, {
        signature: info.signature,
        contracts: new Set(info.contracts),
      });
    }

    console.log(`✨ Loaded ${selectorMap.size} existing selectors.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ Could not parse existing selectors.json: ${errorMessage}`);
  }

  return selectorMap;
}

/**
 * Extracts the short name from a fully qualified contract name
 */
function extractShortName(fullyQualifiedName: string): string {
  const parts = fullyQualifiedName.split(":");
  return parts[parts.length - 1] ?? fullyQualifiedName;
}

/**
 * Type guard to check if an ABI item is a function
 */
function isAbiFunction(item: unknown): item is AbiFunction {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "function"
  );
}

/**
 * Processes a single artifact and updates the selector map
 */
async function processArtifact(
  name: string,
  hre: HardhatRuntimeEnvironment,
  selectorMap: Map<string, InternalSelectorInfo>,
  stats: ProcessingStats
): Promise<void> {
  try {
    const artifact = await hre.artifacts.readArtifact(name);
    const functions = artifact.abi.filter(isAbiFunction);

    if (functions.length === 0) {
      stats.processedArtifacts++;
      return;
    }

    const shortName = extractShortName(name);
    stats.totalFunctions += functions.length;

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
          stats.newSelectors++;
        }

        // Track if we're adding a new contract reference
        const hadContract = info.contracts.has(shortName);
        info.contracts.add(shortName);

        if (!hadContract) {
          stats.updatedContracts++;
        }
      } catch (error) {
        stats.skippedFunctions++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn(`  ⚠️ Skipping ${func.name}: ${errorMessage}`);
      }
    }

    stats.processedArtifacts++;
  } catch (error) {
    stats.failedArtifacts++;
    console.error(`  ❌ Failed to process artifact ${name}:`, error);
  }
}

/**
 * Processes artifacts in controlled batches to prevent overwhelming the system
 */
async function processArtifactsInBatches(
  fullyQualifiedNames: readonly string[],
  hre: HardhatRuntimeEnvironment,
  selectorMap: Map<string, InternalSelectorInfo>,
  stats: ProcessingStats
): Promise<void> {
  const batches: string[][] = [];

  // Split into batches
  for (let i = 0; i < fullyQualifiedNames.length; i += PARALLEL_BATCH_SIZE) {
    batches.push(
      fullyQualifiedNames.slice(i, i + PARALLEL_BATCH_SIZE) as string[]
    );
  }

  console.log(`📦 Processing in ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (!batch) continue;

    console.log(
      `   Batch ${i + 1}/${batches.length} (${batch.length} artifacts)...`
    );

    await Promise.all(
      batch.map((name) => processArtifact(name, hre, selectorMap, stats))
    );
  }
}

/**
 * Converts the internal selector map to a sorted, serializable format
 */
function serializeSelectorMap(
  selectorMap: Map<string, InternalSelectorInfo>
): SelectorMapData {
  const sortedEntries = Array.from(selectorMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return Object.fromEntries(
    sortedEntries.map(([selector, info]) => [
      selector,
      {
        signature: info.signature,
        // Sort contracts for deterministic output
        contracts: Array.from(info.contracts).sort(),
      } satisfies SelectorInfo,
    ])
  );
}

/**
 * Prints detailed statistics about the processing
 */
function printStats(stats: ProcessingStats, totalSelectors: number): void {
  console.log(`\n📊 Processing Statistics:`);
  console.log(`   • Total artifacts: ${stats.totalArtifacts}`);
  console.log(`   • Successfully processed: ${stats.processedArtifacts}`);
  console.log(`   • Failed: ${stats.failedArtifacts}`);
  console.log(`   • Total functions found: ${stats.totalFunctions}`);
  console.log(`   • Skipped functions: ${stats.skippedFunctions}`);
  console.log(`   • New selectors: ${stats.newSelectors}`);
  console.log(`   • Updated contract references: ${stats.updatedContracts}`);
  console.log(`   • Total unique selectors: ${totalSelectors}`);
}

// ========== Main Task Function ==========

/**
 * Main task function that generates a selector mapping file
 * from all compiled contract artifacts.
 */
export default async function selectorsTask(
  taskArguments: TaskArguments,
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  console.log("🚀 Starting selectors task...\n");

  try {
    // Step 1: Compile contracts
    console.log("🔨 Compiling contracts...");
    await hre.tasks.getTask("compile").run();
    console.log("✅ Compilation complete.\n");

    // Step 2: Setup paths
    const outputDir = path.join(hre.config.paths.root, ...OUTPUT_SUBDIR);
    const outputPath = path.join(outputDir, OUTPUT_FILENAME);

    // Step 3: Initialize selector map
    const selectorMap = new Map<string, InternalSelectorInfo>();

    // Step 4: Load existing data if needed
    const shouldLoadExisting =
      (await fileExists(outputPath)) && !taskArguments.overwrite;

    if (shouldLoadExisting) {
      const existingSelectors = await loadExistingSelectors(outputPath);
      for (const [selector, info] of existingSelectors) {
        selectorMap.set(selector, info);
      }
    } else {
      console.log(
        "🆕 No existing selectors file found or overwrite flag is set. Creating new one.\n"
      );
    }

    // Step 5: Get all artifacts
    const fullyQualifiedNames = await hre.artifacts.getAllFullyQualifiedNames();
    const artifactNames = Array.from(fullyQualifiedNames);
    console.log(`🔍 Found ${artifactNames.length} artifacts to process.\n`);

    // Step 6: Initialize stats
    const stats: ProcessingStats = {
      totalArtifacts: artifactNames.length,
      processedArtifacts: 0,
      failedArtifacts: 0,
      newSelectors: 0,
      updatedContracts: 0,
      totalFunctions: 0,
      skippedFunctions: 0,
    };

    // Step 7: Process all artifacts
    await processArtifactsInBatches(artifactNames, hre, selectorMap, stats);

    console.log("\n🎉 Processed all artifacts.");

    // Step 8: Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Step 9: Serialize and save
    const sortedSelectors = serializeSelectorMap(selectorMap);
    await fs.writeFile(
      outputPath,
      JSON.stringify(sortedSelectors, null, JSON_INDENT)
    );

    console.log(`\n💾 Selectors saved to: ${outputPath}`);

    // Step 10: Print final statistics
    printStats(stats, Object.keys(sortedSelectors).length);
  } catch (error) {
    if (error instanceof SelectorTaskError) {
      throw error;
    }

    throw new SelectorTaskError(
      "Failed to execute selectors task",
      "TASK_EXECUTION_ERROR",
      error
    );
  }
}
