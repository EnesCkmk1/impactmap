import { query } from "@app/db/client";

export function listUsers(): string[] {
  return query("select * from users");
}
