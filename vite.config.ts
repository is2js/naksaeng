import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const pagesBase = "/naksaeng/bunfirvil/";

export default defineConfig({
  base: pagesBase,
  build: {
    outDir: "dist/bunfirvil",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: {
        showcase: resolve(__dirname, "index.html"),
        manage: resolve(__dirname, "manage/index.html"),
        buildingAdmin: resolve(__dirname, "building-admin/index.html"),
        interiorAdmin: resolve(__dirname, "interior-admin/index.html"),
        guides: resolve(__dirname, "guides/index.html"),
        households: resolve(__dirname, "households/index.html"),
        calculator: resolve(__dirname, "calculator/index.html"),
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
