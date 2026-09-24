import { toFunctionSelector, type Abi, type AbiItem } from "viem";
import { formatAbiItem } from "viem/utils";
import type { Selector } from "./types.js";

/** Only include facet functions actually routed by this deployment. */
export function buildDiamondAbi(
  diamondAbi: Abi,
  facets: readonly { abi: Abi; selectors: readonly Selector[] }[],
): Abi {
  const entries = new Map<string, AbiItem>();
  function add(item: AbiItem) {
    const key =
      item.type === "function" || item.type === "event" || item.type === "error"
        ? `${item.type}:${formatAbiItem(item)}`
        : item.type;
    entries.set(key, item);
  }
  diamondAbi.forEach(add);
  for (const { abi, selectors } of facets) {
    for (const selector of selectors) {
      if (
        !abi.some(
          (item) =>
            item.type === "function" && toFunctionSelector(item) === selector,
        )
      ) {
        throw new Error(
          `Deployed selector ${selector} is missing from the current ABI; compile the matching facet version`,
        );
      }
    }
    for (const item of abi) {
      if (item.type === "function") {
        if (selectors.includes(toFunctionSelector(item))) add(item);
      } else if (item.type === "event" || item.type === "error") add(item);
    }
  }
  return [...entries.values()];
}
