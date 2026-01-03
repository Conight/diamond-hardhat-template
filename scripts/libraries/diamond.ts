import hre, { artifacts } from "hardhat";
import {
  type Abi,
  type AbiFunction,
  type Address,
  GetTransactionReceiptReturnType,
  toFunctionSelector,
  toFunctionSignature,
  zeroAddress,
  zeroHash,
} from "viem";
import Table from "cli-table3";
import chalk from "chalk";
import { createInterface } from "node:readline";
import existsSelectors from "./selectors.json";
import path from "node:path";
import * as fs from "node:fs/promises";
import type { NetworkConnection } from "hardhat/types/network";

// ============================================================================
// Constants
// ============================================================================

const SIGNATURES_TO_IGNORE = new Set(["supportsInterface(bytes4)"]);
const DIAMOND_SPEC_CONTRACTS = [
  "DiamondUpgradeFacet",
  "DiamondInspectFacet",
  "OwnerFacet",
] as const;

// ============================================================================
// Types
// ============================================================================

type SelectorString = `0x${string}`;
type FunctionType = "add" | "replace" | "ignored";

interface Facet {
  facet: Address;
  selector: SelectorString;
}

interface ChangedFunctions {
  contractName?: string;
  facet: Address;
  selectors: readonly SelectorString[];
}

interface SelectorDiff {
  add: SelectorString[];
  replace: SelectorString[];
  ignored: SelectorString[];
  facet: Address;
}

interface SelectorInfo {
  signature: string;
  contracts: string[];
}

interface DeploymentReceipt {
  selector: SelectorString;
  signature: string;
  contract: string;
  contractAddress: Address;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  from: Address;
}

// ============================================================================
// DiamondChanges Class
// ============================================================================

export class DiamondChanges {
  #selectorDiffs = new Map<string, SelectorDiff>();
  #removeFunctions = new Set<SelectorString>();
  #previous?: readonly Facet[];
  #deployed = false;
  #deployedContracts = new Map<string, GetTransactionReceiptReturnType>();

  private constructor(
    selectorDiffs: Map<string, SelectorDiff>,
    removeFunctions: Set<SelectorString>,
    previous?: readonly Facet[]
  ) {
    this.#selectorDiffs = selectorDiffs;
    this.#removeFunctions = removeFunctions;
    this.#previous = previous;
  }

  // --------------------------------------------------------------------------
  // Public Getters
  // --------------------------------------------------------------------------

  /**
   * Get functions to be added to the diamond
   */
  public getAddFunctions(): ChangedFunctions[] {
    return this.#getChangedFunctions("add");
  }

  /**
   * Get functions to be replaced in the diamond
   */
  public getReplaceFunctions(): ChangedFunctions[] {
    return this.#getChangedFunctions("replace");
  }

  /**
   * Get functions to be removed from the diamond
   */
  public getRemoveFunctions(): SelectorString[] {
    if (!this.#previous) {
      throw new Error(
        "DiamondChanges must be constructed with previous functions to find removals"
      );
    }
    return [...this.#removeFunctions];
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Generic method to get changed functions by type
   * Eliminates code duplication between getAddFunctions and getReplaceFunctions
   */
  #getChangedFunctions(type: FunctionType): ChangedFunctions[] {
    const result: ChangedFunctions[] = [];

    for (const [contractName, diff] of this.#selectorDiffs) {
      const selectors = type === "add" ? diff.add : diff.replace;

      if (selectors.length === 0) continue;

      result.push(
        this.#deployed
          ? { facet: diff.facet, selectors }
          : { contractName, facet: diff.facet, selectors }
      );
    }

    return result;
  }

  /**
   * Build deployment receipt for a selector
   */
  async #buildDeploymentReceipt(
    contractName: string,
    selector: SelectorString,
    receipt: GetTransactionReceiptReturnType
  ): Promise<DeploymentReceipt> {
    const { signature } = await this.#lookupSelector(selector);

    return {
      selector,
      signature,
      contract: contractName,
      contractAddress: receipt.contractAddress!,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      transactionHash: receipt.transactionHash,
      transactionIndex: receipt.transactionIndex,
      from: receipt.from,
    };
  }

  /**
   * Get deployment path for a diamond contract
   */
  static #getDeploymentPath(
    networkName: string,
    diamondContract: string
  ): string {
    return path.join(
      hre.config.paths.root,
      "deployment",
      networkName,
      `${diamondContract}.json`
    );
  }

  /**
   * Lookup selector information
   */
  async #lookupSelector(selector: string): Promise<SelectorInfo> {
    const selectors: Record<string, SelectorInfo | undefined> = existsSelectors;
    return selectors[selector] ?? { signature: selector, contracts: [] };
  }

  // --------------------------------------------------------------------------
  // Public Methods
  // --------------------------------------------------------------------------

  /**
   * Deploy all facet contracts
   */
  public async deploy(
    viem: NetworkConnection<"generic">["viem"]
  ): Promise<void> {
    if (this.#deployed) {
      console.log("Facets already deployed");
      return;
    }

    const publicClient = await viem.getPublicClient();
    const [deployWallet] = await viem.getWalletClients();

    console.log("Deploying facets");

    for (const [contractName, diff] of this.#selectorDiffs) {
      console.log(
        `  - Deploying ${contractName} with ${diff.add.length} selector(s)`
      );

      const artifact = await artifacts.readArtifact(contractName);
      const hash = await deployWallet.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode as `0x${string}`,
        args: [],
      });

      console.log(`    ${contractName} deploy hash: ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (!receipt.contractAddress) {
        throw new Error(`${contractName} deployment failed`);
      }

      // Update facet address
      diff.facet = receipt.contractAddress;
      this.#deployedContracts.set(contractName, receipt);

      console.log(`  ✓ ${contractName} deployed: ${receipt.contractAddress}`);
    }

    this.#deployed = true;
    console.log("Facets deployed");
  }

  /**
   * Save deployment information to file
   */
  public async saveDeployment(
    networkName: string,
    diamondContract: string,
    diamondDeployReceipt?: GetTransactionReceiptReturnType
  ): Promise<void> {
    const outputDir = path.join(
      hre.config.paths.root,
      "deployment",
      networkName
    );
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = DiamondChanges.#getDeploymentPath(
      networkName,
      diamondContract
    );
    const facetFunctions = await this.#getFacets();

    let deployment: any;

    if (this.#previous) {
      // Upgrade existing deployment
      const deployed = await fs.readFile(outputPath, "utf-8");
      deployment = JSON.parse(deployed);
      deployment.functions = facetFunctions;
    } else {
      // New deployment
      if (!diamondDeployReceipt) {
        throw new Error(
          "Diamond deployment receipt is required for new deployments"
        );
      }

      deployment = {
        diamond: diamondDeployReceipt.contractAddress,
        functions: facetFunctions,
        owner: diamondDeployReceipt.from,
        blockNumber: diamondDeployReceipt.blockNumber,
        blockHash: diamondDeployReceipt.blockHash,
        upgradeHistory: [],
      };
    }

    await fs.writeFile(
      outputPath,
      JSON.stringify(deployment, this.#bigIntReplacer, 2)
    );

    console.log(`\n💾 Deployment file saved to: ${outputPath}`);
  }

  /**
   * Display changes and prompt for confirmation
   */
  public async verify(): Promise<boolean> {
    const table = new Table({
      head: ["Action", "Selector", "Signature", "Facet"],
    });

    // Add/Replace/Ignored functions
    for (const [contractName, diff] of this.#selectorDiffs) {
      await this.#addTableRows(
        table,
        diff.add,
        "Added",
        chalk.blue,
        contractName
      );
      await this.#addTableRows(
        table,
        diff.replace,
        "Replaced",
        chalk.green,
        contractName
      );
      await this.#addTableRows(
        table,
        diff.ignored,
        "Ignored",
        chalk.gray,
        contractName
      );
    }

    // Remove functions
    for (const selector of this.#removeFunctions) {
      const info = await this.#lookupSelector(selector);
      table.push([
        chalk.red("Removed"),
        selector,
        info.signature,
        info.contracts.join(", "),
      ]);
    }

    if (table.length === 0) {
      console.log("No changes detected");
      return false;
    }

    console.log(table.toString());
    return this.#promptUser(
      "Review the table of Diamond changes. Proceed with upgrade? yN "
    );
  }

  // --------------------------------------------------------------------------
  // Private Method Helpers
  // --------------------------------------------------------------------------

  /**
   * Get all facets for deployment
   */
  async #getFacets(): Promise<DeploymentReceipt[]> {
    const facets: DeploymentReceipt[] = [];

    for (const [contractName, diff] of this.#selectorDiffs) {
      const receipt = this.#deployedContracts.get(contractName);
      if (!receipt) {
        throw new Error(`Facet ${contractName} not deployed`);
      }

      const selectors = [...diff.add, ...diff.replace];
      const receipts = await Promise.all(
        selectors.map((selector) =>
          this.#buildDeploymentReceipt(contractName, selector, receipt)
        )
      );

      facets.push(...receipts);
    }

    return facets;
  }

  /**
   * Add table rows for selectors
   */
  async #addTableRows(
    table: Table.Table,
    selectors: SelectorString[],
    action: string,
    colorFn: typeof chalk.blue,
    contractName: string
  ): Promise<void> {
    for (const selector of selectors) {
      const info = await this.#lookupSelector(selector);
      table.push([colorFn(action), selector, info.signature, contractName]);
    }
  }

  /**
   * Prompt user for confirmation
   */
  #promptUser(question: string): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<boolean>((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === "y" || normalized === "yes");
      });
    });
  }

  /**
   * BigInt JSON replacer
   */
  #bigIntReplacer = (_key: string, value: any) =>
    typeof value === "bigint" ? value.toString() : value;

  // --------------------------------------------------------------------------
  // Static Factory Methods
  // --------------------------------------------------------------------------

  /**
   * Create DiamondChanges from contract names
   */
  public static async create(
    contractNames: string[],
    previous?: readonly Facet[]
  ): Promise<DiamondChanges> {
    const selectorDiffs = new Map<string, SelectorDiff>();
    const removeFunctions = new Set<SelectorString>();
    const allNewSelectors = new Set<SelectorString>();

    // Process each contract
    for (const contractName of contractNames) {
      const diff = await this.#processContract(contractName, previous);
      selectorDiffs.set(contractName, diff);

      // Track all new selectors
      diff.add.forEach((s) => allNewSelectors.add(s));
      diff.replace.forEach((s) => allNewSelectors.add(s));
    }

    // Determine functions to remove
    if (previous) {
      for (const { selector } of previous) {
        if (
          !allNewSelectors.has(selector) &&
          // this.#needsIncluded(signature) &&
          !(await this.#isDiamondSpecSelector(selector))
        ) {
          removeFunctions.add(selector);
        }
      }
    }

    return new DiamondChanges(selectorDiffs, removeFunctions, previous);
  }

  /**
   * Process a single contract to determine selector changes
   */
  static async #processContract(
    contractName: string,
    previous?: readonly Facet[]
  ): Promise<SelectorDiff> {
    const diff: SelectorDiff = {
      add: [],
      replace: [],
      ignored: [],
      facet: zeroAddress,
    };

    const artifact = await artifacts.readArtifact(contractName);
    const signatures = this.#getSignatures(artifact.abi as Abi);

    for (const signature of signatures) {
      const selector = toFunctionSelector(signature);

      if (this.#needsIncluded(signature)) {
        // For functions that need to be included in the diamond
        const exists = previous?.some((item) => item.selector === selector);
        (exists ? diff.replace : diff.add).push(selector);
      } else if (previous) {
        // For ignored functions: only mark as ignored if upgrading existing deployment
        diff.ignored.push(selector);
      } else {
        // For new deployments: include all functions even if they're normally ignored
        diff.add.push(selector);
      }
    }

    return diff;
  }

  /**
   * Get function signatures from ABI
   */
  static #getSignatures(abi: Abi): AbiFunction[] {
    return abi.filter((item): item is AbiFunction => item.type === "function");
  }

  /**
   * Check if signature should be included
   */
  static #needsIncluded(abiFunction: AbiFunction): boolean {
    return !SIGNATURES_TO_IGNORE.has(toFunctionSignature(abiFunction));
  }

  /**
   * Check if selector belongs to Diamond specification contracts
   */
  static async #isDiamondSpecSelector(
    selector: SelectorString
  ): Promise<boolean> {
    const diamondSelectors = new Set<string>();

    for (const contractName of DIAMOND_SPEC_CONTRACTS) {
      const artifact = await artifacts.readArtifact(contractName);
      const signatures = this.#getSignatures(artifact.abi as Abi);

      for (const sig of signatures) {
        diamondSelectors.add(toFunctionSelector(sig));
      }
    }

    return diamondSelectors.has(selector);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Load deployment configuration from file
 */
export async function loadDeployment(
  networkName: string,
  diamondContract: string
): Promise<any> {
  try {
    const deploymentPath = path.join(
      hre.config.paths.root,
      "deployment",
      networkName,
      `${diamondContract}.json`
    );
    const deployment = await import(deploymentPath);
    return deployment.default;
  } catch (e) {
    console.log(`Deployment not found for network: ${networkName}`);
    return null;
  }
}

/**
 * Deploy a new Diamond proxy with facets
 */
export async function deployDiamond(
  viem: NetworkConnection<"generic">["viem"],
  networkName: string,
  diamondContract: string,
  facets: string[]
): Promise<Address | undefined> {
  await hre.tasks.getTask("selectors").run();

  console.log(`Deploying ${diamondContract} to ${networkName}...`);

  const changes = await DiamondChanges.create(facets);
  const shouldDeploy = await changes.verify();

  if (!shouldDeploy) {
    console.log("Deployment aborted");
    return;
  }

  await changes.deploy(viem);

  // Deploy Diamond contract
  const publicClient = await viem.getPublicClient();
  const [deployWallet] = await viem.getWalletClients();
  const artifact = await artifacts.readArtifact(diamondContract);

  const hash = await deployWallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as `0x${string}`,
    args: [changes.getAddFunctions(), deployWallet.account.address],
  });

  console.log(`${artifact.contractName} deploy hash: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error(`${artifact.contractName} deployment failed`);
  }

  console.log(`${diamondContract} deployed: ${receipt.contractAddress}`);
  await changes.saveDeployment(networkName, diamondContract, receipt);

  return receipt.contractAddress;
}

/**
 * Upgrade an existing Diamond proxy
 */
export async function upgradeDiamond(
  viem: NetworkConnection<"generic">["viem"],
  networkName: string,
  diamondContract: string,
  facets: string[]
): Promise<Address | undefined> {
  await hre.tasks.getTask("selectors").run();

  console.log(`Upgrading ${diamondContract} on ${networkName}...`);

  // Load existing deployment
  const deployment = await loadDeployment(networkName, diamondContract);
  if (!deployment?.diamond) {
    throw new Error(
      `No existing deployment found for ${diamondContract} on ${networkName}`
    );
  }

  const diamondAddress = deployment.diamond;

  // Get current facets
  const diamondLoupe = await viem.getContractAt(
    "DiamondInspectFacet",
    diamondAddress
  );
  const previousFacets = await diamondLoupe.read.functionFacetPairs();

  // Determine changes
  const changes = await DiamondChanges.create(facets, previousFacets);
  const shouldUpgrade = await changes.verify();

  if (!shouldUpgrade) {
    console.log("Upgrade aborted");
    return;
  }

  await changes.deploy(viem);

  // Execute upgrade
  const diamondUpgrade = await viem.getContractAt(
    "DiamondUpgradeFacet",
    diamondAddress
  );
  const publicClient = await viem.getPublicClient();

  const tx = await diamondUpgrade.write.upgradeDiamond([
    changes.getAddFunctions(),
    changes.getReplaceFunctions(),
    changes.getRemoveFunctions(),
    zeroAddress,
    "0x",
    zeroHash,
    "0x",
  ]);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(
    `${diamondContract} upgrade with hash: ${receipt.transactionHash}`
  );

  await changes.saveDeployment(networkName, diamondContract);

  console.log(`Diamond upgraded: ${diamondAddress}`);

  return diamondAddress;
}
