# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.3.0] - 2026-04-08

### Changed — Architecture: Server-Side Prompt via Langfuse
- **System prompt moved from client to server:** The full system prompt (instructions, security rules) is no longer hardcoded in `index.html`. It is now fetched at runtime by the Cloudflare Worker from **Langfuse Prompt Management**.
- **New client→worker API format:** Browser now sends `{ userMessage, context, conversationHistory }` instead of a pre-built `{ messages }` array. The worker assembles the full messages array server-side.
- **Prompt caching:** Worker caches the Langfuse prompt in memory for 5 minutes to avoid per-request latency.
- **Graceful fallback:** If Langfuse is unavailable, the worker uses a built-in default prompt (cached for 30s before retrying).
- **Backwards compatible:** Worker auto-detects old (v1.2) vs new (v1.3) request format, so the rollout is safe even if client and worker deploy at different times.

### Added
- **ARCHITECTURE.md:** New Architecture Decision Record (ADR) documenting all major design decisions with reasoning, options analysis, trade-offs, and impact assessments.
- **Prompt version tracing:** Every Langfuse trace now includes `promptName` and `promptVersion` metadata, linking each AI response to the exact prompt version that generated it.

### Security
- **Prompt instructions no longer visible in browser source code.** Previously, anyone could open DevTools → Sources and read the full system prompt. Now only the knowledge context (public data from the portfolio) is visible client-side.

### Impact
- Prompt changes no longer require code deploys — edit in Langfuse UI → label as "production" → live within 5 minutes
- Full version history of all prompt changes in Langfuse
- Can A/B test prompt variants via Langfuse Experiments before promoting to production
- Zero latency regression on cached path

---

## [1.2.1] - 2026-04-08

### Security
- **Enhanced prompt injection defense:** Restructured system prompt — context wrapped in `<reference_data>` tags, security rules moved to end for recency bias, explicit keyword-based rejection rules
- **Server-side output sanitization:** Worker now scans AI responses for leaked prompt fragments (`CONTEXT:`, `reference_data`, `SECURITY RULES`, etc.) and replaces them with a safe response before they reach the user

---

## [1.2.0] - 2026-04-07

### Added
- **Langfuse observability:** Every chat request is now traced to Langfuse (question, answer, model, token usage, latency)
- **Background logging:** Uses `ctx.waitUntil()` so tracing never slows down user responses
- **Trace + Generation:** Each request creates a Langfuse Trace (session-level) and Generation (LLM call-level) with full metadata
- **Graceful degradation:** Logging silently skips if `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` are not configured

---

## [1.1.0] - 2026-03-12

### Security
- **Request body size limit:** Worker now rejects payloads > 50 KB (HTTP 413) to prevent payload abuse
- **Message count cap:** Server enforces max 12 messages per request to prevent context-stuffing attacks
- **Per-message length limit:** Individual message content truncated to 1000 characters server-side
- **Prompt injection defense:** System prompt now includes anti-jailbreak guardrails to prevent role manipulation, system prompt leaking, and off-topic code generation
- **Frontend input sanitization:** Chat input limited to 500 characters with HTML tag stripping before send
- **Security headers:** Added `X-Content-Type-Options: nosniff` to all Worker responses

### Added
- **CHANGELOG.md:** Created this file to track all project changes with timestamps and descriptions

---

## [1.0.0] - 2026-03-04

### Added
- Initial portfolio website with Hero, Products, Case Studies, and Contact sections
- "Ask Abhishek" AI chat assistant powered by Groq (Llama 3.3 70B)
- Cloudflare Worker API proxy (`api-proxy/worker.js`) with CORS, rate limiting, model whitelist, and token cap
- Knowledge base: `resume.md`, `case-studies.md`, `products.md`, `contact.md`
- Responsive design with mobile-optimized chat (full-screen on mobile)
- Starter question buttons for common visitor queries
- Markdown rendering in AI responses via Marked.js
