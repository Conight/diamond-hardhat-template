import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { rm, readFile } from "node:fs/promises";
import path from "node:path";
import { artifacts, network } from "hardhat";
import { toFunctionSelector, zeroAddress, zeroHash } from "viem";
import { getCustomNFTConfig } from "../config/customNFT.js";
import { deployDiamond, upgradeDiamond } from "../scripts/libraries/diamond.js";
import {
  getDeploymentPath,
  loadDeployment,
  validateDeployment,
} from "../scripts/libraries/deployment.js";
import {
  inspectFacetArtifact,
  exportSelectorsSelector,
} from "../scripts/libraries/selectors.js";
import {
  readOnChainFacets,
  executeDiamondUpgrade,
} from "../scripts/libraries/executor.js";
import { buildDiamondAbi } from "../scripts/libraries/abi.js";
import type {
  DiamondConfig,
  OperationOptions,
} from "../scripts/libraries/types.js";

const approve: OperationOptions = { confirm: async () => true };
async function setup(t: TestContext) {
  const connection = await network.create("hardhatMainnet");
  const { viem } = connection;
  const client = await viem.getPublicClient();
  const [owner, other] = await viem.getWalletClients();
  const networkName = `test-${randomUUID()}`;
  const config = getCustomNFTConfig("hardhatMainnet");
  t.after(async () => {
    await connection.close();
    await rm(path.dirname(getDeploymentPath(networkName, config.name)), {
      recursive: true,
      force: true,
    });
  });
  return { viem, client, owner, other, config, networkName };
}

// These tests exercise real EVM calls and the production deployment orchestrator.
describe("ERC-8153 deployment and upgrades", () => {
  it("discovers only exported selectors without sending transactions", async (t) => {
    const { client, owner } = await setup(t);
    const before = await client.getTransactionCount({
      address: owner.account.address,
    });
    const facet = await inspectFacetArtifact(client, "SelectiveFacet");
    assert.deepEqual(facet.selectors, [toFunctionSelector("extra()")]);
    assert.equal(
      await client.getTransactionCount({ address: owner.account.address }),
      before,
    );
    for (const [name, error] of [
      ["DuplicateSelectorsFacet", /duplicate selectors/],
      ["MalformedSelectorsFacet", /packed bytes4/],
      ["SelfExportFacet", /must not export itself/],
    ] as const)
      await assert.rejects(inspectFacetArtifact(client, name), error);
  });

  it("deploys, initializes ownership and metadata, migrates, and supports NFT transfers and burns", async (t) => {
    const { viem, client, owner, other, config, networkName } = await setup(t);
    const result = await deployDiamond(viem, networkName, config, approve);
    assert.ok(result);
    const diamond = result.diamondAddress;
    const inspection = await viem.getContractAt("DiamondInspectFacet", diamond);
    const chainFacets = await inspection.read.facets();
    assert.equal(
      chainFacets.length,
      Object.keys(result.deployment.facets).length,
    );
    assert.equal(
      await inspection.read.facetAddress([exportSelectorsSelector]),
      zeroAddress,
    );
    for (const facet of chainFacets) {
      assert.deepEqual(
        await inspection.read.facetFunctionSelectors([facet.facet]),
        facet.functionSelectors,
      );
    }
    const ownerFacet = await viem.getContractAt("OwnerDataFacet", diamond);
    assert.equal(
      (await ownerFacet.read.owner()).toLowerCase(),
      owner.account.address,
    );
    const metadata = await viem.getContractAt("ERC721MetadataFacet", diamond);
    assert.equal(await metadata.read.name(), "CustomNFT");
    const erc165 = await viem.getContractAt("ERC165Facet", diamond);
    assert.equal(await erc165.read.supportsInterface(["0x80ac58cd"]), true);
    assert.equal(await erc165.read.supportsInterface(["0x5b5e139f"]), true);
    const nft = await viem.getContractAt("CustomNFTFacet", diamond);
    const data = await viem.getContractAt("ERC721DataFacet", diamond);
    await client.waitForTransactionReceipt({
      hash: await nft.write.mint([owner.account.address]),
    });
    assert.equal(await nft.read.totalSupply(), 1n);
    assert.equal(
      (await data.read.ownerOf([0n])).toLowerCase(),
      owner.account.address,
    );
    const transfers = await viem.getContractAt("ERC721TransferFacet", diamond);
    await client.waitForTransactionReceipt({
      hash: await transfers.write.transferFrom([
        owner.account.address,
        other.account.address,
        0n,
      ]),
    });
    assert.equal(
      (await data.read.ownerOf([0n])).toLowerCase(),
      other.account.address,
    );
    const burn = await viem.getContractAt("ERC721BurnFacet", diamond, {
      client: { wallet: other },
    });
    await client.waitForTransactionReceipt({
      hash: await burn.write.burn([0n]),
    });
    assert.equal(await data.read.balanceOf([other.account.address]), 0n);
    const migration = await viem.getContractAt(
      "CustomNFTMigrationFacet",
      diamond,
    );
    assert.equal(
      await migration.read.isMigrationCompleted([
        await migration.read.migrationId(),
      ]),
      true,
    );
    assert.equal(result.deployment.standard, "ERC-8153");
    assert.equal(result.deployment.version, 3);
    assert.equal(result.deployment.upgradeHistory[0].migrationExecuted, true);
    assert.deepEqual(
      await loadDeployment(networkName, config.name),
      result.deployment,
    );
  });

  it("replaces a facet, changes its first selector, and preserves NFT state", async (t) => {
    const { viem, client, owner, config, networkName } = await setup(t);
    const first = await deployDiamond(viem, networkName, config, approve);
    assert.ok(first);
    const nft = await viem.getContractAt(
      "CustomNFTFacet",
      first.diamondAddress,
    );
    await client.waitForTransactionReceipt({
      hash: await nft.write.mint([owner.account.address]),
    });
    const updatedConfig = {
      ...config,
      facets: config.facets.map((name) =>
        name === "CustomNFTFacet" ? "CustomNFTFacetV2" : name,
      ),
      replacements: { CustomNFTFacetV2: "CustomNFTFacet" },
    };
    const updated = await upgradeDiamond(
      viem,
      networkName,
      updatedConfig,
      approve,
    );
    assert.ok(updated);
    assert.equal(updated.deployment.facets.CustomNFTFacet, undefined);
    const v2 = await viem.getContractAt(
      "CustomNFTFacetV2",
      first.diamondAddress,
    );
    assert.equal(await v2.read.mintedSupply(), 1n);
    assert.equal(await v2.read.version(), 2n);
    await client.waitForTransactionReceipt({
      hash: await v2.write.mint([owner.account.address]),
    });
    const data = await viem.getContractAt(
      "ERC721DataFacet",
      first.diamondAddress,
    );
    assert.equal(
      (await data.read.ownerOf([1n])).toLowerCase(),
      owner.account.address,
    );
    const inspect = await viem.getContractAt(
      "DiamondInspectFacet",
      first.diamondAddress,
    );
    assert.equal(
      await inspect.read.facetAddress([toFunctionSelector("totalSupply()")]),
      zeroAddress,
    );
    assert.deepEqual(
      await inspect.read.facetFunctionSelectors([
        first.deployment.facets.CustomNFTFacet.address,
      ]),
      [],
    );
    const routes = (
      await readOnChainFacets(client, first.diamondAddress)
    ).flatMap((f) => f.functionSelectors);
    assert.equal(new Set(routes).size, routes.length);
    assert.equal(
      updated.deployment.functions.some((f) => f.signature === "totalSupply()"),
      false,
    );
    assert.equal(updated.deployment.upgradeHistory.at(-1)?.replaced.length, 1);
    const repeated = await upgradeDiamond(
      viem,
      networkName,
      updatedConfig,
      approve,
    );
    assert.equal(
      repeated?.deployment.upgradeHistory.length,
      updated.deployment.upgradeHistory.length,
    );
  });

  it("adds and removes whole facets and performs no transaction for an unchanged deployment", async (t) => {
    const { viem, client, owner, config, networkName } = await setup(t);
    const first = await deployDiamond(viem, networkName, config, approve);
    assert.ok(first);
    const added = await upgradeDiamond(
      viem,
      networkName,
      { ...config, facets: [...config.facets, "SelectiveFacet"] },
      approve,
    );
    assert.ok(added);
    const extra = await viem.getContractAt(
      "SelectiveFacet",
      first.diamondAddress,
    );
    assert.equal(await extra.read.extra(), 42n);
    const inspect = await viem.getContractAt(
      "DiamondInspectFacet",
      first.diamondAddress,
    );
    assert.equal(
      await inspect.read.facetAddress([toFunctionSelector("helper()")]),
      zeroAddress,
    );
    const removed = await upgradeDiamond(viem, networkName, config, approve);
    assert.ok(removed);
    assert.equal(removed.deployment.facets.SelectiveFacet, undefined);
    assert.equal(
      await inspect.read.facetAddress([toFunctionSelector("extra()")]),
      zeroAddress,
    );
    assert.equal(removed.deployment.upgradeHistory.at(-1)?.removed.length, 1);
    const nonce = await client.getTransactionCount({
      address: owner.account.address,
    });
    await upgradeDiamond(viem, networkName, config, {
      confirm: async () => {
        assert.fail("No-op must not request confirmation");
      },
    });
    assert.equal(
      await client.getTransactionCount({ address: owner.account.address }),
      nonce,
    );
  });

  it("rejects selector conflicts and cancelled plans before deploying any facets", async (t) => {
    const { viem, client, owner, config, networkName } = await setup(t);
    const nonce = await client.getTransactionCount({
      address: owner.account.address,
    });
    await assert.rejects(
      deployDiamond(
        viem,
        networkName,
        { ...config, facets: [...config.facets, "CollisionFacet"] },
        approve,
      ),
      /Selector collision/,
    );
    assert.equal(
      await deployDiamond(viem, networkName, config, {
        confirm: async () => false,
      }),
      undefined,
    );
    assert.equal(
      await client.getTransactionCount({ address: owner.account.address }),
      nonce,
    );
  });

  it("enforces owner authorization for upgrades and exposed migrations", async (t) => {
    const { viem, client, other, config, networkName } = await setup(t);
    const result = await deployDiamond(viem, networkName, config, approve);
    assert.ok(result);
    const upgrade = await viem.getContractAt(
      "DiamondUpgradeFacet",
      result.diamondAddress,
      { client: { wallet: other } },
    );
    await viem.assertions.revertWithCustomError(
      upgrade.write.upgradeDiamond([
        [],
        [],
        [],
        zeroAddress,
        "0x",
        zeroHash,
        "0x",
      ]),
      upgrade,
      "OwnerUnauthorizedAccount",
    );
    const migration = await viem.getContractAt(
      "CustomNFTMigrationFacet",
      result.diamondAddress,
      { client: { wallet: other } },
    );
    await viem.assertions.revertWithCustomError(
      migration.write.migrate([{ mintTo: other.account.address }]),
      migration,
      "OwnerUnauthorizedAccount",
    );
    // Also exercise a collision rejected by the on-chain upgrade implementation.
    const collision = await viem.deployContract("CollisionFacet");
    const ownUpgrade = await viem.getContractAt(
      "DiamondUpgradeFacet",
      result.diamondAddress,
    );
    await viem.assertions.revertWithCustomError(
      ownUpgrade.write.upgradeDiamond([
        [collision.address],
        [],
        [],
        zeroAddress,
        "0x",
        zeroHash,
        "0x",
      ]),
      ownUpgrade,
      "CannotAddFunctionToDiamondThatAlreadyExists",
    );
    assert.equal(
      (await readOnChainFacets(client, result.diamondAddress)).length,
      Object.keys(result.deployment.facets).length,
    );
  });

  it("executes a migration-only upgrade exactly once", async (t) => {
    const { viem, config, networkName } = await setup(t);
    const initial: DiamondConfig = {
      ...config,
      facets: [...config.facets, "CustomNFTMigrationFacet"],
      migration: undefined,
    };
    await deployDiamond(viem, networkName, initial, approve);
    const migrated = await upgradeDiamond(viem, networkName, config, {
      confirm: async (plan) => {
        assert.equal(plan.diff.hasChanges, false);
        assert.equal(plan.migration, "CustomNFTMigrationFacet");
        return true;
      },
    });
    assert.ok(migrated);
    assert.equal(migrated.deployment.upgradeHistory.length, 1);
    const again = await upgradeDiamond(viem, networkName, config, approve);
    assert.equal(again?.deployment.upgradeHistory.length, 1);
  });

  it("checks the new migration ID and executes its new code atomically with replacement", async (t) => {
    const { viem, other, config, networkName } = await setup(t);
    const first = await deployDiamond(viem, networkName, config, approve);
    assert.ok(first);
    const v1 = await viem.getContractAt(
      "CustomNFTMigrationFacet",
      first.diamondAddress,
    );
    const oldId = await v1.read.migrationId();
    const upgraded = await upgradeDiamond(
      viem,
      networkName,
      {
        ...config,
        migration: {
          facetName: "MigrationV2Facet",
          args: { mintTo: other.account.address },
        },
        replacements: { MigrationV2Facet: "CustomNFTMigrationFacet" },
      },
      approve,
    );
    assert.ok(upgraded);
    const v2 = await viem.getContractAt(
      "MigrationV2Facet",
      first.diamondAddress,
    );
    assert.equal(await v2.read.isMigrationCompleted([oldId]), true);
    assert.equal(
      await v2.read.isMigrationCompleted([await v2.read.migrationId()]),
      true,
    );
    const nft = await viem.getContractAt(
      "ERC721DataFacet",
      first.diamondAddress,
    );
    assert.equal(
      (await nft.read.ownerOf([999n])).toLowerCase(),
      other.account.address,
    );
    assert.equal(
      upgraded.deployment.upgradeHistory.at(-1)?.migrationExecuted,
      true,
    );
  });

  it("keeps routing and deployment history unchanged if a migration reverts", async (t) => {
    const { viem, client, owner, config, networkName } = await setup(t);
    const first = await deployDiamond(viem, networkName, config, approve);
    assert.ok(first);
    const record = await readFile(
      getDeploymentPath(networkName, config.name),
      "utf8",
    );
    await assert.rejects(
      upgradeDiamond(
        viem,
        networkName,
        {
          ...config,
          migration: {
            facetName: "RevertingMigrationFacet",
            args: { mintTo: owner.account.address },
          },
          replacements: { RevertingMigrationFacet: "CustomNFTMigrationFacet" },
        },
        approve,
      ),
      /migration failed/,
    );
    assert.equal(
      await readFile(getDeploymentPath(networkName, config.name), "utf8"),
      record,
    );
    const routes = await readOnChainFacets(client, first.diamondAddress);
    assert.ok(
      routes.some(
        (f) =>
          f.facet.toLowerCase() ===
          first.deployment.facets.CustomNFTMigrationFacet.address.toLowerCase(),
      ),
    );
  });

  it("rejects stale deployment records before sending transactions", async (t) => {
    const { viem, client, owner, config, networkName } = await setup(t);
    const first = await deployDiamond(viem, networkName, config, approve);
    assert.ok(first);
    const extra = await viem.deployContract("SelectiveFacet");
    await executeDiamondUpgrade(
      client,
      owner,
      first.diamondAddress,
      [extra.address],
      [],
      [],
    );
    const nonce = await client.getTransactionCount({
      address: owner.account.address,
    });
    await assert.rejects(
      upgradeDiamond(viem, networkName, config, approve),
      /does not match on-chain/,
    );
    assert.equal(
      await client.getTransactionCount({ address: owner.account.address }),
      nonce,
    );
    assert.throws(() => validateDeployment({ version: 2 }), /Only ERC-8153/);
  });

  it("builds client ABIs from routed functions and keeps canonical tuple overloads", async () => {
    const facet = await artifacts.readArtifact("SelectiveFacet");
    const abi = buildDiamondAbi(
      [],
      [{ abi: facet.abi, selectors: [toFunctionSelector("extra()")] }],
    );
    assert.deepEqual(
      abi.filter((item) => item.type === "function").map((item) => item.name),
      ["extra"],
    );
    const tupleAbis = [
      {
        type: "function",
        name: "call",
        stateMutability: "view",
        outputs: [],
        inputs: [
          {
            name: "arg",
            type: "tuple",
            components: [{ name: "x", type: "uint256" }],
          },
        ],
      },
      {
        type: "function",
        name: "call",
        stateMutability: "view",
        outputs: [],
        inputs: [
          {
            name: "arg",
            type: "tuple",
            components: [{ name: "x", type: "address" }],
          },
        ],
      },
    ] as const;
    const merged = buildDiamondAbi(
      [],
      [
        {
          abi: tupleAbis,
          selectors: tupleAbis.map((f) => toFunctionSelector(f)),
        },
      ],
    );
    assert.equal(merged.length, 2);
  });
});
