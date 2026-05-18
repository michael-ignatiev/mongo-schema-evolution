# Mongo Schema Evolution

Mongo Schema Evolution is a CLI-only npm package for safe MongoDB document migration workflows. It scaffolds versioned migrations, previews impact with dry-run, applies migrations in deterministic resumable batches, validates migrated data, and stores migration history in MongoDB metadata collections.

The package root is `backend/`. There is no web UI.

## Why This Exists

MongoDB schema changes are different from SQL schema migrations. A MongoDB collection can contain old and new document shapes at the same time, application code may need to tolerate mixed versions during rollout, and large backfills should be retry-safe and observable.

This project treats migrations as schema evolution:

- match old-shape documents with explicit predicates
- move documents forward with optional `schemaVersion` markers
- preview impact without mutating data
- process large collections in batches
- checkpoint progress and resume failed runs
- validate post-migration invariants
- track applied migrations, run attempts, and checkpoints in MongoDB

## Package Layout

```text
backend/
  demo/
    usersSeed.ts
  migrations/
    20260512090000-move-user-name-to-profile-fullname.ts
    20260512091000-move-user-phone-to-contact-phone.ts
  src/
    cli/
    commands/
    config/
    core/
      history/
      metadata/
      migrations/
      mongo/
      runner/
      safety/
  test/
  package.json
```

All implementation code lives under `backend/`.

## Requirements

- Node.js 20 or newer
- npm
- MongoDB for manual demo runs

The automated test suite uses `mongodb-memory-server`, so tests do not require a manually running MongoDB instance.

## Install And Build

Run all commands from `backend/`.

```bash
cd backend
npm install
npm run build
node dist/cli/main.js --help
```

For local development without building:

```bash
npm run dev -- --help
```

## CLI Commands

```bash
node dist/cli/main.js init
node dist/cli/main.js create rename-user-name-to-profile-fullname
node dist/cli/main.js dry-run --migration <migration-id>
node dist/cli/main.js up
node dist/cli/main.js validate --migration <migration-id>
node dist/cli/main.js history
```

Command summary:

| Command | Purpose |
| --- | --- |
| `init` | Create `.mongo-evolution.json` and the migrations directory. |
| `create <name>` | Scaffold a timestamped migration file. |
| `dry-run --migration <id>` | Count and sample matching documents without mutation. |
| `up` | Apply unapplied migrations in deterministic order. |
| `validate --migration <id>` | Run a migration's validation logic. |
| `history` | Show applied migrations and run records. |

## Configuration

`init` creates a local `.mongo-evolution.json` file inside `backend/`:

```json
{
  "mongoUri": "mongodb://localhost:27017",
  "dbName": "mongo_evolution_demo",
  "migrationsDir": "./migrations",
  "defaultBatchSize": 500,
  "metadataCollectionPrefix": "_schema",
  "metadataCollections": {
    "migrations": "_schema_migrations",
    "runs": "_schema_migration_runs",
    "checkpoints": "_schema_migration_checkpoints"
  },
  "environment": "local"
}
```

## Migration Contract

Each migration exports a default migration definition:

```ts
import type { Document, Filter, WithId } from "mongodb";

type MigrationDefinition = {
  id: string;
  description: string;
  collection: string;
  mode: "online" | "offline" | "lazy-compatible";
  batchSize?: number;
  schemaVersion?: {
    field?: string;
    from?: number;
    to: number;
  };
  match: (ctx: MigrationContext) => Filter<Document> | Promise<Filter<Document>>;
  transform: (doc: WithId<Document>, ctx: MigrationContext) => Document | null | Promise<Document | null>;
  validate?: (ctx: ValidationContext) => ValidationResult | Promise<ValidationResult>;
};
```

The important rule is that `match` should target old-shape documents only. That keeps retries safe and prevents already migrated documents from being transformed again.

## Metadata Collections

Mongo Evolution stores migration state in MongoDB:

| Collection | Purpose |
| --- | --- |
| `_schema_migrations` | Successfully applied migrations. |
| `_schema_migration_runs` | Every run attempt, status, timestamps, counts, warnings, and errors. |
| `_schema_migration_checkpoints` | Batch progress used to resume failed migrations. |

Run records include matched, modified, failed, and batch counts when available.

## Safety Model

### Dry-Run

Dry-run loads the migration and evaluates `match`, then counts matching documents and optionally samples affected documents. It does not call `transform`, so it does not mutate data.

Warnings can include:

- migration already applied
- no matching documents
- missing migration batch size
- offline migration mode
- lazy-compatible mixed-version mode

### Batching

Batch size resolves in this order:

1. `migration.batchSize`
2. `config.defaultBatchSize`

Documents are processed in `_id` order to keep execution deterministic and to provide a stable checkpoint cursor.

### Checkpoints And Resume

The runner writes checkpoint records with:

- `runId`
- `migrationId`
- `batchNumber`
- `lastProcessedId`
- `processedCount`
- `modifiedCount`
- `failedCount`
- `updatedAt`

If a migration fails, the run is marked `failed`. A later retry creates a new run and resumes from the latest checkpoint for that migration.

### Idempotency

The project uses two layers of retry protection.

Migration authors should:

- match old-shape documents only
- use `schemaVersion` markers when useful
- avoid transforms that blindly append or nest data

The runner also marks each migrated document under:

```text
_mongoEvolution.appliedMigrations.<migrationId>
```

Retry queries exclude documents that already have that marker, and replacement writes include a marker-missing condition.

### Validation

Validation is explicit and per migration. A migration can define `validate(ctx)` and return:

- `passed`
- `checkedDocs`
- `validDocs`
- `invalidDocs`
- `errors`
- `warnings`
- `summary`

The CLI exits nonzero when validation fails.

## Demo Flow

The included demo evolves a `users` collection with two migrations:

1. Move `name` to `profile.fullName` and set `schemaVersion: 2`.
2. Move `phone` to `contact.phone` and set `schemaVersion: 3`.

Start a local MongoDB instance:

```bash
docker run --rm --name mongo-evolution-demo -p 27017:27017 mongo:8
```

In another terminal:

```bash
cd backend
npm install
npm run build
node dist/cli/main.js init --force
```

Seed old-shape users:

```bash
node --input-type=module <<'NODE'
import { MongoClient } from "mongodb";

const client = await MongoClient.connect("mongodb://localhost:27017");
const db = client.db("mongo_evolution_demo");

await db.collection("users").deleteMany({});
await db.collection("_schema_migrations").deleteMany({});
await db.collection("_schema_migration_runs").deleteMany({});
await db.collection("_schema_migration_checkpoints").deleteMany({});

await db.collection("users").insertMany([
  {
    _id: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+1-555-0101"
  },
  {
    _id: "user-2",
    name: "Grace Hopper",
    email: "grace@example.com",
    phone: "+1-555-0102"
  },
  {
    _id: "user-3",
    name: "Katherine Johnson",
    email: "katherine@example.com",
    phone: "+1-555-0103"
  }
]);

await client.close();
NODE
```

Preview, validate, run, validate again, and inspect history:

```bash
node dist/cli/main.js dry-run --migration 20260512090000-move-user-name-to-profile-fullname --sample-size 2
node dist/cli/main.js validate --migration 20260512090000-move-user-name-to-profile-fullname
node dist/cli/main.js up
node dist/cli/main.js validate --migration 20260512090000-move-user-name-to-profile-fullname
node dist/cli/main.js validate --migration 20260512091000-move-user-phone-to-contact-phone
node dist/cli/main.js history
```

The first validation should fail before migration because the old-shape documents do not yet have `profile.fullName`. After `up`, both validations should pass.

Final document shape:

```json
{
  "_id": "user-1",
  "email": "ada@example.com",
  "profile": {
    "fullName": "Ada Lovelace"
  },
  "contact": {
    "phone": "+1-555-0101"
  },
  "schemaVersion": 3
}
```

## Tests

Run from `backend/`:

```bash
npm run typecheck
npm test
npm run build
```

Current critical paths covered by tests:

- config initialization and loading
- migration scaffolding
- migration discovery, validation, ordering, and already-applied filtering
- metadata persistence for migrations, runs, and checkpoints
- dry-run non-mutation
- validation pass and failure results
- runner success and failure paths
- batching and checkpoint resume
- idempotent retry behavior
- CLI command-level behavior
- demo migration before/after shape

## MVP Scope

Included:

- CLI-only npm package under `backend/`
- local JSON config
- timestamped migration creation
- metadata-backed history
- deterministic runner
- dry-run
- batching
- checkpoint and resume
- validation
- retry-safe document markers
- demo migrations and integration tests

Not included in the MVP:

- web UI
- distributed locking
- automatic rollback
- schema inference
- sharded-cluster orchestration
