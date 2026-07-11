import { expect, test, describe } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installAssets } from "../src/lib/install_assets";

describe("Command Assets Validation", () => {
  test("fallback and normal command installation matches exact files", () => {
    const tmpProject = mkdtempSync(join(tmpdir(), "opencode-banca-cmd-"));
    const nonexistentDir = join(tmpProject, "this-does-not-exist");

    try {
      installAssets(tmpProject, true, nonexistentDir);

      const installedCommandsDir = join(tmpProject, ".opencode", "commands");
      expect(existsSync(installedCommandsDir)).toBe(true);

      const expectedCommands = [
        "banca-init.md",
        "banca.md"
      ];

      const versionedDir = join(process.cwd(), "assets", "opencode", "commands");

      for (const cmd of expectedCommands) {
        const fallbackPath = join(installedCommandsDir, cmd);
        const versionedPath = join(versionedDir, cmd);

        expect(existsSync(fallbackPath)).toBe(true, `Fallback command missing: ${cmd}`);

        const fallbackContent = readFileSync(fallbackPath, "utf8").replace(/\r\n/g, "\n").trim();
        const versionedContent = readFileSync(versionedPath, "utf8").replace(/\r\n/g, "\n").trim();

        expect(fallbackContent).toBe(versionedContent);
      }

      const files = readdirSync(installedCommandsDir);
      expect(files.length).toBe(expectedCommands.length);
      expect(files).not.toContain("banca:init.md");

      // Verify no invalid Windows characters inside assets/opencode/commands
      const repoCommands = readdirSync(versionedDir);
      for (const repoFile of repoCommands) {
        expect(repoFile).not.toMatch(/:/);
      }
    } finally {
      rmSync(tmpProject, { recursive: true, force: true });
    }
  });
});
