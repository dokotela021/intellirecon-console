<div align="center">


[![Go](https://img.shields.io/badge/Go-1.24+-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://go.dev)
[![License](https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Linux-111111?style=for-the-badge&logo=linux&logoColor=white)](#installation)
[![Hosted](https://img.shields.io/badge/Hosted-www.intellirecon.com-6d28d9?style=for-the-badge&logo=icloud&logoColor=white)](https://www.intellirecon.com/)
[![GitHub stars](https://img.shields.io/github/stars/intellirecon/intellirecon?style=for-the-badge&logo=github&color=yellow)](https://github.com/intellirecon/intellirecon/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/intellirecon/intellirecon?style=for-the-badge&logo=github&color=blue)](https://github.com/intellirecon/intellirecon/network/members)
[![GitHub release](https://img.shields.io/github/v/release/intellirecon/intellirecon?style=for-the-badge&logo=github&color=green)](https://github.com/intellirecon/intellirecon/releases)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/intellirecon/intellirecon)

<a href="https://trendshift.io/repositories/35278?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-35278" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/35278/daily?language=Go" alt="intellirecon/intellirecon | Trendshift" width="250" height="55"/></a>

</div>

<h1 align="center">IntelliRecon — Open-source AI pentester that <em>proves</em> vulnerabilities</h1>

<p align="center">
  <strong>Most scanners detect. IntelliRecon proves.</strong> An autonomous LLM agent works a full pentest methodology, then an <strong>independent verifier re-exploits every finding</strong> before it's reported — so you get proof, not a pile of maybes to triage. Self-hosted, private, and bring-your-own-LLM. Built in Go + TypeScript.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#why-intellirecon">Why IntelliRecon</a> ·
  <a href="#features">Features</a> ·
  <a href="#use-cases">Use Cases</a> ·
  <a href="https://www.intellirecon.com/">Hosted Cloud</a> ·
  <a href="https://docs.intellirecon.com">Docs</a>
</p>

---

## Quick Start

**Install (one line):**

```bash
curl -sSL https://www.intellirecon.com/install | bash
```

This downloads the prebuilt binary for your platform (Linux amd64/arm64) from the latest release. Then point it at your LLM provider in `~/.intellirecon.env`:

```bash
INTELLIRECON_LLM=minimax/MiniMax-M3
INTELLIRECON_API_KEY=your_provider_api_key
```

Launch the dashboard and open `http://127.0.0.1:9137`:

```bash
intellirecon --web
```

**Or run with Docker — batteries included, no toolchain needed:**

```bash
docker run --rm -p 9137:9137 \
  -v intellirecon-data:/data \
  intellirecon/intellirecon:latest
```

Open `http://localhost:9137`. You **don't need an LLM key to start** — the dashboard launches without one; set the model + API key under **Settings → LLM** (it persists to the `/data` volume). If you don't pass `INTELLIRECON_USERNAME`/`INTELLIRECON_PASSWORD`, a random admin password is generated and printed to the container logs on first run.

**Easiest — Docker Compose** (maps the port + a persistent volume for you):

```bash
curl -sSLO https://raw.githubusercontent.com/intellirecon/intellirecon/main/docker-compose.yml
docker compose up -d
docker compose logs -f   # shows the generated admin password on first start
```

The image ships an extensive offensive-security toolset preinstalled (nmap, nuclei, httpx, subfinder, katana, ffuf, gobuster, sqlmap, masscan, dalfox, feroxbuster, and more) **and** keeps every package manager (apt, go, cargo, pipx, npm) available so the agent can still auto-install anything missing at runtime. It runs as root inside the container by design — treat the container as a disposable, network-isolated scanning sandbox and never expose the dashboard without auth. (amd64 image; the installer above covers arm64.)

**Or build from source** (needs Go 1.25+ and Node.js):

```bash
git clone https://github.com/intellirecon/intellirecon.git
cd intellirecon
make build
sudo install -m 755 build/intellirecon /usr/local/bin/intellirecon
```

> [!TIP]
> Prefer zero setup? A fully managed version runs at [www.intellirecon.com](https://www.intellirecon.com/) — click-to-scan, no install or API keys required.

### Review pull requests automatically — free GitHub App

Want a security review on every pull request with zero setup? Install the **[IntelliRecon GitHub App](https://github.com/apps/intellirecon)**. It reads each PR's diff and comments a security review — injection, broken auth/IDOR, SSRF, secrets, unsafe patterns — right on the pull request. Updates in place on new commits, and you can comment **`@intellirecon review`** to re-run on demand. No workflow file, no API key, no account — and it's free.

<div align="center">

[**➕ Add IntelliRecon to GitHub →**](https://github.com/apps/intellirecon/installations/new)

</div>

For merge gating and full exploit-verified pentests in CI, use the [hosted scanner](https://www.intellirecon.com/) or the GitHub Action.

> [!IMPORTANT]
> Use IntelliRecon only on systems you own or have explicit permission to test.

> [!TIP]
> Prefer not to self-host? A fully managed version is available at [www.intellirecon.com](https://www.intellirecon.com/) — click-to-scan, no install or API keys required.

## Contents

- [Quick Start](#quick-start)
- [Overview](#overview)
- [Why IntelliRecon](#why-intellirecon)
- [Use Cases](#use-cases)
- [Screenshots](#screenshots)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Upgrading from previous versions](#upgrading-from-previous-versions)
- [Running](#running)
- [Service Mode](#service-mode)
- [Web UI Workflow](#web-ui-workflow)
- [Scan Modes](#scan-modes)
- [Methodology](#methodology)
- [Reports](#reports)
- [Settings](#settings)
- [Environment Variables](#environment-variables)
- [Provider Prefixes](#provider-prefixes)
- [CLI Reference](#cli-reference)
- [API Summary](#api-summary)
- [Data Storage](#data-storage)
- [Development](#development)
- [Safety Notes](#safety-notes)
- [License](#license)
- [Links](#links)

## Overview

IntelliRecon is a self-hosted AI penetration testing platform for authorized security testing, vulnerability assessment, and bug bounty workflows. It combines an LLM-driven autonomous agent, browser automation, terminal tooling, a comprehensive 22-phase testing methodology, live WebSocket telemetry, finding management with CVSS scoring, branded PDF report generation, and integrations for AgentMail, Discord, and Telegram.

Unlike cloud-only DAST scanners, IntelliRecon runs entirely on your machine. You bring your own LLM provider (OpenAI, Anthropic, DeepSeek, Gemini, Groq, Ollama, MiniMax) and control the model, reasoning effort, rate limits, and proxy configuration. No scan data, API keys, or target information leaves your infrastructure.

The default experience is the Web UI. From one local dashboard you can start scans, monitor active runs, inspect findings, configure model/provider settings, manage environment variables, generate branded PDF reports, and delete or resume historical scans.

## Why IntelliRecon

Most scanners **detect**. IntelliRecon **proves**. An autonomous agent works through a 22-phase methodology, then an independent verifier re-tests every candidate finding before it is reported — so you get exploit-verified results with evidence, not a wall of "maybes" to triage.

- 🧠 **An AI agent, not a template engine** — reasons about auth flows, business logic, IDOR/BOLA, and chained exploits that signature scanners miss.
- ✅ **Exploit-verified findings** — a separate verifier independently reproduces each finding; inconclusive ones are flagged for review, never dressed up as confirmed.
- 🔒 **Self-hosted and private** — runs on your machine with your own LLM key; no target data, keys, or findings leave your infrastructure.
- 🧩 **Bring your own LLM** — OpenAI, Anthropic, DeepSeek, Gemini, Groq, Ollama, or MiniMax — or any OpenAI-compatible gateway like [LiteLLM](#litellm--openai-compatible-gateways-github-copilot-claude-opus-codex-openrouter-azure-local-models) (GitHub Copilot, Codex, OpenRouter, Azure). You control model, reasoning effort, and cost.
- 📄 **Audit-ready reports** — branded PDFs with CVSS scores, proof-of-concept, and remediation.

### How it compares

|                                              | **IntelliRecon**             | Template scanners (e.g. Nuclei) | Crawling scanners (e.g. OWASP ZAP) | Commercial DAST        |
| -------------------------------------------- | ------------------------ | ------------------------------- | ---------------------------------- | ---------------------- |
| Approach                                     | Autonomous AI agent      | Signatures / templates          | Spider + active rules              | Signatures + heuristics |
| Business logic / IDOR / auth-bypass coverage | ✅                       | Limited                         | Limited                            | Partial                |
| Exploit-verified (proves impact)             | ✅ independent verifier  | ❌                              | ❌                                 | Partial                |
| False-positive load                          | Low (proven)             | Template-dependent              | High                               | Medium                 |
| Self-hosted / data stays local               | ✅                       | ✅                              | ✅                                 | Usually cloud          |
| Bring-your-own LLM                           | ✅                       | —                               | —                                  | ❌                     |
| Branded PDF reports                          | ✅                       | ❌                              | Basic                              | ✅                     |
| Cost                                         | Open source + your LLM   | Free                            | Free                               | $$$                    |

> Directional comparison — Nuclei and ZAP are excellent at what they do. IntelliRecon adds the reasoning-heavy discovery and exploit-verification layer on top.

If IntelliRecon saves you a triage cycle, please **[⭐ star the repo](https://github.com/intellirecon/intellirecon)** — it genuinely helps others find it.

## Use Cases

| Use Case | How IntelliRecon helps |
| -------- | ------------------ |
| **Penetration testing** | Run a full 22-phase methodology against authorized targets. The AI agent handles reconnaissance, vulnerability discovery, injection testing, SSRF, IDOR, auth bypass, race conditions, and more — then verifies findings before reporting. |
| **Bug bounty hunting** | Point IntelliRecon at an in-scope target and let the agent enumerate the attack surface, test for common vulnerability classes, and surface verified findings with CVSS scores and proof-of-concept evidence. |
| **Red team operations** | Use wildcard and multi-target scan modes to map an organization's external attack surface. Browser-assisted DAST handles auth flows, forms, and runtime behavior that static scanners miss. |
| **Security research** | The novel-vulnerability-discovery phase pushes the agent beyond known template matching. Bring your own LLM (OpenAI, Anthropic, DeepSeek, Gemini, Ollama, MiniMax) to control reasoning depth and cost. |
| **Continuous security testing** | Run as a system service with `intellirecon --start`. Scan on a schedule, stream findings to Discord or Telegram, and generate branded PDF reports for stakeholders. |
| **DAST automation** | Browser-driven testing for web applications — auth flows, forms, JavaScript-rendered content, and runtime behavior. Integrates with Caido for proxy traffic inspection. |

## Screenshots

| Overview dashboard | Scan detail | Findings |
| ------------------- | ------------ | -------- |
| ![IntelliRecon overview dashboard](assets/screenshot-1.png) | ![IntelliRecon scan detail](assets/screenshot-2.png) | ![IntelliRecon findings](assets/screenshot-3.png) |

## Features

| Area           | Capabilities                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Dashboard      | Local Web UI on `127.0.0.1:9137` by default, scan management, live status, bulk scan actions, and historical scan recovery. |
| Scanning       | Single target, DAST, wildcard, and multi-target flows with selectable methodology phases.                                   |
| Live telemetry | Tool calls, agent messages, findings, errors, HTTP activity, and LLM activity over WebSockets.                              |
| Findings       | Scan detail pages, severity filters, CVSS details, finding index, and verified finding workflows.                           |
| Reporting      | Branded PDF reports with target/company name, uploaded logo, report list, open/download/delete actions.                     |
| Integrations   | AgentMail test inboxes, verification emails, OTP flows, email triage events, Discord and Telegram notifications.            |
| Configuration  | Dashboard settings for LLM, AgentMail, Discord, Telegram, proxy, runtime, browser, auth, rate limits, and resources.       |
| Runtime safety | Resource-aware instance limits and loopback-only binding unless external access is explicitly configured with auth.         |

## Installation

The fastest paths need no toolchain at all.

### One-line install (prebuilt binary)

```bash
curl -sSL https://www.intellirecon.com/install | bash
```

Downloads the latest release binary for your platform (Linux `amd64`/`arm64`) and installs it to `/usr/local/bin` (or `~/.local/bin` without sudo). Override with `INTELLIRECON_INSTALL_DIR` or pin a version with `INTELLIRECON_VERSION=vX.Y.Z`.

### Docker

```bash
docker run --rm -p 9137:9137 \
  -e INTELLIRECON_LLM=minimax/MiniMax-M3 \
  -e INTELLIRECON_API_KEY=your_provider_api_key \
  -v intellirecon-data:/data \
  ghcr.io/intellirecon/intellirecon:latest
```

The image is **batteries-included**: an extensive offensive-security toolset is preinstalled (nmap, nuclei, httpx, subfinder, dnsx, naabu, katana, ffuf, gobuster, dalfox, feroxbuster, sqlmap, masscan, nikto, whatweb, hydra, and more), plus Chromium for browser-assisted DAST. It also keeps the full package-manager set (apt, go, cargo, pipx, npm) available, so the agent auto-installs anything missing at runtime. Scan data persists to the `/data` volume, and the server binds `0.0.0.0` inside the container — set `INTELLIRECON_USERNAME`/`INTELLIRECON_PASSWORD` before exposing it beyond localhost.

The container runs as root by design (the engine only enables runtime auto-install for uid 0, and apt/go/cargo installs need system write access). Treat it as a disposable, network-isolated scanning sandbox. It's published for `amd64`; use the one-line installer for arm64 hosts.

On first run, if you don't set dashboard auth the container **generates a random admin password and prints it to the logs** (the image binds `0.0.0.0`, which the engine won't do without auth). Set `INTELLIRECON_USERNAME` + `INTELLIRECON_PASSWORD` (or `INTELLIRECON_PASSWORD_HASH`) to use your own. The binary never self-updates inside the container (`INTELLIRECON_NO_AUTO_UPDATE=1`) — pull a new image tag to upgrade.

### Requirements (build from source)

| Requirement    | Notes                                                        |
| -------------- | ------------------------------------------------------------ |
| Linux          | Primary supported platform.                                  |
| Go             | `1.25` or newer.                                             |
| Node.js + npm  | Required when building the bundled React Web UI from source. |
| Security tools | Installed on demand only when auto-install is enabled.       |

Check your Go version:

```bash
go version
```

### Build From Source

```bash
git clone https://github.com/intellirecon/intellirecon.git
cd intellirecon
make build
sudo install -m 755 build/intellirecon /usr/local/bin/intellirecon
```

`make build` builds the React Web UI into `internal/web/static`, then builds the Go binary.

### Install With Go

```bash
GOPROXY=direct GOSUMDB=off go install github.com/intellirecon/intellirecon/v4/cmd/intellirecon@latest
```

## Configuration

IntelliRecon loads configuration in this order. Later sources override earlier ones.

| Order | Source                                                         |
| ----- | -------------------------------------------------------------- |
| 1     | `/etc/intellirecon.env`                                            |
| 2     | `/home/<sudo-user>/.intellirecon.env` when launched through `sudo` |
| 3     | `~/.intellirecon.env`                                              |
| 4     | Environment variables already present in the process           |

Create the local environment file:

```bash
nano ~/.intellirecon.env
```

### Minimal Config

```bash
INTELLIRECON_LLM=minimax/MiniMax-M3
INTELLIRECON_API_KEY=your_provider_api_key
```

### Provider Examples

OpenAI:

```bash
INTELLIRECON_LLM=openai/gpt-5.4
INTELLIRECON_API_KEY=sk-...
```

Custom OpenAI-compatible provider:

```bash
INTELLIRECON_LLM=custom/security-model
INTELLIRECON_API_BASE=https://your-provider.example/v1
INTELLIRECON_API_KEY=your_provider_api_key
```

#### LiteLLM / OpenAI-compatible gateways (GitHub Copilot, Claude Opus, Codex, OpenRouter, Azure, local models)

Because `INTELLIRECON_API_BASE` accepts any OpenAI-compatible `/v1/chat/completions` endpoint,
IntelliRecon works with a [LiteLLM](https://docs.litellm.ai/) proxy out of the box — no
IntelliRecon-side changes needed. LiteLLM handles the upstream provider auth (Copilot device
login, Azure keys, OpenRouter, Ollama, etc.); IntelliRecon just talks OpenAI to the gateway.

Run LiteLLM (example `config.yaml`):

```yaml
model_list:
  - model_name: claude-opus-4-8
    litellm_params:
      model: github_copilot/claude-opus-4.8   # or openrouter/…, azure/…, ollama/…
general_settings:
  master_key: sk-local-litellm-key
```

Point IntelliRecon at it — use the `custom/` prefix so the model name is sent verbatim and the
OpenAI chat-completions protocol is used:

```bash
INTELLIRECON_LLM=custom/claude-opus-4-8            # the LiteLLM model_name
INTELLIRECON_API_BASE=http://localhost:4000/v1     # your LiteLLM proxy
INTELLIRECON_API_KEY=sk-local-litellm-key          # LiteLLM master_key / virtual key
```

The same pattern covers GitHub Copilot Business/CLI, Claude Opus, Codex-style models,
OpenRouter, Azure OpenAI, and local Ollama models — anything LiteLLM can route. Keep the
`custom/` (or `openai/`) prefix and a non-Anthropic/Gemini `INTELLIRECON_API_BASE` so IntelliRecon
uses the standard OpenAI request shape that LiteLLM expects.

### Optional Integrations

```bash
GEMINI_API_KEY=AIza...
AGENTMAIL_POD=am_us_pod_47
AGENTMAIL_API_KEY=ak_...
INTELLIRECON_DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
INTELLIRECON_DISCORD_MIN_SEVERITY=high
```

### Dashboard Authentication

```bash
INTELLIRECON_USERNAME=admin
INTELLIRECON_PASSWORD=change-this-password
```

> [!TIP]
> Prefer `INTELLIRECON_PASSWORD_HASH` for production deployments.

## Upgrading from previous versions

This release ships a stability and workspace-isolation pass with one breaking change and a few new knobs worth knowing about.

### Breaking change: default workspace moved to `~/.intellirecon/data/`

Scan output, notes, schedules, and other generated artefacts now live under `~/.intellirecon/data/` instead of `$CWD` (the directory the binary was launched from).

To retain the previous behavior, point `INTELLIRECON_DATA_DIR` at your current working directory:

```bash
export INTELLIRECON_DATA_DIR=$(pwd)
```

A `[MIGRATION]` warning is emitted at startup when legacy markers (`notes.json`, `_schedules/`, `vulnerabilities.json`, or `YYYY-MM-DD/scan-*` directories) are detected in `$CWD` and `INTELLIRECON_DATA_DIR` is unset. IntelliRecon never reads, copies, or deletes those legacy files automatically; the warning is informational and only fires once per process.

### New environment variable

| Variable                     | Default                       | Description                                                                                              |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `INTELLIRECON_LLM_MAX_INFLIGHT`  | `4 × EffectiveMaxInstances`   | Caps simultaneous outbound LLM calls across all running scans. Minimum `1`. Cancelled waiters do not consume a slot. |

### New health endpoint counters

`GET /api/status` now exposes:

| Field                 | Meaning                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| `panics_recovered`    | Goroutine, HTTP handler, and tool panics that were recovered without crashing.       |
| `path_rejections`     | Filesystem writes refused by Path_Policy (outside `data_dir` / `~/.intellirecon/` / `/tmp`). |
| `watchdog_kills`      | Subprocesses terminated by the per-tool hard-timeout watchdog.                       |
| `admission_refusals`  | Scan admission requests denied due to the concurrency ceiling.                       |
| `llm_inflight_cap`    | Effective `INTELLIRECON_LLM_MAX_INFLIGHT` value for this process.                        |
| `data_dir`            | Resolved Data_Dir in use.                                                            |
| `allow_list`          | Filesystem roots accepted by Path_Policy.                                            |

## Running

### Web UI

```bash
intellirecon --web
```

Open:

```text
http://127.0.0.1:9137
```

Use a different port:

```bash
intellirecon --web --port 8080
```

### External Access

Bind to another interface only after enabling dashboard authentication:

```bash
INTELLIRECON_USERNAME=admin INTELLIRECON_PASSWORD=change-this intellirecon --web --bind 0.0.0.0
```

> [!WARNING]
> The server refuses external binding without dashboard authentication.

### CLI Scan

```bash
intellirecon --target https://example.com
```

With custom instructions:

```bash
intellirecon --target https://app.example.com --instruction "Focus on SQL injection, IDOR, and auth bypass. Avoid destructive tests."
```

## Service Mode

Install and start as a system service:

```bash
sudo intellirecon --start
```

Manage the service:

```bash
sudo intellirecon --restart
sudo intellirecon --stop
sudo intellirecon --uninstall
```

View logs:

```bash
journalctl -u intellirecon -f
```

### Remote Service Access

Expose the service to remote browsers only after enabling dashboard auth:

```bash
sudo tee -a /root/.intellirecon.env >/dev/null <<'EOF'
INTELLIRECON_BIND=0.0.0.0
INTELLIRECON_USERNAME=admin
INTELLIRECON_PASSWORD=change-this
EOF

sudo intellirecon --restart
```

Then open `http://<server-ip>:9137`.

If the process is listening but the page still does not load remotely, allow TCP port `9137` in the server firewall or cloud security group.

## Web UI Workflow

1. Open the dashboard at `http://127.0.0.1:9137`.
2. Go to Settings and confirm the LLM provider, API key, rate limits, and optional integrations.
3. Create a scan from New Scan.
4. Choose a scan mode.
5. Select methodology phases when you want a focused run.
6. Set severity filters when only certain severities should be reported live. The filter affects the real-time dashboard feed and notifications only; the PDF report and `/api/findings` always include every vulnerability the agent discovered.
7. Add company name and upload a logo for branded reports.
8. Monitor progress from Overview, Scan Detail, or Live Feed.
9. Open finding details, download reports, or manage historical scans from Scans and Reports.

## Scan Modes

| Mode             | Best for                                                                        |
| ---------------- | ------------------------------------------------------------------------------- |
| Single target    | Testing one known URL or host.                                                  |
| Wildcard / multi | Enumerating related targets and scanning the discovered attack surface.         |
| DAST             | Browser-assisted testing for web apps, auth flows, forms, and runtime behavior. |

## Scan Your Code (no target needed)

Point IntelliRecon at a codebase — a Git URL, a local path, or an uploaded zip — and
it scans the source directly. No deployed URL, no infrastructure to stand up.

```bash
# Source review (SAST): audit the code, no running target required
intellirecon --source ./my-app --code-scan review

# Provision + DAST: build & run the app locally, then pentest the running instance
intellirecon --source https://github.com/org/app.git --code-scan provision
```

| Code-scan mode | What it does | Verification level |
| -------------- | ------------ | ------------------ |
| `review` | Reads the source, traces user input from entry point → dangerous sink, and reports reachable vulnerabilities. No live target. | **Source-verified** — proven reachable in code (clearly labeled as not runtime-exploited). |
| `provision` | Inspects the repo, builds and runs the app on a loopback port, then runs whitebox-guided DAST against the running instance. Falls back to `review` if the app can't be built. | **Exploit-verified** — reproduced against the running app. |

- `--source` accepts a Git URL (shallow-cloned), a local directory, or a path to
  an uploaded/extracted archive. In the Web UI / hosted app you can also upload a
  `.zip` of your codebase (`POST /api/upload-source`).
- You can still combine a repo **and** a live target for classic whitebox
  augmentation — that path is unchanged. Code-scan modes are for when the
  codebase is the whole subject.

> Provision mode runs your app's build/start commands in the agent's sandbox and
> only pentests the single loopback port it stood the app up on — the dashboard
> and everything else on the machine stay out of scope.

## Methodology

IntelliRecon organizes autonomous testing into 22 phases.

| Phase | Focus                                      |
| ----: | ------------------------------------------ |
|     1 | Reconnaissance                             |
|     2 | Manual vulnerability discovery             |
|     3 | Directory and file discovery               |
|     4 | CORS and cookie analysis                   |
|     5 | Authentication and session testing         |
|     6 | Injection testing                          |
|     7 | SSRF testing                               |
|     8 | IDOR and broken access control             |
|     9 | API and GraphQL testing                    |
|    10 | File upload testing                        |
|    11 | Deserialization and RCE                    |
|    12 | Race conditions and business logic         |
|    13 | Subdomain takeover                         |
|    14 | Open redirect testing                      |
|    15 | Email security testing                     |
|    16 | Cloud and infrastructure                   |
|    17 | WebSocket testing                          |
|    18 | CMS-specific testing                       |
|    19 | Broken link hijacking and content spoofing |
|    20 | Exploit verification                       |
|    21 | Novel vulnerability discovery              |
|    22 | Final report                               |

Phase selection in the Web UI lets you run every phase or only the subset needed for a specific engagement.

## Reports

Reports are generated as PDF files and can include:

| Section     | Included content                                                                |
| ----------- | ------------------------------------------------------------------------------- |
| Summary     | Executive summary, target metadata, scan metadata, and severity overview.       |
| Findings    | Verified findings, CVSS details, technical analysis, and exploitation proof.    |
| Evidence    | Proof of concept commands, scripts, payload notes, and supporting observations. |
| Remediation | Fix guidance and prioritized next steps.                                        |
| Branding    | Company/target name and uploaded logo.                                          |

Reports are available from the scan detail page and the Reports page. Report rows support opening, downloading, and deletion.

## Settings

Most operational settings can be changed from the Web UI under Settings.

| Area          | Examples                                                            |
| ------------- | ------------------------------------------------------------------- |
| Engagement    | Dashboard request rate limits                                       |
| LLM           | Model, API key, API base, reasoning effort, retries, max iterations |
| AgentMail     | Pod and API key                                                     |
| Notifications | Discord webhook and minimum severity, Telegram bot token, chat ID, and minimum severity |
| Proxy         | Proxy URL, proxy file, rotation, TLS verification                   |
| Runtime       | Workspace, browser path, auto-install controls                      |
| Security      | Dashboard username, password, password hash, bind address           |
| Resources     | CPU/RAM/disk thresholds and scan concurrency budget                 |

Some settings require a restart because they affect process startup or server binding. The UI marks those fields.

## Environment Variables

### Core

| Variable                             | Default          | Description                                            |
| ------------------------------------ | ---------------- | ------------------------------------------------------ |
| `INTELLIRECON_LLM`                       | none             | Required model name, usually with provider prefix.     |
| `INTELLIRECON_API_KEY`                   | none             | Required LLM provider API key.                         |
| `INTELLIRECON_API_BASE`                  | provider default | Custom OpenAI-compatible API base URL.                 |
| `INTELLIRECON_REASONING_EFFORT`          | `high`           | Reasoning effort: `low`, `medium`, `high`, or `xhigh`. |
| `INTELLIRECON_LLM_MAX_RETRIES`           | `5`              | Retry count for transient LLM failures.                |
| `INTELLIRECON_MEMORY_COMPRESSOR_TIMEOUT` | `30`             | Timeout in seconds for context compression.            |
| `INTELLIRECON_MAX_ITERATIONS`            | `0`              | Agent iteration cap. `0` means unlimited.              |
| `GEMINI_API_KEY`                     | none             | Optional Gemini key for web-search enrichment.         |

### Web and Security

| Variable                 | Default           | Description                        |
| ------------------------ | ----------------- | ---------------------------------- |
| `INTELLIRECON_BIND`          | `127.0.0.1`       | Web server listen address.         |
| `INTELLIRECON_USERNAME`      | none              | Dashboard username.                |
| `INTELLIRECON_PASSWORD`      | none              | Dashboard password.                |
| `INTELLIRECON_PASSWORD_HASH` | none              | Preferred bcrypt password hash.    |
| `INTELLIRECON_WORKSPACE`     | current directory | Workspace root for scan execution. |

### Integrations

| Variable                        | Default | Description                              |
| ------------------------------- | ------- | ---------------------------------------- |
| `AGENTMAIL_POD`                 | none    | AgentMail pod identifier.                |
| `AGENTMAIL_API_KEY`             | none    | AgentMail API key.                       |
| `INTELLIRECON_DISCORD_WEBHOOK`      | none    | Global Discord webhook.                  |
| `INTELLIRECON_DISCORD_MIN_SEVERITY` | none    | Minimum severity sent to Discord.        |
| `INTELLIRECON_TELEGRAM_BOT_TOKEN`   | none    | Telegram bot token from @BotFather.      |
| `INTELLIRECON_TELEGRAM_CHAT_ID`      | none    | Telegram chat/channel ID (numeric or @username). |
| `INTELLIRECON_TELEGRAM_MIN_SEVERITY`| none    | Minimum severity sent to Telegram.      |
| `CAIDO_PORT`                    | `0`     | Caido proxy port. `0` means auto-detect. |
| `CAIDO_API_TOKEN`               | none    | Caido API token.                         |

### Rate Limits, Proxy, and Runtime

| Variable                       | Default      | Description                                        |
| ------------------------------ | ------------ | -------------------------------------------------- |
| `INTELLIRECON_RATE_LIMIT_REQUESTS` | `60`         | Dashboard requests per window.                     |
| `INTELLIRECON_RATE_LIMIT_WINDOW`   | `60`         | Dashboard rate-limit window in seconds.            |
| `INTELLIRECON_RATE_RPS`            | `10`         | Sustained outbound request rate.                   |
| `INTELLIRECON_RATE_BURST`          | `20`         | Outbound burst size.                               |
| `INTELLIRECON_USE_PROXY`           | `false`      | Enable proxy routing.                              |
| `INTELLIRECON_PROXY_URL`           | none         | Single proxy URL. Overrides proxy file.            |
| `INTELLIRECON_PROXY_FILE`          | none         | File containing one proxy per line.                |
| `INTELLIRECON_PROXY_ROTATION`      | `roundrobin` | Proxy rotation strategy: `roundrobin` or `random`. |
| `INTELLIRECON_TLS_SKIP_VERIFY`     | `false`      | Skip TLS verification for testing traffic.         |
| `INTELLIRECON_DISABLE_BROWSER`     | `false`      | Disable browser automation.                        |
| `INTELLIRECON_BROWSER_PATH`        | auto         | Custom Chrome/Chromium executable path.            |
| `INTELLIRECON_ALLOW_AUTO_INSTALL`  | root only    | Permit automatic package installation.             |
| `INTELLIRECON_AUTO_INSTALL_SUDO`   | `false`      | Permit sudo-prefixed auto-installs.                |

## Provider Prefixes

When `INTELLIRECON_API_BASE` is empty, IntelliRecon infers provider defaults from the model prefix.

| Prefix       | Default API base                               |
| ------------ | ---------------------------------------------- |
| `openai/`    | `https://api.openai.com/v1`                    |
| `anthropic/` | `https://api.anthropic.com`                    |
| `deepseek/`  | `https://api.deepseek.com/v1`                  |
| `groq/`      | `https://api.groq.com/openai/v1`               |
| `google/`    | `https://generativelanguage.googleapis.com/v1` |
| `gemini/`    | `https://generativelanguage.googleapis.com/v1` |
| `ollama/`    | `http://localhost:11434/v1`                    |
| `minimax/`   | `https://api.minimax.io/v1`                    |

Model names are not hard-coded to this list. The Settings page accepts typed model IDs so newer provider models can be used without waiting for a UI dropdown update.

## CLI Reference

| Flag                   | Alias | Description                                |
| ---------------------- | ----- | ------------------------------------------ |
| `--web`                | `-w`  | Start the Web UI.                          |
| `--port <port>`        | `-p`  | Web UI port. Default: `9137`.              |
| `--bind <addr>`        | none  | Bind address. Default: `127.0.0.1`.        |
| `--target <target>`    | `-t`  | Target URL, host, IP, or path. Repeatable. |
| `--instruction <text>` | `-i`  | Custom scan instructions.                  |
| `--model <model>`      | `-m`  | Override `INTELLIRECON_LLM` for this run.      |
| `--update`             | `-up` | Update to the latest release.              |
| `--version`            | `-v`  | Print version.                             |
| `--start`              | none  | Install and start the system service.      |
| `--stop`               | none  | Stop the system service.                   |
| `--restart`            | none  | Restart the system service.                |
| `--uninstall`          | none  | Remove the system service.                 |
| `--help`               | `-h`  | Show help.                                 |

## API Summary

| Method   | Endpoint                     | Purpose                                       |
| -------- | ---------------------------- | --------------------------------------------- |
| `POST`   | `/api/scan`                  | Start or save a scan.                         |
| `POST`   | `/api/stop`                  | Stop all running scans.                       |
| `GET`    | `/api/status`                | Current global status.                        |
| `GET`    | `/api/scans`                 | List scans.                                   |
| `GET`    | `/api/scans/:id`             | Get scan detail.                              |
| `DELETE` | `/api/scans/:id`             | Delete a scan and its report data.            |
| `GET`    | `/api/findings`              | List all findings (deduplicated across scans). |
| `GET`    | `/api/findings/summary`      | Severity tally across all scans.             |
| `GET`    | `/api/report/:id`            | Download a PDF report.                        |
| `GET`    | `/api/instances`             | List live and historical instances.           |
| `GET`    | `/api/instances/:id/events`  | Get buffered event history.                   |
| `POST`   | `/api/instances/:id/stop`    | Stop a specific instance.                     |
| `POST`   | `/api/instances/:id/start`   | Start a saved or completed scan as a new run. |
| `POST`   | `/api/instances/:id/restart` | Restart with the same configuration.          |
| `POST`   | `/api/instances/:id/pause`   | Pause a running scan.                         |
| `POST`   | `/api/instances/:id/resume`  | Resume a paused scan.                         |
| `POST`   | `/api/upload-logo`           | Upload a report logo.                         |
| `POST`   | `/api/upload-targets`        | Upload a target list.                         |
| `GET`    | `/api/settings/environment`  | List editable environment settings.           |
| `POST`   | `/api/settings/environment`  | Save environment settings.                    |
| `GET`    | `/api/settings/llm`          | Get LLM settings.                             |
| `POST`   | `/api/settings/llm`          | Save LLM settings.                            |
| `GET`    | `/api/settings/agentmail`    | Get AgentMail settings.                       |
| `POST`   | `/api/settings/agentmail`    | Save AgentMail settings.                      |
| `GET`    | `/ws`                        | WebSocket live event stream.                  |

## Data Storage

Web-mode scan data is stored under:

```text
~/intellirecon-data/
|-- _saved/
|-- logos/
|-- queue_state.json
`-- <target>/
    `-- <date>/
        `-- <scan-id>/
            |-- scan.json
            `-- report.pdf
```

The server keeps historical scan records on disk so the UI can recover after refresh or restart.

## Development

| Task                        | Command                       |
| --------------------------- | ----------------------------- |
| Install Web UI dependencies | `make webui-install`          |
| Build everything            | `make build`                  |
| Run tests                   | `go test ./...`               |
| Run Web UI from source      | `go run ./cmd/intellirecon --web` |
| Run frontend dev server     | `make webui-dev`              |

## Safety Notes

- Use IntelliRecon only against authorized targets.
- Do not run active testing against third-party systems without permission.
- Review scan instructions before launching.
- Configure rate limits and proxy settings to match engagement rules.
- Exposing the dashboard externally requires authentication.
- Auto-install is disabled by default for non-root users and should be enabled only when you trust the environment.

## License

IntelliRecon is released under the MIT License.

## Links

| Resource      | Link                                                                             |
| ------------- | -------------------------------------------------------------------------------- |
| Hosted (Cloud) | [www.intellirecon.com](https://www.intellirecon.com/)                                   |
| Documentation | [docs.intellirecon.com](https://docs.intellirecon.com)                                   |
| Issues        | [github.com/intellirecon/intellirecon/issues](https://github.com/intellirecon/intellirecon/issues) |
| Support       | [buymeacoffee.com/intellirecon](https://buymeacoffee.com/intellirecon)                     |
