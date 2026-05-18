import type { Document, Filter, WithId } from "mongodb";

import type {
  MigrationContext,
  MigrationDefinition,
  ValidationContext,
  ValidationResult
} from "../src/core/migrations/types.js";

const migration: MigrationDefinition = {
  id: "20260512091000-move-user-phone-to-contact-phone",
  description: "Move users.phone to users.contact.phone and mark schemaVersion 3",
  collection: "users",
  mode: "online",
  batchSize: 100,
  schemaVersion: {
    field: "schemaVersion",
    from: 2,
    to: 3
  },

  match(_ctx: MigrationContext): Filter<Document> {
    return {
      phone: { $exists: true },
      "contact.phone": { $exists: false },
      schemaVersion: { $ne: 3 }
    };
  },

  transform(document: WithId<Document>, _ctx: MigrationContext): Document | null {
    if (typeof document.phone !== "string" || document.phone.trim() === "") {
      return null;
    }

    const { phone: _phone, contact, ...rest } = document;
    const existingContact = isObject(contact) ? contact : {};

    return {
      ...rest,
      contact: {
        ...existingContact,
        phone: document.phone
      },
      schemaVersion: 3
    };
  },

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const users = await ctx.db.collection("users").find().sort({ _id: 1 }).toArray();
    const errors = [];
    let validDocs = 0;

    for (const user of users) {
      const before = errors.length;

      if (typeof user.contact?.phone !== "string" || user.contact.phone.trim() === "") {
        errors.push({
          documentId: user._id,
          message: "contact.phone must exist"
        });
      }

      if ("phone" in user) {
        errors.push({
          documentId: user._id,
          message: "legacy phone field must be absent"
        });
      }

      if (user.schemaVersion !== 3) {
        errors.push({
          documentId: user._id,
          message: "schemaVersion must be 3"
        });
      }

      if (errors.length === before) {
        validDocs += 1;
      }
    }

    return {
      passed: errors.length === 0,
      checkedDocs: users.length,
      validDocs,
      invalidDocs: users.length - validDocs,
      errors,
      summary: errors.length === 0
        ? `Validation passed: ${validDocs}/${users.length} users have contact.phone`
        : `Validation failed: ${validDocs}/${users.length} users have contact.phone`
    };
  }
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default migration;
