import { createUser } from "@acme/domain";

export function main(): string {
  return createUser("1").id;
}
