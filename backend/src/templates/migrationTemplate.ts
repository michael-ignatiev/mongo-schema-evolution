export type RenderMigrationTemplateOptions = {
  id: string;
  description: string;
  typeImportPath: string;
};

export function renderMigrationTemplate(options: RenderMigrationTemplateOptions): string {
  return `import type { Document, Filter, WithId } from "mongodb";
import type {
  MigrationContext,
  MigrationDefinition,
  ValidationContext,
  ValidationResult
} from "${options.typeImportPath}";

const migration: MigrationDefinition = {
  id: "${options.id}",
  description: ${JSON.stringify(options.description)},
  collection: "users",
  mode: "online",
  batchSize: 500,
  schemaVersion: {
    field: "schemaVersion",
    from: 1,
    to: 2
  },

  match(_ctx: MigrationContext): Filter<Document> {
    // Match only old-shape documents. Keep this predicate narrow and retry-safe.
    return {
      schemaVersion: { $ne: 2 }
    };
  },

  async transform(document: WithId<Document>, _ctx: MigrationContext): Promise<Document | null> {
    // Return the new document shape, or null to skip this document.
    return {
      ...document,
      schemaVersion: 2
    };
  },

  async validate(_ctx: ValidationContext): Promise<ValidationResult> {
    // Replace this with post-migration invariants for the target collection.
    return {
      passed: true,
      checkedDocs: 0,
      validDocs: 0,
      invalidDocs: 0,
      errors: [],
      summary: "Validation not implemented yet"
    };
  }
};

export default migration;
`;
}
