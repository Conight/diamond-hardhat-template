import hre, { artifacts } from "hardhat";
import {
  type Abi,
  type AbiFunction,
  type Address,
  type GetTransactionReceiptReturnType,
  toFunctionSelector,
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
// Types
// ============================================================================

type HashString = `0x${string}`;
type FunctionType = "add" | "replace" | "ignored";
type ViemConnection = NetworkConnection<"generic">["viem"];

interface Facet {
  facet: Address;
  selector: HashString;
}

interface ChangedFunctions {
  contractName?: string;
  facet: Address;
  selectors: readonly HashString[];
}

interface SelectorDiff {
  add: HashString[];
  replace: HashString[];
  ignored: HashString[];
  facet: Address;
}

interface SelectorInfo {
  signature: string;
  contracts: string[];
}

interface DeploymentReceipt {
  selector: HashString;
  signature: string;
  contract: string;
}

interface DeploymentFacet {
  address: Address;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  from: Address;
}

interface DiamondDeployment {
  diamond: Address;
  functions: DeploymentReceipt[];
  owner: Address;
  blockNumber: bigint;
  blockHash: string;
  facets: Record<string, DeploymentFacet>;
  upgradeHistory: unknown[];
}

// ============================================================================
// DiamondChanges Class
// ============================================================================

export class DiamondChanges {
  #viem: ViemConnection;
  #networkName: string;
  #diamondName: string;
  #selectorDiffs: Map<string, SelectorDiff>;
  #removeFunctions: Set<HashString>;
  #upgradeMode: boolean = false;

  #deployment?: DiamondDeployment;

  #deployedContracts = new Map<string, GetTransactionReceiptReturnType>();
  #deployed = false;

  private constructor(
    viem: ViemConnection,
    networkName: string,
    diamondName: string,
    selectorDiffs: Map<string, SelectorDiff>,
    removeFunctions: Set<HashString>,
    upgradeMode: boolean = false,
    deployment?: DiamondDeployment
  ) {
    this.#viem = viem;
    this.#networkName = networkName;
    this.#diamondName = diamondName;
    this.#selectorDiffs = selectorDiffs;
    this.#removeFunctions = removeFunctions;
    this.#upgradeMode = upgradeMode;
    this.#deployment = deployment;
  }

  // --------------------------------------------------------------------------
  // Public Getters
  // --------------------------------------------------------------------------

  /** Get functions to be added to the diamond */
  public getAddFunctions(): ChangedFunctions[] {
    return this.#getChangedFunctions("add");
  }

  /** Get functions to be replaced in the diamond */
  public getReplaceFunctions(): ChangedFunctions[] {
    return this.#getChangedFunctions("replace");
  }

  /** Get functions to be removed from the diamond */
  public getRemoveFunctions(): HashString[] {
    if (!this.#upgradeMode) {
      throw new Error(
        "DiamondChanges must be constructed with previous functions to find removals"
      );
    }
    return Array.from(this.#removeFunctions);
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Generic method to get changed functions by type
   * Eliminates code duplication between getAddFunctions and getReplaceFunctions
   */
  #getChangedFunctions(
    type: Exclude<FunctionType, "ignored">
  ): ChangedFunctions[] {
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

  /** Build deployment receipt for a selector */
  async #buildDeploymentReceipt(
    contractName: string,
    selector: HashString
  ): Promise<DeploymentReceipt> {
    const { signature } = await this.#lookupSelector(selector);
    return { selector, signature, contract: contractName };
  }

  /** Get deployment path for a diamond contract */
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

  /** Lookup selector information */
  async #lookupSelector(selector: string): Promise<SelectorInfo> {
    const selectors = existsSelectors as Record<
      string,
      SelectorInfo | undefined
    >;
    return selectors[selector] ?? { signature: selector, contracts: [] };
  }

  // --------------------------------------------------------------------------
  // Public Methods
  // --------------------------------------------------------------------------

  /** Deploy all facet contracts */
  public async deploy(): Promise<HashString> {
    const publicClient = await this.#viem.getPublicClient();
    const [deployWallet] = await this.#viem.getWalletClients();

    let diamondAddress: Address;

    if (!this.#upgradeMode) {
      // Deploy Diamond contract
      const artifact = await artifacts.readArtifact(this.#diamondName);

      const hash = await deployWallet.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode as HashString,
        args: [this.getAddFunctions(), deployWallet.account.address],
      });

      console.log(`${artifact.contractName} deploy hash: ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (!receipt.contractAddress) {
        throw new Error(`${artifact.contractName} deployment failed`);
      }

      console.log(`${this.#diamondName} deployed: ${receipt.contractAddress}`);
      await this.saveDeployment(receipt);
      diamondAddress = receipt.contractAddress;
    } else {
      console.log("Deploying facets");

      for (const [contractName, diff] of this.#selectorDiffs) {
        if (diff.add.length + diff.replace.length === 0) {
          continue;
        }
        console.log(
          `  - Deploying ${contractName} with ${diff.add.length} selector(s)`
        );

        const artifact = await artifacts.readArtifact(contractName);
        const hash = await deployWallet.deployContract({
          abi: artifact.abi,
          bytecode: artifact.bytecode as HashString,
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

      console.log("Facets deployed");
      diamondAddress = this.#deployment!.diamond;

      if (this.#deployedContracts.size > 0) {
        // Execute upgrade
        const diamondUpgrade = await this.#viem.getContractAt(
          "DiamondUpgradeFacet",
          diamondAddress
        );

        const tx = await diamondUpgrade.write.upgradeDiamond([
          this.getAddFunctions(),
          this.getReplaceFunctions(),
          this.getRemoveFunctions(),
          zeroAddress,
          "0x",
          zeroHash,
          "0x",
        ]);

        const receipt = await publicClient.waitForTransactionReceipt({
          hash: tx,
        });
        console.log(
          `${this.#diamondName} upgrade with hash: ${receipt.transactionHash}`
        );

        await this.saveDeployment();

        console.log(`Diamond upgraded: ${diamondAddress}`);
      }
    }
    this.#deployed = true;
    return diamondAddress;
  }

  #getDeployedFacets(
    existingFacets?: Record<string, DeploymentFacet>
  ): Record<string, DeploymentFacet> {
    const facets: Record<string, DeploymentFacet> = existingFacets ?? {};

    for (const [contractName, receipt] of this.#deployedContracts) {
      if (receipt.contractAddress) {
        facets[contractName] = {
          address: receipt.contractAddress,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          transactionHash: receipt.transactionHash,
          transactionIndex: receipt.transactionIndex,
          from: receipt.from,
        };
      }
    }

    return facets;
  }

  /** Save deployment information to file */
  public async saveDeployment(
    diamondDeployReceipt?: GetTransactionReceiptReturnType
  ): Promise<void> {
    const outputDir = path.join(
      hre.config.paths.root,
      "deployment",
      this.#networkName
    );
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = DiamondChanges.#getDeploymentPath(
      this.#networkName,
      this.#diamondName
    );
    const facetFunctions = await this.#getFacets();

    let deployment: DiamondDeployment;

    if (this.#upgradeMode) {
      // Upgrade existing deployment
      const deployed = await fs.readFile(outputPath, "utf-8");
      const existingDeployment = JSON.parse(deployed) as DiamondDeployment;

      // Merge existing facets with new ones
      const updatedFacets = this.#getDeployedFacets(existingDeployment.facets);

      deployment = {
        ...existingDeployment,
        functions: facetFunctions,
        facets: updatedFacets,
      };
    } else {
      // New deployment
      if (!diamondDeployReceipt) {
        throw new Error(
          "Diamond deployment receipt is required for new deployments"
        );
      }

      deployment = {
        diamond: diamondDeployReceipt.contractAddress!,
        functions: facetFunctions,
        owner: diamondDeployReceipt.from,
        blockNumber: diamondDeployReceipt.blockNumber,
        blockHash: diamondDeployReceipt.blockHash,
        facets: this.#getDeployedFacets(),
        upgradeHistory: [],
      };
    }

    await fs.writeFile(
      outputPath,
      JSON.stringify(deployment, this.#jsonReplacer, 2)
    );

    console.log(`\n💾 Deployment file saved to: ${outputPath}`);
  }

  /** Display changes and prompt for confirmation */
  public async verify(): Promise<boolean> {
    const table = new Table({
      head: ["Action", "Selector", "Signature", "Facet"],
    });

    // Add/Replace/Ignored functions
    for (const [facet, diff] of this.#selectorDiffs) {
      await this.#addTableRows(table, diff.add, "Added", chalk.blue, facet);
      await this.#addTableRows(
        table,
        diff.replace,
        "Replaced",
        chalk.green,
        facet
      );
      await this.#addTableRows(
        table,
        diff.ignored,
        "Ignored",
        chalk.gray,
        facet
      );
    }

    // Remove functions
    for (const selector of this.#removeFunctions) {
      const info = await this.#lookupSelector(selector);
      table.push([
        chalk.red("Removed"),
        selector,
        this.#trimSelector(info.signature),
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

  /** Get all facets for deployment */
  async #getFacets(): Promise<DeploymentReceipt[]> {
    const facets: DeploymentReceipt[] = [];

    for (const [contractName, diff] of this.#selectorDiffs) {
      if (diff.add.length + diff.replace.length === 0) {
        continue;
      }
      const receipt = this.#deployedContracts.get(contractName);
      if (!receipt) {
        throw new Error(`Facet ${contractName} not deployed`);
      }

      const selectors = [...diff.add, ...diff.replace];
      const receipts = await Promise.all(
        selectors.map((selector) =>
          this.#buildDeploymentReceipt(contractName, selector)
        )
      );

      facets.push(...receipts);
    }

    return facets;
  }

  #trimSelector(selector: string): string {
    return selector.length > 20 ? `${selector.slice(0, 20)}...` : selector;
  }

  /** Add table rows for selectors */
  async #addTableRows(
    table: Table.Table,
    selectors: readonly HashString[],
    action: string,
    colorFn: (str: string) => string,
    contractName: string
  ): Promise<void> {
    for (const selector of selectors) {
      const info = await this.#lookupSelector(selector);
      table.push([
        colorFn(action),
        selector,
        this.#trimSelector(info.signature),
        contractName,
      ]);
    }
  }

  /** Prompt user for confirmation */
  async #promptUser(question: string): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      return await new Promise<boolean>((resolve) => {
        rl.question(question, (answer) => {
          const normalized = answer.trim().toLowerCase();
          resolve(normalized === "y" || normalized === "yes");
        });
      });
    } finally {
      rl.close();
    }
  }

  /** JSON replacer for BigInt and Map */
  #jsonReplacer = (_key: string, value: unknown): unknown => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Map) {
      return Object.fromEntries(value);
    }
    return value;
  };

  // --------------------------------------------------------------------------
  // Static Factory Methods
  // --------------------------------------------------------------------------

  /** Create DiamondChanges from contract names */
  public static async create(
    viem: ViemConnection,
    networkName: string,
    diamondName: string,
    facets: readonly string[],
    upgradeMode: boolean = false
  ): Promise<DiamondChanges> {
    const selectorDiffs = new Map<string, SelectorDiff>();
    const removeFunctions = new Set<HashString>();
    const publicClient = await viem.getPublicClient();
    const deployment = upgradeMode
      ? await loadDeployment(networkName, diamondName)
      : undefined;

    let previousFacets: readonly Facet[] | undefined = undefined;
    if (upgradeMode) {
      const diamondAddress = deployment!.diamond;

      // Get current facets
      const diamondLoupe = await viem.getContractAt(
        "DiamondInspectFacet",
        diamondAddress
      );
      previousFacets = await diamondLoupe.read.functionFacetPairs();
    }

    // Process each facet
    for (const facet of facets) {
      const diff: SelectorDiff = {
        add: [],
        replace: [],
        ignored: [],
        facet: zeroAddress,
      };
      let onchainBytecode: HashString | undefined = undefined;
      if (upgradeMode) {
        onchainBytecode = await publicClient.getCode({
          address: deployment!.facets[facet]!.address as Address,
        });
      }

      const artifact = await artifacts.readArtifact(facet);
      const signatures = this.#getSignatures(artifact.abi as Abi);
      const localBytecode = artifact.deployedBytecode as HashString;
      const facetChanged = onchainBytecode !== localBytecode;

      for (const signature of signatures) {
        const selector = toFunctionSelector(signature);

        // For new deployments: include all functions even if they're normally ignored
        if (!upgradeMode) {
          diff.add.push(selector);
          continue;
        }

        // For existing deployments: skip unchanged functions to ignored
        if (upgradeMode && !facetChanged) {
          diff.ignored.push(selector);
          continue;
        }

        const exists = previousFacets?.some(
          (item) => item.selector === selector
        );
        (exists ? diff.replace : diff.add).push(selector);
      }
      selectorDiffs.set(facet, diff);
    }

    return new DiamondChanges(
      viem,
      networkName,
      diamondName,
      selectorDiffs,
      removeFunctions,
      upgradeMode,
      deployment
    );
  }

  /** Get function signatures from ABI */
  static #getSignatures(abi: Abi): AbiFunction[] {
    return abi.filter((item): item is AbiFunction => item.type === "function");
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Load deployment configuration from file */
export async function loadDeployment(
  networkName: string,
  diamondContract: string
): Promise<DiamondDeployment> {
  try {
    const deploymentPath = path.join(
      hre.config.paths.root,
      "deployment",
      networkName,
      `${diamondContract}.json`
    );
    const content = await fs.readFile(deploymentPath, "utf-8");
    return JSON.parse(content) as DiamondDeployment;
  } catch (error) {
    throw new Error(`Deployment not found for network: ${networkName}`);
  }
}

/** Deploy a new Diamond proxy with facets */
export async function deployDiamond(
  viem: ViemConnection,
  networkName: string,
  diamondName: string,
  facets: readonly string[]
): Promise<Address | undefined> {
  await hre.tasks.getTask("selectors").run();

  console.log(`Deploying ${diamondName} to ${networkName}...`);

  const changes = await DiamondChanges.create(
    viem,
    networkName,
    diamondName,
    facets
  );
  const shouldDeploy = await changes.verify();

  if (!shouldDeploy) {
    console.log("Deployment aborted");
    return;
  }

  const diamondAddress = await changes.deploy();

  return diamondAddress;
}

/** Upgrade an existing Diamond proxy */
export async function upgradeDiamond(
  viem: ViemConnection,
  networkName: string,
  diamondName: string,
  facets: readonly string[]
): Promise<Address | undefined> {
  await hre.tasks.getTask("selectors").run();

  console.log(`Upgrading ${diamondName} on ${networkName}...`);

  // Determine changes
  const changes = await DiamondChanges.create(
    viem,
    networkName,
    diamondName,
    facets,
    true
  );
  const shouldUpgrade = await changes.verify();

  if (!shouldUpgrade) {
    console.log("Upgrade aborted");
    return;
  }

  const diamondAddress = await changes.deploy();

  return diamondAddress;
}
