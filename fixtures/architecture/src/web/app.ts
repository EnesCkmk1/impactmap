import { token } from "../server/secrets.js";

export function banner(): string {
  return token;
}
