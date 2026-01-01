# Banned Solidity Features

The following Solidity language features are banned from Compose facets and modules.

Compose restricts certain Solidity features to keep facet and library code simpler, more consistent, and easier to reason about.
Because of Compose's architecture, many of these features are either unnecessary or less helpful.

> These restrictions do not apply to tests.
> These restrictions do not apply to developers using Compose in their own projects.

## List of Banned Features

### 1. Inheritance

Facets may not inherit from any contract or interface.

**Banned:**

```solidity
contract MyContract is OtherContract { ...}
// or
contract MyContract is IMyInterface { ...}
```

If you want inheritance, your facet is probably too large. Split it into smaller facets. Compose replaces inheritance with on-chain facet composition.

### 2. Constructors

Facets may not define constructors.

**Banned:**

```solidity
constructor() { owner = msg.sender; ...}
```

### 3. Modifiers

Facets may not define or use modifiers.

**Banned:**

```solidity
modifier onlyOwner() { require(msg.sender == owner, "Caller is not the owner"); _;}
```

### 4. Visibility Specifiers on Storage Variables

Storage variables may not include visibility specifiers (like `public`).

**Banned:**

```solidity
uint256 public counter;
```

Visibility labels are unnecessary because Compose uses [ERC-8042 Diamond Storage](https://eips.ethereum.org/EIPS/eip-8042) across all facets.
This rule does not apply to `constant` or `immutable` variables, which may be declared `internal`.

### 5. Public Functions

All facet functions must be declared as `internal` or `external`. You cannot use `public`.

**Banned:**

```solidity
function approve(address _spender, uint256 _value) public { ...}
```

### 6. Libraries

Defining libraries is banned.

**Banned:**

```solidity
library MyLib { ...}
```

### 7. 'using for'

The `using ... for ...` syntax is banned.

**Banned:**

```solidity
using SomethingMod for uint256;
```

### 8. Ternary Operator

The ternary operator (`condition ? valueIfTrue : valueIfFalse`) may not be used.

**Banned:**

```solidity
string memory status = balance >= cost ? "Paid" : "Insufficient funds";
```

### 9. Omitted Curly Braces

Always use braces `{}` around `if` and `else` bodies.

**Banned:**

```solidity
if (x < 10) count++;
```

**Required:**

```solidity
if (x < 10) { count++; }
```

### 10. Selfdestruct

No contract or module may use `selfdestruct`.

**Banned:**

```solidity
selfdestruct(owner);
```
