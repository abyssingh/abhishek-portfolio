# Architecture Decision Record (ADR)

A living document tracking all architecture decisions, their reasoning, and impact on the Ask Abhishek portfolio project.

---

## ADR-001: Move System Prompt from Client to Server via Langfuse Prompt Management

**Date:** 2026-04-08  
**Status:** ✅ Implemented  
**Impact:** High — changes the prompt lifecycle, security model, and deployment workflow  

### Context

The "Ask Abhishek" AI assistant uses a system prompt to instruct the LLM on how to respond. Previously, this prompt was **hardcoded in `index.html`** (client-side JavaScript) and sent as part of the messages array to the Cloudflare Worker, which simply proxied it to Groq.

### Problem

1. **Security:** The system prompt (including security rules, response instructions, and knowledge context) was visible in browser DevTools → Sources. Anyone could read it, understand the guardrails, and craft targeted prompt injection attacks.
2. **Deployment friction:** Every prompt change required a code edit → git push → GitHub Pages deploy cycle.
3. **No versioning:** No history of prompt changes, no way to A/B test, no way to roll back.
4. **No experimentation:** Couldn't test prompt variants against a golden dataset before deploying.

### Decision

Move the system prompt to **Langfuse Prompt Management** and fetch it at runtime in the **Cloudflare Worker** (server-side). The client never sees the prompt.

### Architecture Before

```
Browser (index.html)                    Cloudflare Worker              Groq
┌──────────────────┐                   ┌──────────────────┐          ┌──────┐
│ 1. Fetch knowledge│                   │                  │          │      │
│ 2. Build system   │  { messages[] }   │ 3. Validate      │  POST    │      │
│    prompt         │ ─────────────────►│ 4. Proxy to Groq │────────►│      │
│ 3. Build messages │                   │ 5. Sanitize      │          │      │
│    array          │ ◄─────────────────│ 6. Log to        │◄────────│      │
│                   │    AI response    │    Langfuse       │          │      │
└──────────────────┘                   └──────────────────┘          └──────┘

Problem: System prompt visible in browser source code
```

### Architecture After

```
Browser (index.html)                    Cloudflare Worker              Groq       Langfuse
┌──────────────────┐                   ┌──────────────────┐          ┌──────┐   ┌──────────┐
│ 1. Fetch knowledge│                   │                  │          │      │   │          │
│ 2. Retrieve       │  { userMessage,   │ 3. Validate      │          │      │   │          │
│    relevant       │    context,       │ 4. Fetch prompt  │──GET────►│      │   │  Prompt  │
│    context        │    history[] }    │    from Langfuse  │◄─────────│      │   │  Mgmt    │
│                   │ ─────────────────►│ 5. Build messages│          │      │   │          │
│                   │                   │ 6. Call Groq     │──POST───►│      │   └──────────┘
│                   │ ◄─────────────────│ 7. Sanitize      │◄─────────│      │
│                   │    AI response    │ 8. Log to        │          │      │
│                   │                   │    Langfuse       │          │      │
└──────────────────┘                   └──────────────────┘          └──────┘

Win: System prompt is NEVER in browser code
```

### Options Considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. Keep client-side prompt** | Status quo | Simple, no infra change | Insecure, no versioning, deployment friction |
| **B. Hardcode prompt in worker** | Move prompt to worker.js | Server-side (secure) | Still requires code deploy for changes |
| **C. Langfuse Prompt Management** ✅ | Worker fetches prompt from Langfuse at runtime | Secure, versioned, A/B testable, no-deploy updates | Adds Langfuse API dependency, slight latency |
| **D. Environment variable** | Store prompt as Worker env var | Server-side, simple | No versioning, painful to edit large prompts |

### Why Option C

- **Security:** Prompt never leaves server-side
- **Velocity:** Edit prompt in Langfuse UI → instantly live (no git push needed)
- **Versioning:** Every change creates a new version; easy to roll back
- **Experimentation:** Test prompt variants against golden dataset before promoting to production
- **Observability:** Prompt version is linked to every trace for debugging
- **Already integrated:** We already have Langfuse for tracing; this extends the investment

### Trade-offs Accepted

- **Langfuse dependency:** If Langfuse is down, the worker falls back to a built-in default prompt. Not a single point of failure.
- **Latency:** Prompt is cached in worker memory for 5 minutes. First request per isolate adds ~100–200ms; all subsequent requests use cache.
- **Knowledge context still client-side:** The knowledge base files (`resume.md`, `products.md`, etc.) are public data on GitHub. They're fetched by the browser and sent as `context` to the worker. This is by design — the knowledge is not sensitive (it's literally on the public website). Only the *instructions* (prompt) are sensitive.

### Implementation Details

**Files changed:**
- `api-proxy/worker.js` — Added `fetchLangfusePrompt()` with 5-min cache, new request format handler, server-side message assembly
- `index.html` — Removed hardcoded system prompt, client now sends `{ userMessage, context, conversationHistory }` instead of `{ messages }`
- `CHANGELOG.md` — Updated with v1.3.0 entry

**New Worker secrets required:**
- `LANGFUSE_PUBLIC_KEY` (already set)
- `LANGFUSE_SECRET_KEY` (already set)
- `LANGFUSE_HOST` (optional, defaults to `https://cloud.langfuse.com`)

**Backwards compatibility:**
- Worker auto-detects old format (`body.messages`) vs new format (`body.userMessage`) during rollout
- Old clients continue working until index.html is updated on GitHub Pages

**Fallback behavior:**
- If Langfuse prompt fetch fails → uses a built-in default prompt hardcoded in the worker
- If Langfuse is slow → cached prompt served from memory (5-min TTL)

### Prompt Lifecycle (New Workflow)

```
1. Edit prompt in Langfuse UI
   ↓
2. Test with Langfuse Playground / Experiments
   ↓
3. Label version as "production"
   ↓
4. Worker automatically picks up new prompt (within 5-min cache TTL)
   ↓
5. No code deploy needed!
```

### Success Metrics

- System prompt no longer visible in browser source → verified
- Prompt changes deployable without git push → verified
- No latency regression on cached path → p99 < 50ms overhead
- Langfuse traces linked to prompt version → verified in dashboard

---

*Future ADRs will be added below as new architecture decisions are made.*
