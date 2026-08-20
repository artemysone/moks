import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url: process.env.MOKS_DB ?? `${process.env.HOME}/.local/share/moks/moks.db`,
  },
})
