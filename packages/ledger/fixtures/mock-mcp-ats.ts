// MCP fixture server (stdio): backs an ATS + sourcing system for integration tests.
// Usage: bun fixtures/mock-mcp-ats.ts [dataset.json]
import { fileURLToPath } from "node:url";
import { runMockMcpAtsServer } from "../src/mcp/fixture-server.ts";

const datasetPath = process.argv[2] ?? fileURLToPath(new URL("./mock-mcp-ats.json", import.meta.url));
await runMockMcpAtsServer({ datasetPath });
