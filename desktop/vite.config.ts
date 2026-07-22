import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(directory, "renderer"),
  base: "./",
  publicDir: path.join(directory, "..", "public"),
  plugins: [react()],
  build: {
    outDir: path.join(directory, "..", "dist-desktop", "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes("/node_modules/react")
            ? "react"
            : undefined;
        },
      },
    },
  },
});
