import { readSession } from "../src/auth/session.js";

export function testReadSession(): void {
  if (!readSession("abc")) throw new Error("expected a session");
}
