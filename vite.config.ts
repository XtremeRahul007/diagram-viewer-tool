import { defineConfig } from "vite";

export default defineConfig({
  base: "diagram-viewer-tool",
  server: {
    host: true,
    port: 5173,
  },
});
