import { createGreenhouseAdapter, migrateGreenhouse } from "./greenhouse.ts";
import { createJuiceboxAdapter, migrateJuicebox } from "./juicebox.ts";
import { createMcpAtsAdapter, createMcpSourcingAdapter } from "./mcp.ts";
import { createMockAdapter } from "./mock.ts";
import type { SourcedCandidate, SourcingAdapter } from "./sourcing.ts";
import type { AtsAdapter } from "./types.ts";
import { readMcpConfig, type SourcingId } from "../config.ts";
import { openSqlite } from "../db.ts";
import type { AtsId } from "../domain.ts";
import { LedgerError } from "../errors.ts";
import type { WorkspacePaths } from "../paths.ts";
import { migrateMockAts } from "../schema.ts";

export type { SourcedCandidate };

export function openAtsAdapter(
  ats: AtsId,
  paths: WorkspacePaths,
  closers: Array<() => void>,
): AtsAdapter {
  if (ats === "greenhouse") {
    const db = openSqlite(paths.greenhouseAtsDb);
    migrateGreenhouse(db);
    closers.push(() => db.close());
    return createGreenhouseAdapter(db, { fixturePath: paths.greenhouseFixtureFile });
  }
  if (ats === "ashby") {
    const mcp = readMcpConfig(paths.cwd).ats;
    if (!mcp) {
      throw new LedgerError("ats_unavailable: ashby");
    }
    const adapter = createMcpAtsAdapter(mcp, { id: "ashby" });
    closers.push(() => adapter.close?.());
    return adapter;
  }
  const db = openSqlite(paths.mockAtsDb);
  migrateMockAts(db);
  closers.push(() => db.close());
  return createMockAdapter(db, { fixturePath: paths.fixtureFile });
}

export function openSourcingAdapter(
  id: SourcingId | null,
  paths: WorkspacePaths,
  closers: Array<() => void>,
): SourcingAdapter | null {
  if (id === "mcp") {
    const mcp = readMcpConfig(paths.cwd).sourcing;
    if (!mcp) {
      throw new LedgerError("sourcing_unavailable: mcp");
    }
    const adapter = createMcpSourcingAdapter(mcp);
    closers.push(() => adapter.close?.());
    return adapter;
  }
  if (id !== "juicebox") {
    return null;
  }
  const db = openSqlite(paths.juiceboxDb);
  migrateJuicebox(db);
  closers.push(() => db.close());
  return createJuiceboxAdapter(db, { fixturePath: paths.juiceboxFixtureFile });
}
