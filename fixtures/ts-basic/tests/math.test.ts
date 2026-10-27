import { add } from "../src/utils/math.js";

export function testAdd(): void {
  if (add(1, 2) !== 3) throw new Error("expected 3");
}
