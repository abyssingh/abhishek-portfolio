# API Proxy Deployment Guide

## Why a Proxy?
API keys **cannot** live in client-side JavaScript — anyone can open DevTools and steal them. This Cloudflare Worker acts as a secure middleman.

```
Browser → Cloudflare Worker (has API keys) → Groq/OpenAI speech APIs
```

## Security Layers
| Layer | Protection |
|---|---|
| **Origin whitelist** | Only your portfolio domain can call the proxy |
| **IP rate limiting** | 10 requests/min per visitor (server-side) |
| **Client rate limiting** | 10 requests/min per session (client-side) |
| **max_tokens cap** | Capped at 1024 to prevent abuse |
| **Request validation** | Only valid chat completion requests accepted |

## Deployment Steps (5 minutes, no CLI needed)

### 1. Create a Cloudflare Account
Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Sign up (free)

### 2. Create a Worker
1. In the dashboard, click **Workers & Pages** → **Create**
2. Name it `ask-abhishek-proxy`
3. Click **Deploy** (deploys the default Hello World)
4. Click **Edit Code**
5. Delete the default code and paste the contents of `api-proxy/worker.js`
6. Click **Deploy**

### 3. Add API Keys as Secrets
1. Go to **Workers & Pages** → `ask-abhishek-proxy` → **Settings** → **Variables and Secrets**
2. Click **Add** → Type: **Secret**
3. Name: `GROQ_API_KEY`
4. Value: *(paste your Groq API key here — used only for the base chat LLM)*
5. Add another secret named `OPENAI_API_KEY`
6. Value: *(paste your OpenAI API key here — used for STT and TTS by default)*

### Configure Speech Providers

The context-aware Voice Guide uses OpenAI Realtime WebRTC for the primary handsfree voice experience. The older STT/TTS routes remain available as fallbacks/debug routes. The base chat LLM remains Groq unless changed separately in code.

Default realtime voice config:

- `REALTIME_MODEL`: `gpt-realtime-2`
- `REALTIME_VOICE`: `marin`
- `REALTIME_TRANSCRIPTION_MODEL`: `gpt-4o-mini-transcribe`
- `REALTIME_TRANSCRIPTION_PROMPT`: optional Hindi/Hinglish/domain vocabulary hint
- `REALTIME_VAD_THRESHOLD`: optional, defaults to `0.5`
- `REALTIME_VAD_SILENCE_MS`: optional, defaults to `520`

Default speech config:

- `STT_PROVIDER`: `openai`
- `STT_MODEL`: `gpt-4o-mini-transcribe`
- `TTS_PROVIDER`: `openai`
- `TTS_MODEL`: `gpt-4o-mini-tts`
- `TTS_VOICE`: `alloy`

Optional overrides:

- `STT_PROVIDER`: `openai`, `openai-compatible`, or `groq`
- `STT_MODEL`: any supported model for the selected STT provider
- `STT_API_KEY`: optional provider-specific STT key
- `STT_API_BASE_URL`: optional OpenAI-compatible STT base URL
- `TTS_PROVIDER`: `openai`, `openai-compatible`, or `elevenlabs`
- `TTS_MODEL`: any supported model for the selected TTS provider
- `TTS_VOICE`: provider-supported TTS voice
- `TTS_API_KEY`: optional provider-specific TTS key
- `TTS_API_BASE_URL`: optional OpenAI-compatible TTS base URL
- `OPENAI_API_BASE_URL`: optional shared OpenAI-compatible base URL

Provider-specific optional secrets:

- `ELEVENLABS_API_KEY`: only needed if `TTS_PROVIDER=elevenlabs`
- `ELEVENLABS_VOICE_ID`: legacy alias for ElevenLabs voice override
- `ELEVENLABS_TTS_MODEL`: legacy alias for ElevenLabs model override

If OpenAI TTS fails or is not configured, the website can still fall back to browser text-to-speech when available.
7. Click **Save**

### Realtime Voice Route

The live handsfree assistant uses this Worker route:

```txt
POST /voice/realtime/session
```

The browser sends its WebRTC SDP offer and screen/portfolio context to the Worker. The Worker keeps `OPENAI_API_KEY` private, calls OpenAI Realtime, and returns the SDP answer to the browser.

### Langfuse Observability

Add these Worker secrets if you want full traces:

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_HOST`: optional, defaults to `https://cloud.langfuse.com`

Realtime voice creates one trace per live session and appends async events for session setup, speech start/stop, transcription, response start, assistant transcript, response completion, detected language, current section, prompt name/version, and timing metadata. These logs are fire-and-forget and do not block the live voice response path.

### 4. Get Your Worker URL
Your worker URL will be: `https://ask-abhishek-proxy.YOUR-SUBDOMAIN.workers.dev`
(The subdomain is chosen during Cloudflare signup)

### 5. Update index.html
Open `index.html` and set the proxy URL:
```javascript
const PROXY_URL = 'https://ask-abhishek-proxy.YOUR-SUBDOMAIN.workers.dev';
```

### 6. Update Origin Whitelist (if needed)
In `worker.js`, update `ALLOWED_ORIGINS` to include your actual deployment domain.

## Free Tier Limits
- **Cloudflare Workers Free**: 100,000 requests/day — way more than enough
- **Groq Free**: 14,400 requests/day
- **OpenAI**: STT/TTS billed against your OpenAI account credits
