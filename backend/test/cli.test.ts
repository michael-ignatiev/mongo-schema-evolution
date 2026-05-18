import { mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIG_FILE_NAME } from "../src/config/index.js";
import { createCli } from "../src/cli/createCli.js";

describe("mongo-evolution CLI", () => {
  it("registers the MVP command surface", () => {
    const commandNames = createCli()
      .commands.map((command) => command.name())
      .sort();

    expect(commandNames).toEqual([
      "create",
      "dry-run",
      "history",
      "init",
      "up",
      "validate"
    ]);
  });

  describe("init", () => {
    const originalCwd = process.cwd();
    const tempDirs: string[] = [];

    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(async () => {
      process.chdir(originalCwd);
      vi.restoreAllMocks();
      await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, {
        force: true,
        recursive: true
      })));
    });

    it("creates a config file and migrations directory", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-cli-"));
      tempDirs.push(tempDir);
      process.chdir(tempDir);
      const resolvedTempDir = await realpath(tempDir);

      await createCli().parseAsync(["node", "mongo-evolution", "init"]);

      await expect(readFile(path.join(tempDir, CONFIG_FILE_NAME), "utf8")).resolves.toContain(
        "\"mongoUri\": \"mongodb://localhost:27017\""
      );
      const migrationsStat = await stat(path.join(tempDir, "migrations"));

      expect(migrationsStat.isDirectory()).toBe(true);
      expect(console.log).toHaveBeenCalledWith(
        `Initialized mongo-evolution in ${path.join(resolvedTempDir, CONFIG_FILE_NAME)}`
      );
    });
  });

  describe("create", () => {
    const originalCwd = process.cwd();
    const tempDirs: string[] = [];

    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(async () => {
      process.chdir(originalCwd);
      vi.restoreAllMocks();
      await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, {
        force: true,
        recursive: true
      })));
    });

    it("creates a migration file through the CLI", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-cli-create-"));
      tempDirs.push(tempDir);
      process.chdir(tempDir);

      await createCli().parseAsync(["node", "mongo-evolution", "init"]);
      await createCli().parseAsync([
        "node",
        "mongo-evolution",
        "create",
        "rename-user-name-to-profile-fullname"
      ]);

      const files = await readdir(path.join(tempDir, "migrations"));

      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{14}-rename-user-name-to-profile-fullname\.ts$/);
      await expect(readFile(path.join(tempDir, "migrations", files[0] ?? ""), "utf8")).resolves
        .toContain("const migration: MigrationDefinition = {");
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/^Created migration \d{14}-rename-user-name-to-profile-fullname$/)
      );
    });
  });
});
