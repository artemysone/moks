import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type WorkspacePaths = {
  cwd: string;
  dir: string;
  workspaceDb: string;
  mockAtsDb: string;
  greenhouseAtsDb: string;
  juiceboxDb: string;
  fixtureFile: string;
  greenhouseFixtureFile: string;
  juiceboxFixtureFile: string;
  vaultKey: string;
  hiringFile: string;
  companyFile: string;
  configFile: string;
};

export function workspacePaths(cwd: string): WorkspacePaths {
  const dir = join(cwd, ".moks");
  return {
    cwd,
    dir,
    workspaceDb: join(dir, "ledger.sqlite"),
    mockAtsDb: join(dir, "mock-ats.sqlite"),
    greenhouseAtsDb: join(dir, "greenhouse-ats.sqlite"),
    juiceboxDb: join(dir, "juicebox.sqlite"),
    fixtureFile: defaultFixturePath(),
    greenhouseFixtureFile: defaultGreenhouseFixturePath(),
    juiceboxFixtureFile: defaultJuiceboxFixturePath(),
    vaultKey: join(dir, "vault.key"),
    hiringFile: join(cwd, "HIRING.md"),
    companyFile: join(cwd, "COMPANY.md"),
    configFile: join(dir, "config.json"),
  };
}

export function defaultFixturePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../fixtures/mock-ats.json");
}

export function defaultGreenhouseFixturePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../fixtures/mock-greenhouse.json");
}

export function defaultJuiceboxFixturePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../fixtures/mock-juicebox.json");
}

export function defaultTemplateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../templates");
}

export function ensureWorkspaceDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
