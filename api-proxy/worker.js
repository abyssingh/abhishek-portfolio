// Cloudflare Worker — Groq API Proxy for "Ask Abhishek"
// Deploy this at: https://dash.cloudflare.com → Workers & Pages → Create
// Set the environment variable GROQ_API_KEY in the Worker settings
//
// Security hardening (v1.1.0):
//   - Request body size limit (50 KB)
//   - Message count cap (12 messages max)
//   - Per-message content length cap (1000 chars)
//   - Security headers (nosniff)
//
// Langfuse observability (v1.2.0):
//   - Traces every chat request to Langfuse for monitoring & evals
//   - Logs user question, AI answer, model, token usage, latency
//   - Runs in background via ctx.waitUntil() — zero impact on response time
//   - Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY as Worker secrets

const ALLOWED_ORIGINS = [
    'https://abyssingh.github.io',  // GitHub Pages (production)
    'http://localhost',              // Local dev
    'http://127.0.0.1'              // Local dev alt
];

// Only allow these models — prevents abuse via expensive/large models
const ALLOWED_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

const RATE_LIMIT_MAP = new Map(); // IP -> { count, resetTime }
const MAX_REQUESTS_PER_MINUTE = 10;

// Security limits
const MAX_BODY_SIZE_BYTES = 50 * 1024; // 50 KB
const MAX_MESSAGES = 12;               // system + 5 exchanges + current user msg
const MAX_MESSAGE_LENGTH = 1000;       // per-message content char limit

export default {
    async fetch(request, env, ctx) {
        // --- CORS Preflight ---
        if (request.method === 'OPTIONS') {
            return handleCORS(request);
        }

        // --- Only POST allowed ---
        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        // --- Origin check ---
        const origin = request.headers.get('Origin') || '';
        const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
        if (!isAllowed) {
            return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
                status: 403,
                headers: secureHeaders(origin)
            });
        }

        // --- Request body size limit (anti-DDoS) ---
        const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
        if (contentLength > MAX_BODY_SIZE_BYTES) {
            return new Response(JSON.stringify({ error: 'Request too large' }), {
                status: 413,
                headers: secureHeaders(origin)
            });
        }

        // --- Rate limiting by IP ---
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const now = Date.now();
        const rateData = RATE_LIMIT_MAP.get(ip) || { count: 0, resetTime: now + 60000 };

        if (now > rateData.resetTime) {
            rateData.count = 0;
            rateData.resetTime = now + 60000;
        }

        rateData.count++;
        RATE_LIMIT_MAP.set(ip, rateData);

        if (rateData.count > MAX_REQUESTS_PER_MINUTE) {
            return new Response(JSON.stringify({
                error: 'Rate limit exceeded. Please try again in a minute.'
            }), {
                status: 429,
                headers: secureHeaders(origin)
            });
        }

        // --- Proxy to Groq ---
        try {
            // Double-check body size by reading the raw text first
            const rawBody = await request.text();
            if (rawBody.length > MAX_BODY_SIZE_BYTES) {
                return new Response(JSON.stringify({ error: 'Request too large' }), {
                    status: 413,
                    headers: secureHeaders(origin)
                });
            }

            const body = JSON.parse(rawBody);

            // Validate: only allow chat completions
            if (!body.messages || !Array.isArray(body.messages)) {
                return new Response(JSON.stringify({ error: 'Invalid request' }), {
                    status: 400,
                    headers: secureHeaders(origin)
                });
            }

            // --- Message count cap (anti-context-stuffing) ---
            if (body.messages.length > MAX_MESSAGES) {
                body.messages = [
                    body.messages[0],                           // keep system prompt
                    ...body.messages.slice(-(MAX_MESSAGES - 1)) // keep most recent messages
                ];
            }

            // --- Per-message content length cap ---
            body.messages = body.messages.map(msg => ({
                role: msg.role,
                content: typeof msg.content === 'string'
                    ? msg.content.slice(0, MAX_MESSAGE_LENGTH)
                    : ''
            }));

            // Cap max_tokens to prevent abuse
            body.max_tokens = Math.min(body.max_tokens || 512, 1024);

            // Enforce model whitelist
            const model = ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0];

            const startTime = new Date().toISOString();

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.GROQ_API_KEY}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: body.messages,
                    temperature: body.temperature || 0.3,
                    max_tokens: body.max_tokens
                })
            });

            const data = await groqResponse.text();

            // --- Langfuse observability (background, non-blocking) ---
            if (env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY) {
                ctx.waitUntil(
                    logToLangfuse(env, ip, model, body.messages, data, startTime)
                );
            }

            return new Response(data, {
                status: groqResponse.status,
                headers: secureHeaders(origin)
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: 'Proxy error' }), {
                status: 500,
                headers: secureHeaders(origin)
            });
        }
    }
};

// Shared response headers with security additions
function secureHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff'
    };
}

function handleCORS(request) {
    const origin = request.headers.get('Origin') || '';
    const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
    if (!isAllowed) {
        return new Response(null, { status: 403 });
    }
    return new Response(null, {
        status: 204,
        headers: secureHeaders(origin)
    });
}

// ================================================
// LANGFUSE OBSERVABILITY
// Sends trace + generation data to Langfuse REST API
// Runs in background via ctx.waitUntil() — never blocks the response
// ================================================
async function logToLangfuse(env, userIp, model, messages, responseData, startTime) {
    try {
        let parsed = {};
        try { parsed = JSON.parse(responseData); } catch (e) { /* non-JSON response */ }

        const endTime = new Date().toISOString();
        const traceId = crypto.randomUUID();
        const generationId = crypto.randomUUID();

        // Extract the user's actual question (last user message, skipping system prompt)
        const userMessages = messages.filter(m => m.role === 'user');
        const userQuestion = userMessages.length > 0
            ? userMessages[userMessages.length - 1].content
            : '(no user message)';

        // Extract the AI's answer
        const aiAnswer = parsed?.choices?.[0]?.message?.content || '(no response parsed)';

        // Langfuse Basic Auth: public_key:secret_key
        const authHeader = 'Basic ' + btoa(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`);
        const langfuseHost = env.LANGFUSE_HOST || 'https://cloud.langfuse.com';

        const ingestionBody = {
            batch: [
                // 1. Create a Trace (groups the entire interaction)
                {
                    id: crypto.randomUUID(),
                    type: 'trace-create',
                    timestamp: startTime,
                    body: {
                        id: traceId,
                        name: 'ask-abhishek-chat',
                        input: userQuestion,
                        output: aiAnswer,
                        userId: userIp,
                        metadata: {
                            origin: 'cloudflare-worker',
                            model: model
                        },
                        tags: ['portfolio', 'v1.2']
                    }
                },
                // 2. Create a Generation (LLM call details)
                {
                    id: crypto.randomUUID(),
                    type: 'generation-create',
                    timestamp: startTime,
                    body: {
                        id: generationId,
                        traceId: traceId,
                        name: 'groq-chat-completion',
                        startTime: startTime,
                        endTime: endTime,
                        model: model,
                        modelParameters: {
                            temperature: 0.3,
                            maxTokens: 1024
                        },
                        input: messages,
                        output: aiAnswer,
                        usage: {
                            promptTokens: parsed?.usage?.prompt_tokens || 0,
                            completionTokens: parsed?.usage?.completion_tokens || 0,
                            totalTokens: parsed?.usage?.total_tokens || 0
                        }
                    }
                }
            ]
        };

        await fetch(`${langfuseHost}/api/public/ingestion`, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(ingestionBody)
        });
    } catch (err) {
        // Silently fail — observability should never break the user experience
        console.error('[Langfuse] Logging failed:', err.message);
    }
}
