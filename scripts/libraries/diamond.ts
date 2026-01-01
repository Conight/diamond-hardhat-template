import hre, { artifacts } from "hardhat";
import {
  type Abi,
  type AbiFunction,
  type Address,
  GetTransactionReceiptReturnType,
  toFunctionSelector,
  toFunctionSignature,
  zeroAddress,
  type PublicClient,
  type WalletClient,
} from "viem";
import Table from "cli-table3";
import chalk from "chalk";
import { createInterface } from "node:readline";
import existsSelectors from "./selectors.json";
import path from "node:path";
import * as fs from "node:fs/promises";
import { NetworkConnection } from "hardhat/types/network";

const signaturesToIgnore = new Set(["supportsInterface(bytes4)"]);

type SelectorString = `0x${string}`;

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
  _addFunctions: SelectorString[];
  _replaceFunctions: SelectorString[];
  _ignoredFunctions: SelectorString[];
  _facet: Address;
}

export class DiamondChanges {
  #addAndReplaceFunctions = new Map<string, SelectorDiff>();
  #removeFunctions = new Set<SelectorString>();
  #previous?: readonly Facet[];
  #deployed = false;
  #deployedContracts = new Map<string, GetTransactionReceiptReturnType>();

  private constructor(
    addAndReplaceFunctions: Map<string, SelectorDiff>,
    removeFunctions: Set<SelectorString>,
    previous?: readonly Facet[]
  ) {
    this.#addAndReplaceFunctions = addAndReplaceFunctions;
    this.#removeFunctions = removeFunctions;
    this.#previous = previous;
  }

  /**
   * @returns Array of functions to be added to the diamond
   */
  public getAddFunctions(): ChangedFunctions[] {
    const addedFunctions: ChangedFunctions[] = [];
    for (const [contractName, changedSelectors] of this
      .#addAndReplaceFunctions) {
      if (changedSelectors._addFunctions.length === 0) {
        continue;
      }

      if (this.#deployed) {
        addedFunctions.push({
          facet: changedSelectors._facet,
          selectors: changedSelectors._addFunctions,
        });
      } else {
        addedFunctions.push({
          contractName,
          selectors: changedSelectors._addFunctions,
          facet: changedSelectors._facet,
        });
      }
    }
    return addedFunctions;
  }

  /**
   * @returns Array of functions to be replaced in the diamond
   */
  public getReplaceFunctions(): ChangedFunctions[] {
    const replaceFunctions: ChangedFunctions[] = [];
    for (const [contractName, changedSelectors] of this
      .#addAndReplaceFunctions) {
      if (changedSelectors._replaceFunctions.length === 0) {
        continue;
      }

      if (this.#deployed) {
        replaceFunctions.push({
          facet: changedSelectors._facet,
          selectors: changedSelectors._replaceFunctions,
        });
      } else {
        replaceFunctions.push({
          contractName,
          selectors: changedSelectors._replaceFunctions,
          facet: changedSelectors._facet,
        });
      }
    }
    return replaceFunctions;
  }

  /**
   * @returns Array of functions to be removed from the diamond
   */
  public getRemoveFunctions(): SelectorString[] {
    if (!this.#previous) {
      throw new Error(
        "You must construct DiamondChanges with previous functions to find removals"
      );
    }
    return [...this.#removeFunctions];
  }

  public async deploy(viem: NetworkConnection<"generic">["viem"]) {
    if (this.#deployed) {
      console.log("Facets already deployed");
      return;
    }

    const publicClient = await viem.getPublicClient();
    const [deployWallet] = await viem.getWalletClients();

    console.log("Deploying facets");
    for (const [contractName, changedSelectors] of this
      .#addAndReplaceFunctions) {
      console.log(
        `  - Deploying ${contractName} with selectors ${changedSelectors._addFunctions}`
      );

      const factArtifact = await artifacts.readArtifact(contractName);
      const hash = await deployWallet.deployContract({
        abi: factArtifact.abi,
        bytecode: factArtifact.bytecode as `0x${string}`,
        args: [],
      });

      console.log(`    ${contractName} deploy hash: ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (!receipt.contractAddress) {
        throw new Error(`    ${contractName} deployment failed`);
      }

      const diff = this.#addAndReplaceFunctions.get(contractName);
      if (diff) {
        diff._facet = receipt.contractAddress!;
      }

      this.#deployedContracts.set(contractName, receipt);

      console.log(`  * ${contractName} deployed: ${receipt.contractAddress}`);
    }
    this.#deployed = true;
    console.log("Facets deployed");
  }

  private static getSignatures(abis: Abi): AbiFunction[] {
    return abis.filter((abi): abi is AbiFunction => abi.type === "function");
  }

  private static needsIncluded(signature: AbiFunction) {
    return !signaturesToIgnore.has(toFunctionSignature(signature));
  }

  public static async create(
    contractNames: string[],
    previous?: readonly Facet[]
  ) {
    const addAndReplaceFunctions = new Map<string, SelectorDiff>();
    const removeFunctions = new Set<SelectorString>();
    const allNewSelectors = new Set<SelectorString>();

    for (const contractName of contractNames) {
      addAndReplaceFunctions.set(contractName, {
        _addFunctions: [],
        _replaceFunctions: [],
        _ignoredFunctions: [],
        _facet: zeroAddress,
      });

      const contractArtifact = await artifacts.readArtifact(contractName);
      const signatures = this.getSignatures(contractArtifact.abi as Abi);

      for (const signature of signatures) {
        allNewSelectors.add(toFunctionSelector(signature));
      }

      for (const signature of signatures) {
        const selector = toFunctionSelector(signature);

        /**
         * @dev if previous is undefined, it means that we are deploying a new diamond
         */
        if (this.needsIncluded(signature)) {
          const selectorExists = previous?.some(
            (item) => item.selector === selector
          );

          const target = addAndReplaceFunctions.get(contractName);
          if (!target) continue;

          if (selectorExists) {
            target._replaceFunctions.push(selector);
          } else {
            target._addFunctions.push(selector);
          }
        } else {
          addAndReplaceFunctions
            .get(contractName)
            ?._ignoredFunctions.push(selector);
        }
      }
    }

    /**
     * Determine functions to delete
     */
    if (previous) {
      for (const { selector } of previous) {
        if (
          !allNewSelectors.has(selector) &&
          !(await this.isDiamondSpecSelector(selector)) &&
          !removeFunctions.has(selector)
        ) {
          removeFunctions.add(selector);
        }
      }
    }

    return new DiamondChanges(
      addAndReplaceFunctions,
      removeFunctions,
      previous
    );
  }

  private async getFacets() {
    const facts = [];
    for (const [contractName, element] of this.#addAndReplaceFunctions) {
      const receipt = this.#deployedContracts.get(contractName);
      if (!receipt) {
        throw new Error(`Facet ${contractName} not deployed`);
      }
      for (const selector of [
        ...element._addFunctions,
        ...element._replaceFunctions,
      ]) {
        facts.push({
          selector: selector,
          signature: (await this.lookupSelector(selector)).signature,
          contract: contractName,
          contractAddress: receipt.contractAddress,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          transactionHash: receipt.transactionHash,
          transactionIndex: receipt.transactionIndex,
          from: receipt.from,
        });
      }
    }
    return facts;
  }

  public async saveDeployment(
    diamondDeployReceipt: GetTransactionReceiptReturnType,
    networkName: string
  ) {
    /**
     * Write deployment to file
     */
    // TODO: type hit
    const upgradeHistory = [] as any;
    if (this.#previous) {
      // TODO: for upgrade
    }
    const deployment = {
      diamond: diamondDeployReceipt.contractAddress,
      facetCut: await this.getFacets(),
      owner: diamondDeployReceipt.from,
      blockNumber: diamondDeployReceipt.blockNumber,
      blockHash: diamondDeployReceipt.blockHash,
      upgradeHistory: upgradeHistory,
    };
    const outputDir = path.join(hre.config.paths.root, "deployment");
    const outputPath = path.join(outputDir, `${networkName}.json`);
    await fs.writeFile(
      outputPath,
      JSON.stringify(
        deployment,
        (key, value) => (typeof value === "bigint" ? value.toString() : value),
        2
      )
    );
    console.log(`\n💾 Deployment file saved to: ${outputPath}`);
  }

  private static async isDiamondSpecSelector(selector: SelectorString) {
    const contracts = [
      "DiamondUpgradeFacet",
      "DiamondInspectFacet",
      "OwnerFacet",
    ];

    const selectors = new Set<string>();

    for (const start of contracts) {
      const artifact = await artifacts.readArtifact(start);
      const sigs = this.getSignatures(artifact.abi as Abi);
      for (const sig of sigs) {
        selectors.add(toFunctionSelector(sig));
      }
    }

    return selectors.has(selector);
  }

  public async verify(): Promise<boolean> {
    const table = new Table({
      head: ["Action", "Selector", "Signature", "Facet"],
    });

    for (const [contractName, element] of this.#addAndReplaceFunctions) {
      for (const selector of element._addFunctions) {
        const savedSelector = await this.lookupSelector(selector);
        table.push([
          chalk.blue("Added"),
          selector,
          savedSelector.signature,
          contractName,
        ]);
      }
      for (const selector of element._replaceFunctions) {
        const savedSelector = await this.lookupSelector(selector);
        table.push([
          chalk.green("Replaced"),
          selector,
          savedSelector.signature,
          contractName,
        ]);
      }
      for (const selector of element._ignoredFunctions) {
        const savedSelector = await this.lookupSelector(selector);
        table.push([
          chalk.gray("Ignored"),
          selector,
          savedSelector.signature,
          contractName,
        ]);
      }
    }

    for (const selector of this.#removeFunctions) {
      const savedSelector = await this.lookupSelector(selector);
      table.push([
        chalk.red("Removed"),
        selector,
        savedSelector.signature,
        savedSelector.contracts.join(", "),
      ]);
    }

    if (table.length === 0) {
      table.push(["None", "", "", ""]);
      console.log(table.toString());
      return false;
    }

    console.log(table.toString());

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<boolean>((resolve) => {
      rl.question(
        "Review the table of Diamond changes. Proceed with upgrade? yN ",
        (answer) => {
          rl.close();
          const normalized = answer.trim().toLowerCase();
          resolve(normalized === "y" || normalized === "yes");
        }
      );
    });
  }

  private async lookupSelector(
    selector: string
  ): Promise<{ signature: string; contracts: string[] }> {
    const selectors: Record<
      string,
      { signature: string; contracts: string[] } | undefined
    > = existsSelectors;
    return selectors[selector] ?? { signature: selector, contracts: [] };
  }
}

export async function loadDeployment(networkName: string) {
  /**
   * Import deployment json as needed
   */
  try {
    const deployment = await import(
      path.join(hre.config.paths.root, "deployment", `${networkName}.json`)
    );
    console.log(deployment);
    return deployment.default;
  } catch (e) {
    console.log(`Deployment not found for network: ${networkName}`);
    return null;
  }
}
