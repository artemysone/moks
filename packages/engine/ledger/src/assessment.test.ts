import { describe, expect, test } from "bun:test";
import {
  bindReqJob,
  getAssessment,
  getReqJob,
  latestAssessment,
  listAssessments,
  saveAssessment,
} from "./assessment.ts";
import { openSqlite } from "./db.ts";
import { migrateWorkspace } from "./schema.ts";

function memory() {
  const db = openSqlite(":memory:");
  migrateWorkspace(db);
  return db;
}

const dim = {
  label: "Systems",
  score: 4,
  evidence: "Shipped the ingest path",
  source_path: "candidates/ada.md",
};

describe("assessments", () => {
  test("save → get → latest for a candidate", () => {
    const db = memory();
    const first = saveAssessment(db, {
      reqRef: "eng-platform",
      candidateId: "ada",
      scorecardHash: "abc",
      overall: 4,
      recommendation: "advance",
      dimensions: [dim],
      createdAt: 10,
    });
    expect(getAssessment(db, first.id)).toEqual(first);
    const second = saveAssessment(db, {
      reqRef: "eng-platform",
      candidateId: "ada",
      scorecardHash: "abc",
      overall: 3,
      recommendation: "hold",
      dimensions: [{ ...dim, score: 3, evidence: "Less depth on storage" }],
      createdAt: 20,
    });
    expect(latestAssessment(db, { reqRef: "eng-platform", candidateId: "ada" })).toEqual(second);
    expect(getAssessment(db, "missing")).toBeUndefined();
    expect(latestAssessment(db, { reqRef: "eng-platform", candidateId: "nope" })).toBeUndefined();
  });

  test("list newest first", () => {
    const db = memory();
    saveAssessment(db, {
      id: "old",
      reqRef: "eng-platform",
      candidateId: "ada",
      scorecardHash: "abc",
      overall: 4,
      recommendation: "advance",
      dimensions: [dim],
      createdAt: 1,
    });
    saveAssessment(db, {
      id: "new",
      reqRef: "eng-platform",
      candidateId: "ada",
      scorecardHash: "abc",
      overall: 3,
      recommendation: "hold",
      dimensions: [dim],
      createdAt: 2,
    });
    saveAssessment(db, {
      id: "other",
      reqRef: "eng-platform",
      candidateId: "bev",
      scorecardHash: "abc",
      overall: 2,
      recommendation: "reject",
      dimensions: [dim],
      createdAt: 3,
    });
    expect(listAssessments(db, { reqRef: "eng-platform" }).map((row) => row.id)).toEqual(["other", "new", "old"]);
    expect(listAssessments(db, { reqRef: "eng-platform", candidateId: "ada" }).map((row) => row.id)).toEqual([
      "new",
      "old",
    ]);
  });

  test("invalid JSON / missing ids fail", () => {
    const db = memory();
    const base = {
      scorecardHash: "abc",
      overall: null,
      recommendation: "advance",
      dimensions: [dim],
    };
    expect(() => saveAssessment(db, { ...base, reqRef: "", candidateId: "ada" })).toThrow("req_ref_required");
    expect(() => saveAssessment(db, { ...base, reqRef: "eng-platform", candidateId: "" })).toThrow(
      "candidate_id_required",
    );
    expect(() =>
      saveAssessment(db, {
        ...base,
        reqRef: "eng-platform",
        candidateId: "ada",
        dimensions: [{ ...dim, score: Number.NaN }],
      }),
    ).toThrow("invalid_dimensions");
    db.prepare(
      `INSERT INTO assessments (id, req_ref, candidate_id, scorecard_hash, overall, recommendation, dimensions, created_at, changeset_id)
       VALUES ('bad', 'eng-platform', 'ada', 'abc', NULL, 'advance', 'not-json', 1, NULL)`,
    ).run();
    expect(() => getAssessment(db, "bad")).toThrow();
    db.prepare(
      `INSERT INTO assessments (id, req_ref, candidate_id, scorecard_hash, overall, recommendation, dimensions, created_at, changeset_id)
       VALUES ('shapeless', 'eng-platform', 'ada', 'abc', NULL, 'advance', '[{}]', 2, NULL)`,
    ).run();
    expect(() => getAssessment(db, "shapeless")).toThrow("invalid_dimensions");
  });
});

describe("req_jobs", () => {
  test("bindReqJob upsert then get", () => {
    const db = memory();
    expect(getReqJob(db, "eng-platform")).toBeUndefined();
    const first = bindReqJob(db, { reqSlug: "eng-platform", jobId: "job_1", title: "Platform" });
    expect(getReqJob(db, "eng-platform")).toEqual(first);
    const second = bindReqJob(db, { reqSlug: "eng-platform", jobId: "job_2", title: "Platform Eng" });
    expect(second).toEqual({
      reqSlug: "eng-platform",
      jobId: "job_2",
      title: "Platform Eng",
      createdAt: first.createdAt,
    });
    expect(getReqJob(db, "eng-platform")).toEqual(second);
    expect(() => bindReqJob(db, { reqSlug: "", jobId: "job_1", title: "Platform" })).toThrow("req_slug_required");
  });
});
