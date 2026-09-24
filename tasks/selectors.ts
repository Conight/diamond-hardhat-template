/** Regenerate a diagnostic selector index from actual facet exports. */
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  inspectFacetArtifact,
  getAbiFunctions,
  selectorSignature,
} from "../scripts/libraries/selectors.js";
import type { SelectorMap } from "../scripts/libraries/types.js";

export default async function selectorsTask(
  _args: {},
  hre: HardhatRuntimeEnvironment,
): Promise<void> {
  await hre.tasks.getTask("compile").run();
  const connection = await hre.network.create("hardhatMainnet");
  try {
    const client = await connection.viem.getPublicClient();
    const index: Record<string, { signature: string; contracts: string[] }> =
      {};
    for (const name of [
      ...(await hre.artifacts.getAllFullyQualifiedNames()),
    ].sort()) {
      if (name.includes("/test/") || name.startsWith("test/")) continue;
      const artifact = await hre.artifacts.readArtifact(name);
      if (
        artifact.bytecode === "0x" ||
        !getAbiFunctions(artifact.abi).some((f) => f.name === "exportSelectors")
      )
        continue;
      const facet = await inspectFacetArtifact(client, name);
      for (const selector of facet.selectors) {
        const signature = selectorSignature(facet.abi, selector);
        const entry = (index[selector] ??= { signature, contracts: [] });
        if (entry.signature !== signature)
          throw new Error(
            `Selector collision ${selector}: ${entry.signature} / ${signature}`,
          );
        entry.contracts.push(artifact.contractName);
      }
    }
    const sorted: SelectorMap = Object.fromEntries(
      Object.entries(index).sort(([a], [b]) => a.localeCompare(b)),
    );
    const output = path.join(
      hre.config.paths.root,
      "scripts/libraries/selectors.json",
    );
    await fs.writeFile(output, JSON.stringify(sorted, null, 2) + "\n");
    console.log(
      `Indexed ${Object.keys(index).length} exported selectors: ${output}`,
    );
  } finally {
    await connection.close();
  }
}
