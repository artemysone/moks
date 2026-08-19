import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boundSourceLimit, readMcpConfig, resolveAtsId, resolveSourcingId } from "./config.ts";

describe("resolveAtsId", () => {
  test("defaults to mock", () => {
    expect(resolveAtsId({})).toBe("mock");
    expect(resolveAtsId({ MOKS_ATS: "mock" })).toBe("mock");
    expect(resolveAtsId({ MOKS_ATS: "  mock  " })).toBe("mock");
  });

  test("selects greenhouse", () => {
    expect(resolveAtsId({ MOKS_ATS: "greenhouse" })).toBe("greenhouse");
  });

  test("selects ashby (MCP-backed; fails closed at open without config)", () => {
    expect(resolveAtsId({ MOKS_ATS: "ashby" })).toBe("ashby");
  });

  test("unknown values fail", () => {
    expect(() => resolveAtsId({ MOKS_ATS: "lever" })).toThrow("unknown_ats: lever");
  });
});

describe("resolveSourcingId", () => {
  test("defaults off", () => {
    expect(resolveSourcingId({})).toBeNull();
    expect(resolveSourcingId({ MOKS_SOURCING: "off" })).toBeNull();
  });

  test("enables juicebox", () => {
    expect(resolveSourcingId({ MOKS_SOURCING: "juicebox" })).toBe("juicebox");
  });

  test("enables mcp", () => {
    expect(resolveSourcingId({ MOKS_SOURCING: "mcp" })).toBe("mcp");
  });

  test("unknown values fail", () => {
    expect(() => resolveSourcingId({ MOKS_SOURCING: "linkedin" })).toThrow("unknown_sourcing: linkedin");
  });
});

describe("readMcpConfig", () => {
  function cwdWithConfig(contents?: string): string {
    const cwd = mkdtempSync(join(tmpdir(), "moks-config-"));
    if (contents !== undefined) {
      mkdirSync(join(cwd, ".moks"), { recursive: true });
      writeFileSync(join(cwd, ".moks", "config.json"), contents);
    }
    return cwd;
  }

  test("missing file or mcp key yields empty config", () => {
    expect(readMcpConfig(cwdWithConfig())).toEqual({});
    expect(readMcpConfig(cwdWithConfig(JSON.stringify({ job_ref: "job_req200" })))).toEqual({});
  });

  test("a config file that exists but is not valid JSON fails loudly with a pointer to the file", () => {
    const cwd = cwdWithConfig('{ "mcp": { "ats": ');
    let thrown: unknown;
    try {
      readMcpConfig(cwd);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toStartWith("mcp_config_invalid: ");
    expect(message).toContain(join(cwd, ".moks", "config.json"));
    expect(message).toContain("not valid JSON");
  });

  test("parses stdio and http server configs, attaching cwd", () => {
    const cwd = cwdWithConfig(
      JSON.stringify({
        mcp: {
          ats: { command: ["bun", "fixtures/mock-mcp-ats.ts"], timeoutMs: 5000 },
          sourcing: { url: "http://127.0.0.1:8901/mcp" },
        },
      }),
    );
    expect(readMcpConfig(cwd)).toEqual({
      ats: { cwd, command: ["bun", "fixtures/mock-mcp-ats.ts"], timeoutMs: 5000 },
      sourcing: { cwd, url: "http://127.0.0.1:8901/mcp" },
    });
  });

  test("rejects malformed server entries", () => {
    expect(() => readMcpConfig(cwdWithConfig(JSON.stringify({ mcp: "stdio" })))).toThrow("mcp_config_invalid");
    expect(() => readMcpConfig(cwdWithConfig(JSON.stringify({ mcp: { ats: { command: [] } } })))).toThrow(
      "mcp_config_invalid: mcp.ats.command",
    );
    expect(() => readMcpConfig(cwdWithConfig(JSON.stringify({ mcp: { ats: { url: 42 } } })))).toThrow(
      "mcp_config_invalid: mcp.ats.url",
    );
    expect(() => readMcpConfig(cwdWithConfig(JSON.stringify({ mcp: { sourcing: {} } })))).toThrow(
      "mcp_config_invalid: mcp.sourcing needs exactly one of command or url",
    );
    expect(() =>
      readMcpConfig(
        cwdWithConfig(JSON.stringify({ mcp: { ats: { command: ["bun"], url: "http://127.0.0.1:1/mcp" } } })),
      ),
    ).toThrow("mcp_config_invalid: mcp.ats needs exactly one of command or url");
    expect(() =>
      readMcpConfig(cwdWithConfig(JSON.stringify({ mcp: { ats: { command: ["bun"], timeoutMs: -1 } } }))),
    ).toThrow("mcp_config_invalid: mcp.ats.timeoutMs");
  });
});

describe("boundSourceLimit", () => {
  test("defaults to 10 and caps at 25", () => {
    expect(boundSourceLimit()).toBe(10);
    expect(boundSourceLimit(2)).toBe(2);
    expect(boundSourceLimit(100)).toBe(25);
    expect(boundSourceLimit(0)).toBe(1);
  });
});
