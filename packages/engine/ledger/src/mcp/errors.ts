export const MCP_ERROR_CODES = [
  "mcp_config_invalid",
  "mcp_connect_failed",
  "mcp_timeout",
  "mcp_tool_failed",
  "mcp_bad_response",
  "mcp_unavailable",
] as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

/** MCP-local typed error, mirroring the `LedgerError` style (`code: detail` messages). */
export class McpError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "McpError";
    this.code = code;
  }
}

export function isMcpErrorCode(value: string): value is McpErrorCode {
  return MCP_ERROR_CODES.some((code) => code === value);
}
