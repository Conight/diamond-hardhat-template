# Diamond Hardhat Template

A Hardhat 3 and Viem template for **ERC-8153 Facet-Based Diamonds**, built on [Perfect-Abstractions/Compose](https://github.com/Perfect-Abstractions/Compose).

The vendored Solidity library is copied from upstream commit [`4e842c88d38a8f8ca8bdc115cecdcf23366c16e3`](https://github.com/Perfect-Abstractions/Compose/tree/4e842c88d38a8f8ca8bdc115cecdcf23366c16e3/src) (2026-09-20). Its source is kept unchanged; provenance is recorded in [`contracts/lib/upstream.json`](contracts/lib/upstream.json). Compose is still an early-stage library; this template does not constitute a security audit.

Credit for the core contracts and architecture belongs to **Perfect Abstractions, the Compose contributors, and [Nick Mudge](https://github.com/mudgen)**, creator of the Diamond standards. This repository supplies the Hardhat integration, custom NFT example, deployment tooling, and tests.

## Requirements

- Node.js **22.13+** (Node.js 24 LTS recommended)
- pnpm **12.6.0**
- Solidity 0.8.37 is downloaded by Hardhat. Both compiler profiles use the optimizer, viaIR, and the Prague EVM target, matching the upstream EVM requirement.

```bash
pnpm install --frozen-lockfile
pnpm compile
pnpm test
pnpm typecheck
pnpm lint
```

## Local deployment

Start a persistent development chain in one terminal:

```bash
pnpm hardhat node
```

Deploy from another terminal:

```bash
pnpm hardhat customNFT --deploy --network localhost
```

The task executes each facet's `exportSelectors()` through a read-only `eth_call`, checks the plan, and asks for confirmation **before sending transactions**. It then deploys the facets and diamond, runs the configured migration, and saves `deployment/localhost/CustomNFTDiamond.json`.

`LOCALHOST_RPC_URL` can override the local endpoint. For other chains, configure the network and wallet in `hardhat.config.ts` and the facet/migration configuration in `config/customNFT.ts`.

Use a persistent network for deployments you intend to upgrade. The in-process `hardhatMainnet` and `hardhatOp` networks are fresh on each command. If you restart a local node, remove its obsolete deployment record before deploying again.

## Facet-based upgrades

```bash
pnpm hardhat customNFT --upgrade --network localhost
```

The task reads `facets()` from the diamond and checks it against the saved record. It compares deployed bytecode with the local artifacts and plans whole-facet additions, replacements, and removals. Unchanged facets are reused.

The on-chain interface is:

```solidity
struct FacetReplacement {
  address oldFacet;
  address newFacet;
}

function upgradeDiamond(
  address[] calldata addFacets,
  FacetReplacement[] calldata replaceFacets,
  address[] calldata removeFacets,
  address delegate,
  bytes calldata delegateCalldata,
  bytes32 tag,
  bytes calldata metadata
) external;
```

Replacing a facet automatically adds its new selectors, reroutes retained selectors, and removes selectors no longer exported. The diamond emits `FacetAdded`, `FacetReplaced`, and `FacetRemoved` events.

For a renamed facet, declare its predecessor explicitly:

```ts
return {
  name: "CustomNFTDiamond",
  facets: [, /* standard facets */ "CustomNFTFacetV2"],
  replacements: { CustomNFTFacetV2: "CustomNFTFacet" },
};
```

The mapping can remain after the replacement. Splitting or merging facets with overlapping selectors requires deliberately staged upgrades: upstream applies additions, then replacements, then removals, and rejects taking selectors from an unrelated facet.

Without either flag, `pnpm hardhat customNFT --network localhost` deploys when no record exists and upgrades otherwise. `--deploy` refuses to overwrite an existing record.

## Writing facets

Every configured facet must implement a pure discovery function returning **packed bytes**, not `bytes4[]`:

```solidity
function exportSelectors() external pure returns (bytes memory) {
  return bytes.concat(this.mint.selector, this.totalSupply.selector);
}
```

Only export functions that should be callable through the diamond. Never export `exportSelectors()` itself. Selectors must be unique within each facet and across the configured diamond. Facets must have deployable, linked bytecode and require no constructor arguments.

The NFT example includes the inspect and upgrade facets, separate Owner Data/Transfer/Renounce facets, ERC165, ERC721 metadata/data/transfer/approval/burn facets, and custom minting. NFT burning uses `burn(uint256)` and `burnBatch(uint256[])`. `totalSupply()` in the custom example counts tokens ever minted and does not decrease after a burn.

## Migrations

`CustomNFTMigrationFacet` demonstrates the migration interface:

- `migrationId()`: a unique `bytes32` ID for this version.
- `isMigrationCompleted(bytes32)`: reads the diamond's completion mapping.
- `migrate(params)`: verifies the diamond owner and records completion after initialization.

Change the ID for every new migration and add your initialization logic to `migrate`. The example parameter `mintTo` is a placeholder and the default migration does not mint tokens.

The orchestrator reads the **new facet's ID**, checks it against diamond storage, and delegates directly to the selected migration facet. It supports migration-only upgrades and skips completed migrations. Facet changes and migration execute atomically in the same upgrade transaction.

Initial deployment and its migration are separate transactions. The diamond address is saved before migration execution, so a failed initial migration can be retried with `--upgrade`. The migration facet is mounted automatically, and its public `migrate` entry point is owner-protected.

## Selectors and frontend ABI

```bash
# Optional diagnostic index; deployment does not depend on this file.
pnpm selectors

# Generate abi.ts after a successful deployment.
pnpm generate
```

The selector index is rebuilt from actual facet exports using a simulated local chain. Interfaces and test fixtures are excluded. It is not used as an input to on-chain upgrades.

Wagmi uses each deployment record's chain ID, current facet list, and exported selectors. It excludes discovery functions and unexported helpers, includes the new events, and preserves tuple overloads. Multiple chains contribute to the generated combined ABI; callers should use functions supported by their target deployment.

Deployment records use version **3** with `standard: "ERC-8153"`, chain ID, active facets, exported functions, transaction details, and upgrade history. Earlier formats and ERC-8109 deployments are not supported. Old development snapshots have been removed.

## Project layout

- `contracts/lib/`: unchanged upstream Compose sources and provenance.
- `contracts/customNFT/`: the custom diamond, mint facet, and example migration.
- `contracts/test/`, `test/`: EVM integration fixtures and tests.
- `config/`: facet and migration configuration.
- `scripts/libraries/`: selector discovery, facet diffing, transaction execution, records, and ABI assembly.
- `tasks/`: Hardhat deploy/upgrade and selector-index tasks.
- `deployment/`: generated per-network deployment records.

`pnpm prettier` formats project-owned code; vendored Compose files retain upstream formatting. `pnpm test` covers deployment, NFT operations, facet replacement/addition/removal, state preservation, authorization, selector conflicts, migration versions, rollback, and ABI generation.

## License

MIT. Preserve upstream notices and attribution when redistributing the library.
