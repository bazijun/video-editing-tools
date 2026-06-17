import assert from "node:assert/strict";
import { test } from "node:test";

test("Vite build assets stay relative for file-based loading", async () => {
  const { default: viteConfig } = await import("../vite.config.js");

  assert.equal(viteConfig.base, "./");
});
