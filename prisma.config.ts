import "dotenv/config";
import { defineConfig } from "prisma/config";

/*
  Prisma 7 moved CLI configuration out of schema.prisma and package.json into
  this file. The datasource URL is read here rather than via env() in the
  schema, so the schema no longer carries a `url` field.
*/
export default defineConfig({
  schema: "./prisma/schema.prisma",
  migrations: {
    path: "./prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
