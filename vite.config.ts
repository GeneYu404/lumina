import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Vite's recursive watcher otherwise tries to watch
    // `src-tauri/target/debug/deps/lumina.exe` while cargo is still
    // linking it, which throws EBUSY on Windows. Limit the watch to the
    // frontend tree.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
