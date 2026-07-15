#!/usr/bin/env node
// Standalone stdio MCP server wrapping the HackerOne Hacker API
// (https://api.hackerone.com/getting-started-hacker-api/). Spawned by
// IntelliRecon per mcp.config.json — same pattern as the bundled engine. Auth is
// HTTP Basic with a personal API identifier/token pair generated at
// https://hackerone.com/settings/api_token/edit (read-only, hacker-scoped
// token — NOT a program/customer API token).
//
// The Hacker API only documents GET endpoints (programs, structured scopes,
// scope exclusions, hacktivity, own reports). There is no documented
// endpoint for a hacker to submit a new report via API — HackerOne requires
// report submission through the web UI. h1_submit_report_draft below
// reflects that: it formats a submission-ready draft (title/severity/
// description/steps/impact) and writes it to the shared working directory
// rather than pretending to POST it anywhere.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFileSync } from "node:fs";
import path from "node:path";

const API_BASE = "https://api.hackerone.com/v1/hackers";
const USERNAME = process.env.HACKERONE_API_USERNAME || "";
const TOKEN = process.env.HACKERONE_API_TOKEN || "";
const AUTH_HEADER = "Basic " + Buffer.from(`${USERNAME}:${TOKEN}`).toString("base64");
const SHARED_DIR = process.env.INTELLIRECON_CWD || process.cwd();

function authError() {
  return {
    content: [
      {
        type: "text",
        text:
          "HACKERONE_API_USERNAME / HACKERONE_API_TOKEN are not set. " +
          "Generate a personal API token at https://hackerone.com/settings/api_token/edit " +
          "and put both values in the IntelliRecon .env file.",
      },
    ],
    isError: true,
  };
}

async function h1Fetch(pathAndQuery) {
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: { Authorization: AUTH_HEADER, Accept: "application/json" },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(`HackerOne API ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(e) {
  return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
}

const server = new McpServer({ name: "hackerone", version: "1.0.0" });

server.registerTool(
  "h1_list_programs",
  {
    description:
      "List HackerOne programs visible to this account (invited private programs plus public ones). " +
      "Supports pagination via the 'page' cursor HackerOne returns in links.next.",
    inputSchema: { page: z.string().optional().describe("Opaque pagination cursor from a previous response's links.next") },
  },
  async ({ page }) => {
    if (!USERNAME || !TOKEN) return authError();
    try {
      const qs = page ? `?${page.startsWith("page") ? page : `page%5Bcursor%5D=${encodeURIComponent(page)}`}` : "";
      const data = await h1Fetch(`/programs${qs}`);
      return textResult(data);
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "h1_get_program_scope",
  {
    description:
      "Get a program's structured scopes (in-scope assets: asset_type, asset_identifier, eligible_for_bounty/submission, " +
      "max_severity, instruction). Use the program handle from h1_list_programs (e.g. 'acme-corp'), not its numeric id.",
    inputSchema: { handle: z.string().describe("Program handle, e.g. 'acme-corp'") },
  },
  async ({ handle }) => {
    if (!USERNAME || !TOKEN) return authError();
    try {
      const data = await h1Fetch(`/programs/${encodeURIComponent(handle)}/structured_scopes`);
      return textResult(data);
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "h1_get_scope_exclusions",
  {
    description: "Get a program's scope exclusions — report categories/assets excluded from reward eligibility.",
    inputSchema: { handle: z.string().describe("Program handle, e.g. 'acme-corp'") },
  },
  async ({ handle }) => {
    if (!USERNAME || !TOKEN) return authError();
    try {
      const data = await h1Fetch(`/programs/${encodeURIComponent(handle)}/scope_exclusions`);
      return textResult(data);
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "h1_list_my_reports",
  {
    description: "List reports submitted by this account. Optionally filter by program handle(s) and/or state.",
    inputSchema: {
      program: z.string().optional().describe("Program handle to filter by, e.g. 'acme-corp'"),
      state: z
        .enum(["new", "triaged", "needs-more-info", "resolved", "not-applicable", "informative", "duplicate", "spam"])
        .optional(),
      page: z.string().optional().describe("Opaque pagination cursor from a previous response's links.next"),
    },
  },
  async ({ program, state, page }) => {
    if (!USERNAME || !TOKEN) return authError();
    try {
      const params = new URLSearchParams();
      if (program) params.set("program[]", program);
      if (state) params.set("filter[state][]", state);
      if (page) params.set("page[cursor]", page);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const data = await h1Fetch(`/reports${qs}`);
      return textResult(data);
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "h1_get_report",
  {
    description: "Get full detail for one of this account's reports by numeric id.",
    inputSchema: { id: z.union([z.string(), z.number()]).describe("Report id, e.g. 129329") },
  },
  async ({ id }) => {
    if (!USERNAME || !TOKEN) return authError();
    try {
      const data = await h1Fetch(`/reports/${encodeURIComponent(String(id))}`);
      return textResult(data);
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "h1_hacktivity",
  {
    description:
      "Search Hacktivity — publicly disclosed reports across HackerOne. Useful for prior-art research on a target " +
      "(has this class of bug been reported before?) and for bounty-pattern research. sort accepts " +
      "latest_disclosable_activity_at, disclosed_at, total_awarded_amount, or votes; prefix with '-' for descending.",
    inputSchema: {
      sort: z
        .string()
        .optional()
        .describe("e.g. '-disclosed_at' for newest disclosures first, '-total_awarded_amount' for highest bounty first"),
      page: z.string().optional().describe("Opaque pagination cursor from a previous response's links.next"),
    },
  },
  async ({ sort, page }) => {
    if (!USERNAME || !TOKEN) return authError();
    try {
      const params = new URLSearchParams();
      if (sort) params.set("sort", sort);
      if (page) params.set("page[cursor]", page);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const data = await h1Fetch(`/hacktivity${qs}`);
      return textResult(data);
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.registerTool(
  "h1_draft_report",
  {
    description:
      "HackerOne's Hacker API has no endpoint for submitting a new report — that only exists through the web UI. " +
      "This tool instead formats a submission-ready Markdown draft (title, severity, weakness, description, steps to " +
      "reproduce, impact) and writes it to the shared working directory so the operator can paste it into the " +
      "'Submit report' form for the target program.",
    inputSchema: {
      program: z.string().describe("Program handle, for the filename and a reminder link"),
      title: z.string(),
      severity: z.enum(["critical", "high", "medium", "low", "none"]),
      weakness: z.string().optional().describe("CWE / weakness category, e.g. 'Improper Authorization (CWE-285)'"),
      summary: z.string(),
      steps_to_reproduce: z.string(),
      impact: z.string(),
      supporting_material: z.string().optional().describe("Notes on attached evidence: screenshots, requests/responses, etc."),
    },
  },
  async ({ program, title, severity, weakness, summary, steps_to_reproduce, impact, supporting_material }) => {
    const md = `# ${title}

**Program:** ${program}
**Severity:** ${severity}
${weakness ? `**Weakness:** ${weakness}\n` : ""}
## Summary
${summary}

## Steps to Reproduce
${steps_to_reproduce}

## Impact
${impact}
${supporting_material ? `\n## Supporting Material\n${supporting_material}\n` : ""}
---
Submit at: https://hackerone.com/${encodeURIComponent(program)}/reports/new
`;
    const filename = `h1-draft-${program}-${Date.now()}.md`;
    const filePath = path.join(SHARED_DIR, filename);
    try {
      writeFileSync(filePath, md, "utf8");
      return textResult(`Draft written to ${filePath}\n\n${md}`);
    } catch (e) {
      return errorResult(e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
