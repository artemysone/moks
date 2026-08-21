import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite } from "../db.ts";
import { createJuiceboxAdapter, migrateJuicebox, seedJuicebox } from "./juicebox.ts";

const repoFixture = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/mock-juicebox.json");

const validFixture = {
  candidates: [
    {
      id: "jb_a",
      name: "Ada",
      title: "Senior Backend Engineer",
      headline: "Senior backend, payments infrastructure",
      source: "juicebox",
      score: 0.9,
    },
    {
      id: "jb_b",
      name: "Bea",
      title: "Frontend Engineer",
      headline: "Frontend, design systems",
      source: "juicebox",
      score: 0.4,
    },
  ],
};

function writeFixture(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "moks-jb-fixture-"));
  const path = join(dir, "mock-juicebox.json");
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe("seedJuicebox", () => {
  test("seeds once, then is a no-op", () => {
    const db = openSqlite(":memory:");
    migrateJuicebox(db);
    const path = writeFixture(validFixture);
    expect(seedJuicebox(db, path)).toBe(true);
    expect(seedJuicebox(db, path)).toBe(false);
  });
});

describe("createJuiceboxAdapter", () => {
  test("prepare seeds, then search filters by role keywords in headline/title", () => {
    const db = openSqlite(":memory:");
    migrateJuicebox(db);
    const adapter = createJuiceboxAdapter(db, { fixturePath: writeFixture(validFixture) });
    expect(adapter.prepare?.().seeded).toBe(true);
    expect(adapter.prepare?.().seeded).toBe(false);

    const backend = adapter.search({ role: "Senior Backend" });
    expect(backend).toHaveLength(1);
    expect(backend[0]).toEqual({
      id: "jb_a",
      name: "Ada",
      headline: "Senior backend, payments infrastructure",
      source: "juicebox",
      score: 0.9,
    });

    const frontend = adapter.search({ role: "frontend" });
    expect(frontend.map((c) => c.id)).toEqual(["jb_b"]);

    const none = adapter.search({ role: "recruiter" });
    expect(none).toEqual([]);
  });

  test("empty or whitespace role fails closed (no keywords → no candidates)", () => {
    const db = openSqlite(":memory:");
    migrateJuicebox(db);
    const adapter = createJuiceboxAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();

    expect(adapter.search({ role: "" })).toEqual([]);
    expect(adapter.search({ role: "   " })).toEqual([]);
    expect(adapter.search({ role: "A" })).toEqual([]);
  });

  test("keeps 2-letter tokens so QA/PM/SRE filter instead of matching all", () => {
    const db = openSqlite(":memory:");
    migrateJuicebox(db);
    const adapter = createJuiceboxAdapter(db, {
      fixturePath: writeFixture({
        candidates: [
          ...validFixture.candidates,
          {
            id: "jb_qa",
            name: "Quinn",
            title: "QA Engineer",
            headline: "QA, test automation",
            source: "juicebox",
            score: 0.7,
          },
          {
            id: "jb_pm",
            name: "Pat",
            title: "Product Manager",
            headline: "PM, roadmap and discovery",
            source: "juicebox",
            score: 0.6,
          },
          {
            id: "jb_sre",
            name: "Sam",
            title: "SRE",
            headline: "SRE, reliability and on-call",
            source: "juicebox",
            score: 0.8,
          },
        ],
      }),
    });
    adapter.prepare?.();

    expect(adapter.search({ role: "QA" }).map((c) => c.id)).toEqual(["jb_qa"]);
    expect(adapter.search({ role: "PM" }).map((c) => c.id)).toEqual(["jb_pm"]);
    expect(adapter.search({ role: "SRE" }).map((c) => c.id)).toEqual(["jb_sre"]);
  });

  test("short role tokens with no fixture matches return zero results", () => {
    const db = openSqlite(":memory:");
    migrateJuicebox(db);
    const adapter = createJuiceboxAdapter(db, { fixturePath: writeFixture(validFixture) });
    adapter.prepare?.();

    expect(adapter.search({ role: "QA" })).toEqual([]);
    expect(adapter.search({ role: "PM" })).toEqual([]);
    expect(adapter.search({ role: "SRE" })).toEqual([]);
  });

  test("honors limit and ranks by score", () => {
    const db = openSqlite(":memory:");
    migrateJuicebox(db);
    const adapter = createJuiceboxAdapter(db, {
      fixturePath: writeFixture({
        candidates: [
          { id: "low", name: "Low", title: "Backend", headline: "backend payments", score: 0.2 },
          { id: "high", name: "High", title: "Backend", headline: "backend payments", score: 0.99 },
          { id: "mid", name: "Mid", title: "Backend", headline: "backend payments", score: 0.5 },
        ],
      }),
    });
    adapter.prepare?.();

    const ranked = adapter.search({ role: "backend", limit: 2 });
    expect(ranked.map((c) => c.id)).toEqual(["high", "mid"]);
  });

  test("seeds the repo fixture and finds Senior Backend / payments profiles", () => {
    const db = openSqlite(":memory:");
    migrateJuicebox(db);
    const adapter = createJuiceboxAdapter(db, { fixturePath: repoFixture });
    expect(adapter.prepare?.().seeded).toBe(true);

    const results = adapter.search({ role: "Senior Backend payments" });
    expect(results).toHaveLength(5);
    expect(results.every((c) => c.source === "juicebox")).toBe(true);
    expect(results.map((c) => c.id)).toEqual([
      "jb_kenji",
      "jb_sofia",
      "jb_malik",
      "jb_irene",
      "jb_theo",
    ]);
  });
});
