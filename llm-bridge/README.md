# llm-bridge

A local [LiteLLM](https://github.com/BerriAI/litellm) proxy that exposes an **Anthropic-compatible `/v1/messages` endpoint** backed by providers that don't natively speak that wire format — Groq, in this setup. `server/server.mjs` only ever talks to `ANTHROPIC_BASE_URL` via the Anthropic SDK; it has no idea the actual inference is happening on Groq. That's the point: the bridge is the only piece that knows.

## Why this exists

OpenRouter's free-tier models all share one account-wide 16-requests/minute quota — hit that, and *every* free OpenRouter model fails at once, regardless of which one you were calling. Groq is a completely separate account with its own quota (30 req/min, 14,400/day on the free tier, no credit card), so routing through it first gives the app a genuinely independent pool of free capacity instead of just another straw in the same cup.

## How it's wired

```
server.mjs  →  ANTHROPIC_BASE_URL (http://127.0.0.1:8471)  →  litellm proxy  →  Groq / OpenRouter
```

`config.yaml` defines a fallback chain LiteLLM manages itself (separate from the app's own `ANTHROPIC_FALLBACK_MODELS`, which is OpenRouter-specific and doesn't apply here):

1. `intellirecon-primary` — `groq/llama-3.3-70b-versatile` (Groq's own quota)
2. `intellirecon-fallback-1` — `groq/llama-3.1-8b-instant` (still Groq — covers one Groq model being throttled, not the whole account)
3. `intellirecon-fallback-2` / `-3` — OpenRouter free models (the pre-existing pool, as a last resort)

`npm run dev` starts the bridge automatically as a fourth `concurrently` process (`bridge`, alongside `web`/`api`/`engine`).

## Why these specific Groq models

Groq also hosts reasoning models (`openai/gpt-oss-*`, `qwen/qwen3*`) that emit `thinking` content blocks. **Don't use them here.** When the app's agent loop replays a full assistant turn back on the next round (`session.messages.push({ role: "assistant", content: final.content })` in `server.mjs`) — which happens on *every* multi-step tool call, i.e. almost every real task — Groq's API rejects the replayed `thinking_blocks` field with a 400:

```
'messages.1' : for 'role:assistant' the following must be satisfied
[('messages.1' : property 'thinking_blocks' is unsupported)]
```

`llama-3.3-70b-versatile` and `llama-3.1-8b-instant` don't do extended reasoning, so they never emit that block and the incompatibility never triggers. Confirmed by testing both the failing and working case directly — see `test_bridge_tools.mjs`.

## Setup

```bash
cd llm-bridge
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

Needs `GROQ_API_KEY`, `OPENROUTER_API_KEY`, and `LITELLM_MASTER_KEY` in the project root's `.env` — LiteLLM auto-loads `.env` from its working directory (which `npm run dev` sets to the project root), no manual export needed. Get a free Groq key at [console.groq.com](https://console.groq.com) → API Keys (no credit card). Don't confuse it with xAI/Grok (`console.x.ai`, keys start `xai-`, not a free tier) — different company, easy mix-up.

## Verifying it still works after a config change

```bash
./venv/bin/litellm --config config.yaml --port 8471 &
LITELLM_MASTER_KEY=<value from .env> node test_bridge_tools.mjs
```

Checks the full round trip: initial tool call → `tool_use` block → `tool_result` fed back → coherent final answer. This is the same failure mode (thinking-block replay) that broke silently the first time — if you change which Groq model is primary, rerun this before trusting it in the live app.

## Switching back to OpenRouter directly

Comment the active profile block in `.env` and uncomment the "OpenRouter directly" block below it — see the comments there. The bridge process still starts under `npm run dev` either way; it's just unused if `ANTHROPIC_BASE_URL` doesn't point at it.
