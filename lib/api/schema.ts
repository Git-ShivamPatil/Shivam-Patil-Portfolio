import { getProjects, getProjectBySlug } from "../../app/projects";
import type { Schema } from "./graphql";

/**
 * P24 — the GraphQL schema, over the same data the pages render.
 *
 * **Read-only, and that is a design decision rather than a shortcut.** A public
 * GraphQL endpoint with mutations is an unauthenticated write surface with a
 * flexible query language in front of it; the parser refuses `mutation` by name
 * for the same reason. Everything mutable on this site already has a REST route
 * with its own CSRF check, rate limit and audit trail, and duplicating those
 * guarantees in a second protocol would double the number of places a mistake
 * can happen.
 *
 * Resolvers deliberately do not batch. With three top-level fields over data
 * that is already in memory there is nothing to N+1 on, and adding a DataLoader
 * here would be machinery guarding against a problem this schema cannot have.
 * The moment a resolver touches Postgres per row, that stops being true.
 */

const projectFields: Schema = {
  slug: { type: "String!", resolve: (_args, parent) => (parent as { slug: string }).slug },
  title: { type: "String!", resolve: (_args, parent) => (parent as { title: string }).title },
  category: {
    type: "String!",
    resolve: (_args, parent) => (parent as { category: string }).category,
  },
  summary: { type: "String!", resolve: (_args, parent) => (parent as { summary: string }).summary },
  outcome: { type: "String!", resolve: (_args, parent) => (parent as { outcome: string }).outcome },
  stack: {
    type: "[String!]!",
    description: "Technologies the project is built on.",
    resolve: (_args, parent) => (parent as { stack: string[] }).stack,
  },
  tags: { type: "[String!]!", resolve: (_args, parent) => (parent as { tags: string[] }).tags },
};

export function buildSchema(): Schema {
  return {
    projects: {
      type: "[Project!]!",
      description: "Every published project, newest first.",
      fields: projectFields,
      resolve: async (args) => {
        const all = await getProjects();
        const tag = typeof args.tag === "string" ? args.tag.toLowerCase() : null;
        const filtered = tag
          ? all.filter((project) => project.tags.some((value) => value.toLowerCase() === tag))
          : all;

        // A hard ceiling regardless of what was asked for. `limit` is a request,
        // not an instruction — an endpoint that returns whatever count the
        // caller names is one `limit: 100000` away from being a load generator.
        const requested = typeof args.limit === "number" ? args.limit : filtered.length;
        return filtered.slice(0, Math.max(0, Math.min(requested, 50)));
      },
    },

    project: {
      type: "Project",
      description: "One project by slug. Null when it does not exist.",
      fields: projectFields,
      resolve: async (args) => {
        if (typeof args.slug !== "string") {
          throw new Error("slug is required and must be a string");
        }
        // Null rather than an error for a missing project: "not found" is an
        // ordinary answer to a lookup, and a nullable field is how GraphQL says
        // so without failing the whole response.
        return (await getProjectBySlug(args.slug)) ?? null;
      },
    },

    tags: {
      type: "[String!]!",
      description: "Every tag used across the project set.",
      resolve: async () => {
        const all = await getProjects();
        return [...new Set(all.flatMap((project) => project.tags))].sort();
      },
    },
  };
}
