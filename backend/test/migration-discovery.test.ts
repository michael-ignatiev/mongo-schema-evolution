import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initConfig } from "../src/config/index.js";
import {
  type DiscoveredMigration,
  MigrationDiscoveryError,
  discoverConfiguredMigrations,
  discoverMigrationFiles,
  discoverMigrations,
  discoverUnappliedMigrations,
  filterUnappliedMigrations
} from "../src/core/migrations/index.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-discovery-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, {
    force: true,
    recursive: true
  })));
});

describe("migration discovery", () => {
  it("discovers supported migration files and ignores declaration files", async () => {
    const migrationsPath = await createTempDir();
    await writeMigrationFile(migrationsPath, "20260511120000-first.ts", "20260511120000-first");
    await writeMigrationFile(migrationsPath, "20260511130000-second.js", "20260511130000-second");
    await writeFile(path.join(migrationsPath, "20260511140000-types.d.ts"), "export {};\n");
    await writeFile(path.join(migrationsPath, "README.md"), "# ignored\n");

    const files = await discoverMigrationFiles(migrationsPath);

    expect(files.map((filePath) => path.basename(filePath))).toEqual([
      "20260511120000-first.ts",
      "20260511130000-second.js"
    ]);
  });

  it("loads migration files and orders them by migration id", async () => {
    const migrationsPath = await createTempDir();
    await writeMigrationFile(migrationsPath, "20260511130000-third.ts", "20260511130000-third");
    await writeMigrationFile(migrationsPath, "20260511110000-first.ts", "20260511110000-first");
    await writeMigrationFile(migrationsPath, "20260511120000-second.ts", "20260511120000-second");

    const migrations = await discoverMigrations(migrationsPath);

    expect(migrations.map((migration) => migration.id)).toEqual([
      "20260511110000-first",
      "20260511120000-second",
      "20260511130000-third"
    ]);
    expect(migrations[0]?.migration.collection).toBe("users");
    expect(typeof migrations[0]?.migration.match).toBe("function");
    expect(typeof migrations[0]?.migration.transform).toBe("function");
  });

  it("rejects invalid migration metadata", async () => {
    const migrationsPath = await createTempDir();
    await writeFile(path.join(migrationsPath, "20260511120000-invalid.ts"), `
export default {
  id: "invalid",
  description: "invalid",
  collection: "users",
  mode: "online",
  match() {
    return {};
  },
  transform(document) {
    return document;
  }
};
`);

    await expect(discoverMigrations(migrationsPath)).rejects.toBeInstanceOf(
      MigrationDiscoveryError
    );
  });

  it("rejects duplicate migration ids", async () => {
    const migrationsPath = await createTempDir();
    await mkdir(path.join(migrationsPath, "nested"));
    await writeMigrationFile(migrationsPath, "20260511120000-duplicate.ts", "20260511120000-duplicate");
    await writeMigrationFile(
      path.join(migrationsPath, "nested"),
      "20260511120000-duplicate.ts",
      "20260511120000-duplicate"
    );

    await expect(discoverMigrations(migrationsPath)).rejects.toThrow(/Duplicate migration id/);
  });

  it("filters out already-applied migrations while preserving order", async () => {
    const migrations = [
      discovered("20260511130000-third"),
      discovered("20260511110000-first"),
      discovered("20260511120000-second")
    ];
    const appliedIds = new Set(["20260511120000-second"]);

    const pending = await filterUnappliedMigrations(migrations, {
      async isMigrationApplied(migrationId: string) {
        return appliedIds.has(migrationId);
      }
    });

    expect(pending.map((migration) => migration.id)).toEqual([
      "20260511110000-first",
      "20260511130000-third"
    ]);
  });

  it("discovers unapplied migrations with metadata-store applied checks", async () => {
    const migrationsPath = await createTempDir();
    await writeMigrationFile(migrationsPath, "20260511110000-first.ts", "20260511110000-first");
    await writeMigrationFile(migrationsPath, "20260511120000-second.ts", "20260511120000-second");

    const pending = await discoverUnappliedMigrations(migrationsPath, {
      async isMigrationApplied(migrationId: string) {
        return migrationId === "20260511110000-first";
      }
    });

    expect(pending.map((migration) => migration.id)).toEqual(["20260511120000-second"]);
  });

  it("discovers migrations from the resolved config migrations directory", async () => {
    const cwd = await createTempDir();
    const { config } = await initConfig({ cwd });
    await writeMigrationFile(config.migrationsPath, "20260511110000-first.ts", "20260511110000-first");

    const migrations = await discoverConfiguredMigrations(config);

    expect(migrations.map((migration) => migration.id)).toEqual(["20260511110000-first"]);
  });
});

async function writeMigrationFile(
  migrationsPath: string,
  fileName: string,
  id: string
): Promise<void> {
  await writeFile(path.join(migrationsPath, fileName), `
export default {
  id: "${id}",
  description: "${id}",
  collection: "users",
  mode: "online",
  batchSize: 100,
  match() {
    return {};
  },
  transform(document) {
    return document;
  },
  validate() {
    return {
      passed: true,
      checkedDocs: 0,
      validDocs: 0,
      invalidDocs: 0,
      errors: [],
      summary: "ok"
    };
  }
};
`);
}

function discovered(id: string): DiscoveredMigration {
  return {
    id,
    filePath: `/migrations/${id}.ts`,
    migration: {
      id,
      description: id,
      collection: "users",
      mode: "online",
      match() {
        return {};
      },
      transform(document) {
        return document;
      }
    }
  };
}
