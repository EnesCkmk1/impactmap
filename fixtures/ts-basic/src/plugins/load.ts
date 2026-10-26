export async function loadMath() {
  return import("../utils/math.js");
}

export async function loadNamed(name: string) {
  // biome-ignore lint/style/useTemplate: the concatenation is the non-literal import fixture
  return import("./" + name);
}
