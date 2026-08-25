import { readFileSync } from "node:fs";
import type { SqlBindings, SqliteDb } from "../db.ts";
import { isJsonObject, jsonNumber, jsonString, parseJsonText } from "../json.ts";
import type { SourcedCandidate, SourcingAdapter, SourcingQuery } from "./sourcing.ts";

type FixtureCandidate = {
  id: string;
  name: string;
  headline: string;
  title?: string;
  source?: string;
  score?: number;
};

type FixtureFile = {
  candidates: FixtureCandidate[];
};

type StoredCandidate = {
  id: string;
  name: string;
  headline: string;
  title: string;
  source: string;
  score: number | null;
};

/** Isolated Juicebox tables — do not share `schema.ts` / mock ATS tables. */
export function migrateJuicebox(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS juicebox_candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      headline TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      score REAL
    );
  `);
}

type CountRow = { n: number };

function parseJuiceboxFixture(path: string): FixtureFile {
  const json = parseJsonText(readFileSync(path, "utf8"));
  if (!isJsonObject(json) || !Array.isArray(json.candidates)) {
    throw new Error("Invalid juicebox fixture");
  }
  const candidates: FixtureCandidate[] = [];
  for (const item of json.candidates) {
    if (!isJsonObject(item)) throw new Error("Invalid juicebox fixture candidate");
    const id = jsonString(item.id);
    const name = jsonString(item.name);
    const headline = jsonString(item.headline);
    if (!id || !name || !headline) throw new Error("Invalid juicebox fixture candidate");
    const candidate: FixtureCandidate = { id, name, headline };
    const title = jsonString(item.title);
    if (title !== undefined) candidate.title = title;
    const source = jsonString(item.source);
    if (source !== undefined) candidate.source = source;
    const score = jsonNumber(item.score);
    if (score !== undefined) candidate.score = score;
    candidates.push(candidate);
  }
  return { candidates };
}

export function seedJuicebox(db: SqliteDb, fixturePath: string): boolean {
  const count = db.prepare<CountRow, SqlBindings>("SELECT COUNT(*) AS n FROM juicebox_candidates").get();
  if (count && count.n > 0) {
    return false;
  }

  const fixture = parseJuiceboxFixture(fixturePath);
  const insert = db.prepare(
    "INSERT INTO juicebox_candidates (id, name, headline, title, source, score) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const seed = db.transaction(() => {
    for (const candidate of fixture.candidates) {
      insert.run(
        candidate.id,
        candidate.name,
        candidate.headline,
        candidate.title ?? "",
        candidate.source ?? "juicebox",
        candidate.score ?? null,
      );
    }
  });
  seed();

  return true;
}

function roleKeywords(role: string): string[] {
  return role
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function matchesRole(candidate: StoredCandidate, query: SourcingQuery): boolean {
  const keywords = roleKeywords(query.role);
  if (keywords.length === 0) {
    return false;
  }
  const haystack = `${candidate.headline} ${candidate.title}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function toSourced(candidate: StoredCandidate): SourcedCandidate {
  const sourced: SourcedCandidate = {
    id: candidate.id,
    name: candidate.name,
    headline: candidate.headline,
    source: candidate.source,
  };
  if (candidate.score !== null) {
    sourced.score = candidate.score;
  }
  return sourced;
}

export function createJuiceboxAdapter(db: SqliteDb, options: { fixturePath: string }): SourcingAdapter {
  return {
    id: "juicebox",
    prepare() {
      return { seeded: seedJuicebox(db, options.fixturePath) };
    },
    search(query) {
      const rows = db
        .prepare<StoredCandidate, SqlBindings>("SELECT id, name, headline, title, source, score FROM juicebox_candidates")
        .all();

      const matched = rows.filter((row) => matchesRole(row, query));
      matched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      const limit = query.limit ?? matched.length;
      return matched.slice(0, limit).map(toSourced);
    },
  };
}
