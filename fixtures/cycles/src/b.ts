import { fromC } from "./c.js";

export function fromB(): string {
  return `b-${fromC()}`;
}
