import type { Document, Filter, WithId } from "mongodb";

import type {
  MigrationContext,
  MigrationDefinition,
  ValidationContext,
  ValidationResult
} from "../src/core/migrations/types.js";

const migration: MigrationDefinition = {
  id: "20260512090000-move-user-name-to-profile-fullname",
  description: "Move users.name to users.profile.fullName and mark schemaVersion 2",
  collection: "users",
  mode: "online",
  batchSize: 100,
  schemaVersion: {
    field: "schemaVersion",
    from: 1,
    to: 2
  },

  match(_ctx: MigrationContext): Filter<Document> {
    return {
      name: { $exists: true },
      "profile.fullName": { $exists: false },
      schemaVersion: { $ne: 2 }
    };
  },

  transform(document: WithId<Document>, _ctx: MigrationContext): Document | null {
    if (typeof document.name !== "string" || document.name.trim() === "") {
      return null;
    }

    const { name: _name, profile, ...rest } = document;
    const existingProfile = isObject(profile) ? profile : {};

    return {
      ...rest,
      profile: {
        ...existingProfile,
        fullName: document.name
      },
      schemaVersion: 2
    };
  },

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const users = await ctx.db.collection("users").find().sort({ _id: 1 }).toArray();
    const errors = [];
    let validDocs = 0;

    for (const user of users) {
      const before = errors.length;

      if (typeof user.profile?.fullName !== "string" || user.profile.fullName.trim() === "") {
        errors.push({
          documentId: user._id,
          message: "profile.fullName must exist"
        });
      }

      if ("name" in user) {
        errors.push({
          documentId: user._id,
          message: "legacy name field must be absent"
        });
      }

      if (typeof user.schemaVersion !== "number" || user.schemaVersion < 2) {
        errors.push({
          documentId: user._id,
          message: "schemaVersion must be at least 2"
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
        ? `Validation passed: ${validDocs}/${users.length} users have profile.fullName`
        : `Validation failed: ${validDocs}/${users.length} users have profile.fullName`
    };
  }
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default migration;
