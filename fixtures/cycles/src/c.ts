import { fromA } from "./a.js";

export function fromC(): string {
  return `c-${fromA()}`;
}
