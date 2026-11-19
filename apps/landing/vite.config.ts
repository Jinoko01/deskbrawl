import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  input: ["index.html", "updates/index.html"],
  server: {
    host: "127.0.0.1",
    port: 1430,
    strictPort: true,
  },
});
