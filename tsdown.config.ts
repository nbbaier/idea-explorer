import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: true,
  shims: true,
  outDir: "dist/cli",
  outputOptions: {
    banner: "#!/usr/bin/env node",
  },
});
