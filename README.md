# Diamond Hardhat Template

A sophisticated, production-ready template for building modular and upgradeable smart contracts using the **Diamond Standard (EIP-2535/EIP-8109)**. This project is built with **Hardhat**, **Viem**.

---

## ⚠️ **Attribution & Credits**

> **IMPORTANT NOTICE:**
>
> This project is essentially a **wrapper layer** built on top of the Diamond Standard smart contract architecture. The core implementation and foundational work are **NOT** original to this repository.
>
> **Primary Credit Belongs To:**
>
> 1. **[Perfect-Abstractions/Compose](https://github.com/Perfect-Abstractions/Compose)** - The primary implementation reference and architectural foundation for this template.
> 2. **[Nick Mudge (@mudgen)](https://github.com/mudgen)** - Creator of the Diamond Standard (EIP-2535/EIP-8109) and the original Diamond implementations.
>
> This template merely provides a **Hardhat integration layer** with deployment scripts and developer tooling around their exceptional work. All fundamental concepts, patterns, and the majority of the smart contract logic originate from the above sources.
>
> **Please give credit where credit is due.** If you build something with this template, acknowledge the original creators.

---

## 🚀 Features

- **Modular Architecture**: Fully compliant with EIP-2535 (Diamond Standard), allowing you to bypass the 24KB contract size limit and build modular systems.
- **Automated Selector Management**: Includes a custom `selectors` task that automatically extracts and manages function selectors to prevent collisions and streamline upgrades.
- **Smart Upgrade System**: Advanced deployment and upgrade scripts that:
  - Perform a "diff" between local facets and the deployed Diamond.
  - Provide a visual summary (table) of planned changes (Added/Replaced/Removed/Ignored).
  - Require manual confirmation before executing on-chain transactions.
- **Automated Migration**: Supports a structured migration pattern where a specific facet can execute initialization logic (e.g., setting state) during deployment or upgrade. The system automatically detects if migration is needed and includes it in the transaction.
- **Deployment Tracking**: Automatically saves detailed deployment records (addresses, hashes, facet functions) in the `deployment/` directory.
- **Viem Integration**: Powered by Viem for fast, lightweight, and type-safe interactions with the Ethereum blockchain.

## 🛠 Project Structure

- `contracts/`: Solidity source files.
  - `lib/`: Core logic and facet base classes.
  - `customNFT/`: Custom NFT implementation facets and diamond.
- `scripts/`: Logic for deployment and maintenance.
  - `libraries/diamond.ts`: The "brain" of the Diamond management system.
  - `deploy.ts`: Initial deployment script.
  - `upgrade.ts`: Automated upgrade script.
- `tasks/`: Custom Hardhat tasks.
  - `customNFT.ts`: Task for deploying and upgrading the CustomNFT Diamond.
  - `config.ts`: Configuration for custom facets.
  - `selectors.ts`: Logic for generating function selector mappings.
  - `common.ts`: Common deploy & upgrade functions for diamond facets tasks.
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
pnpm hardhat compile
```

### Generate Selectors

Before deploying or upgrading, run the selectors task to update the function mapping:

```bash
pnpm hardhat selectors
```

### Initial Deployment

Deploys the Diamond contract along with the standard facets (`DiamondUpgradeFacet`, `DiamondInspectFacet`, `OwnerFacet`) and your custom facets.

```bash
# Scripts
pnpm hardhat run scripts/deploy.ts --network <your-network>
# Hardhat Tasks
pnpm hardhat customNFT --deploy --network <your-network>
```

### Upgrading the Diamond

The upgrade script automatically detects changes in your facets and prepares a `upgradeDiamond` transaction.

```bash
# Scripts
pnpm hardhat run scripts/upgrade.ts --network <your-network>
# Hardhat Tasks
pnpm hardhat customNFT --upgrade --network <your-network>
```

## 💎 The Diamond Standard

This template uses the **Diamond Standard (EIP-2535)**. Diamonds are multi-facet proxies that can be extended or modified after deployment.

- **Facets**: Independent contracts that implement specific functionality.
- **Diamond**: The main contract that delegates calls to facets based on function selectors.
- **Inspect**: A set of functions to inspect facets and their supported selectors (implemented in `DiamondInspectFacet`).

---

## 📝 TODO

- [ ] Explore [OpenZeppelin Relayer](https://github.com/OpenZeppelin/openzeppelin-relayer) for meta-transaction support.
- [ ] Integrate [OpenZeppelin Monitor](https://github.com/OpenZeppelin/openzeppelin-monitor) for automated contract monitoring.

## 📜 License

This project is licensed under the MIT License.
