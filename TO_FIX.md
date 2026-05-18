# To Fix

This file tracks framework issues that should stay visible before Sidecar is treated as alpha-ready.

## 1. Tunnel Reliability

`sidecar dev --tunnel` must reliably produce a working public HTTPS MCP URL or fail with a precise, actionable diagnosis. Anonymous tunnel providers can fail, show interstitials, or behave differently under abuse controls, so Sidecar needs a deliberate tunnel strategy instead of ad hoc fallback.

## 2. Downstream Auth / Upstream MCP Wrapping

The Notion wrapper exposed a missing framework pattern: Sidecar is the MCP resource server, but examples may need to link to an upstream MCP/API service with its own OAuth. Token pass-through is not spec-compliant and is rejected by Claude custom connectors, so Sidecar needs a clean auth broker/token-store story for real wrappers.

## 3. Capability Honesty

Sidecar should only advertise MCP capabilities it actually supports end to end. Streamable HTTP now supports GET SSE, POST SSE for request progress, list-change notifications, resource update notifications, and `notifications/cancelled`; continue auditing advanced optional capabilities before advertising them by default, especially per-client resource subscription behavior and draft/advanced MCP capabilities.

## 4. Schema Correctness

TypeScript schema inference is improving, but it remains heuristic. Provider-specific shapes, discriminated unions, and richer JSON Schema constructs need stronger compiler support and runtime validation alignment.

## 5. Build/Dev Output Audit

Run a formal conformance audit against actual built/dev wire responses: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, auth failures, pagination, notifications, and widget resources. Compare output to the MCP spec, not only to Sidecar tests.

## 6. Claude Plugin Output

Claude plugin packages correctly reference a hosted MCP server instead of bundling one, but generated `.mcp.json`, README text, and install instructions need continued scrutiny so users understand what URL must be replaced after hosting.

## 7. MCP Apps UI Host Reality

Sidecar now targets the official MCP Apps bridge path, but ChatGPT and Claude may differ in live host support. We need real host testing for widget resources, bridge messages, theming, display behavior, and graceful degradation.
