import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./district", import.meta.url)),
  base: "/naksaeng/",
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
  server: {
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
  },
});
