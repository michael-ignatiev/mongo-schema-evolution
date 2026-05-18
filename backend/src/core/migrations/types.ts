import type { Db, Document, Filter, WithId } from "mongodb";

export type MigrationMode = "online" | "offline" | "lazy-compatible";

export type MigrationMetadata = {
  id: string;
  description: string;
  collection: string;
  mode: MigrationMode;
  batchSize?: number;
  schemaVersion?: {
    field?: string;
    from?: number;
    to: number;
  };
};

export type MigrationContext = {
  db: Db;
  migration: MigrationMetadata;
};

export type ValidationIssue = {
  documentId?: unknown;
  message: string;
};

export type ValidationResult = {
  passed: boolean;
  checkedDocs: number;
  validDocs: number;
  invalidDocs: number;
  errors: ValidationIssue[];
  warnings?: string[];
  summary: string;
};

export type ValidationContext = MigrationContext;

export type MigrationDefinition = MigrationMetadata & {
  match: (ctx: MigrationContext) => Filter<Document> | Promise<Filter<Document>>;
  transform: (
    document: WithId<Document>,
    ctx: MigrationContext
  ) => Document | null | Promise<Document | null>;
  validate?: (ctx: ValidationContext) => ValidationResult | Promise<ValidationResult>;
};
