// Cloudflare Worker — Groq API Proxy for "Ask Abhishek"
// Deploy this at: https://dash.cloudflare.com → Workers & Pages → Create
// Set the environment variable GROQ_API_KEY in the Worker settings

const ALLOWED_ORIGINS = [
    'https://abyssingh.github.io',  // GitHub Pages (production)
    'http://localhost',              // Local dev
    'http://127.0.0.1'              // Local dev alt
];

// Only allow these models — prevents abuse via expensive/large models
const ALLOWED_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

const RATE_LIMIT_MAP = new Map(); // IP -> { count, resetTime }
const MAX_REQUESTS_PER_MINUTE = 10;

export default {
    async fetch(request, env) {
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
                headers: { 'Content-Type': 'application/json' }
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
                headers: corsHeaders(origin)
            });
        }

        // --- Proxy to Groq ---
        try {
            const body = await request.json();

            // Validate: only allow chat completions
            if (!body.messages || !Array.isArray(body.messages)) {
                return new Response(JSON.stringify({ error: 'Invalid request' }), {
                    status: 400,
                    headers: corsHeaders(origin)
                });
            }

            // Cap max_tokens to prevent abuse
            body.max_tokens = Math.min(body.max_tokens || 512, 1024);

            // Enforce model whitelist
            const model = ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0];

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

            return new Response(data, {
                status: groqResponse.status,
                headers: {
                    ...corsHeaders(origin),
                    'Content-Type': 'application/json'
                }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: 'Proxy error' }), {
                status: 500,
                headers: corsHeaders(origin)
            });
        }
    }
};

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
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
        headers: corsHeaders(origin)
    });
}
