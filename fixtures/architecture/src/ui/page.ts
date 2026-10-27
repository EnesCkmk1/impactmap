import { placeOrder } from "../domain/order.js";

export function render(): string {
  return placeOrder("1");
}
