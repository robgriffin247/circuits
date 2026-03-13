import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const YAML_FILES = ["movements.yml", "routines.yml"];

function syncYamlPlugin() {
  let rootDir = "";

  async function syncFile(fileName) {
    const source = path.resolve(rootDir, "..", fileName);
    const destination = path.resolve(rootDir, "public", fileName);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  async function syncAll() {
    await Promise.all(YAML_FILES.map(syncFile));
  }

  return {
    name: "sync-root-yaml",
    configResolved(config) {
      rootDir = config.root;
    },
    async buildStart() {
      await syncAll();
    },
    configureServer(server) {
      const sourceFiles = YAML_FILES.map((fileName) => path.resolve(server.config.root, "..", fileName));
      server.watcher.add(sourceFiles);

      const syncAndReload = async (filePath) => {
        const fileName = path.basename(filePath);
        if (!YAML_FILES.includes(fileName)) return;

        try {
          await syncFile(fileName);
          server.ws.send({ type: "full-reload" });
        } catch (error) {
          server.config.logger.error(`Failed to sync ${fileName}: ${error.message}`);
        }
      };

      syncAll().catch((error) => {
        server.config.logger.error(`Failed to sync YAML files: ${error.message}`);
      });

      server.watcher.on("add", syncAndReload);
      server.watcher.on("change", syncAndReload);
    }
  };
}

export default defineConfig({
  plugins: [react(), syncYamlPlugin()],
  server: {
    port: 5173,
    strictPort: true
  }
});
