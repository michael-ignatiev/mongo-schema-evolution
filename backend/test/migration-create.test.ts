import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initConfig } from "../src/config/index.js";
import {
  createMigration,
  formatTimestamp,
  slugifyMigrationName
} from "../src/core/migrations/index.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-create-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, {
    force: true,
    recursive: true
  })));
});

describe("migration creation", () => {
  it("formats migration timestamps in deterministic UTC order", () => {
    expect(formatTimestamp(new Date("2026-05-11T12:34:56.000Z"))).toBe("20260511123456");
  });

  it("slugifies human-readable migration names", () => {
    expect(slugifyMigrationName("Rename User Name To Profile Fullname")).toBe(
      "rename-user-name-to-profile-fullname"
    );
  });

  it("creates a timestamped migration template in the configured migrations directory", async () => {
    const cwd = await createTempDir();
    await initConfig({ cwd });

    const result = await createMigration({
      cwd,
      name: "rename-user-name-to-profile-fullname",
      now: new Date("2026-05-11T12:34:56.000Z")
    });

    const files = await readdir(path.join(cwd, "migrations"));
    const source = await readFile(result.filePath, "utf8");

    expect(result.id).toBe("20260511123456-rename-user-name-to-profile-fullname");
    expect(result.filePath).toBe(
      path.join(cwd, "migrations", "20260511123456-rename-user-name-to-profile-fullname.ts")
    );
    expect(files).toEqual(["20260511123456-rename-user-name-to-profile-fullname.ts"]);
    expect(source).toContain("import type { Document, Filter, WithId } from \"mongodb\";");
    expect(source).toContain("} from \"../src/core/migrations/types.js\";");
    expect(source).toContain("const migration: MigrationDefinition = {");
    expect(source).toContain("id: \"20260511123456-rename-user-name-to-profile-fullname\"");
    expect(source).toContain("description: \"rename-user-name-to-profile-fullname\"");
    expect(source).toContain("collection: \"users\"");
    expect(source).toContain("mode: \"online\"");
    expect(source).toContain("schemaVersion: {");
    expect(source).toContain("to: 2");
    expect(source).toContain("match(_ctx: MigrationContext): Filter<Document>");
    expect(source).toContain("async transform(document: WithId<Document>");
    expect(source).toContain("async validate(_ctx: ValidationContext): Promise<ValidationResult>");
    expect(source).toContain("export default migration;");
  });
});
