# Diamond Hardhat Template

A sophisticated, production-ready template for building modular and upgradeable smart contracts using the **Diamond Standard (EIP-2535) & (EIP-8109)**. This project is built with **Hardhat**, **Viem**.

## 🚀 Features

- **Modular Architecture**: Fully compliant with EIP-2535 (Diamond Standard), allowing you to bypass the 24KB contract size limit and build modular systems.
- **Automated Selector Management**: Includes a custom `selectors` task that automatically extracts and manages function selectors to prevent collisions and streamline upgrades.
- **Smart Upgrade System**: Advanced deployment and upgrade scripts that:
  - Perform a "diff" between local facets and the deployed Diamond.
  - Provide a visual summary (table) of planned changes (Added/Replaced/Removed/Ignored).
  - Require manual confirmation before executing on-chain transactions.
- **Deployment Tracking**: Automatically saves detailed deployment records (addresses, hashes, facet functions) in the `deployment/` directory.
- **Viem Integration**: Powered by Viem for fast, lightweight, and type-safe interactions with the Ethereum blockchain.

## 🛠 Project Structure

- `contracts/`: Solidity source files.
  - `lib/`: Core logic and facet base classes.
  - `AFacets.sol`, `CFacets.sol`: Example custom facets demonstrating modularity.
- `scripts/`: Logic for deployment and maintenance.
  - `libraries/diamond.ts`: The "brain" of the Diamond management system.
  - `deploy.ts`: Initial deployment script.
  - `upgrade.ts`: Automated upgrade script.
- `tasks/`: Custom Hardhat tasks.
  - `selectors.ts`: Logic for generating function selector mappings.
- `deployment/`: Network-specific deployment history.

## 🏁 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (recommended)

### Installation

```bash
pnpm install
```

### Configuration

Create a `.env` file in the root directory and add your private key and provider URLs:

```env
PRIVATE_KEY=your_private_key
RPC_URL=your_rpc_url
```

## 📖 Usage

### Compilation

```bash
npx hardhat compile
```

### Generate Selectors

Before deploying or upgrading, run the selectors task to update the function mapping:

```bash
npx hardhat selectors
```

### Initial Deployment

Deploys the Diamond contract along with the standard facets (`DiamondUpgradeFacet`, `DiamondInspectFacet`, `OwnerFacet`) and your custom facets.

```bash
npx hardhat run scripts/deploy.ts --network <your-network>
```

### Upgrading the Diamond

The upgrade script automatically detects changes in your facets and prepares a `upgradeDiamond` transaction.

```bash
npx hardhat run scripts/upgrade.ts --network <your-network>
```

## 💎 The Diamond Standard

This template uses the **Diamond Standard (EIP-2535)**. Diamonds are multi-facet proxies that can be extended or modified after deployment.

- **Facets**: Independent contracts that implement specific functionality.
- **Diamond**: The main contract that delegates calls to facets based on function selectors.
- **Loupe**: A set of functions to inspect facets and their supported selectors (implemented in `DiamondInspectFacet`).

## 📜 License

This project is licensed under the MIT License.
