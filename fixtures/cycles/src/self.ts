import { self as loop } from "./self.js";

export function self(): string {
  return loop();
}
