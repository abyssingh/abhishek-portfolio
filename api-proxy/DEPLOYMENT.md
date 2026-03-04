# API Proxy Deployment Guide

## Why a Proxy?
The Groq API key **cannot** live in client-side JavaScript — anyone can open DevTools and steal it. This Cloudflare Worker acts as a secure middleman.

```
Browser → Cloudflare Worker (has API key) → Groq API
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

### 3. Add the API Key as a Secret
1. Go to **Workers & Pages** → `ask-abhishek-proxy` → **Settings** → **Variables and Secrets**
2. Click **Add** → Type: **Secret**
3. Name: `GROQ_API_KEY`
4. Value: *(paste your Groq API key here — never commit this value to code)*
5. Click **Save**

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
