import { CITY_MAX_TOKENS, CITY_SYSTEM_PROMPT } from './poi-curation.js';

// Gemini curates by default; set CITY_MODEL_PROVIDER=anthropic to use Claude instead.
const PROVIDERS = {
  gemini: { model: 'gemini-3.8-flash', keyName: 'GEMINI_API_KEY', inputPrice: 0.75, outputPrice: 3.75, call: callGemini },
  anthropic: { model: 'claude-haiku-4-5-20251001', keyName: 'ANTHROPIC_API_KEY', inputPrice: 1, outputPrice: 5, call: callAnthropic },
};
const TIMEOUT_MS = 180000;
const RETRY_DELAYS_MS = [5000, 10000, 20000];
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 529]);
const OVERLOADED_STATUSES = new Set([429, 503, 529]);

class ModelError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.overloaded = OVERLOADED_STATUSES.has(status);
  }
}

// Overloaded or briefly failing providers usually recover within seconds, so those errors are retried with growing waits.
async function callWithRetry(provider, apiKey, prompt, options) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await provider.call(provider, apiKey, prompt, options);
    } catch (error) {
      if (!TRANSIENT_STATUSES.has(error.status) || attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

async function callGemini(provider, apiKey, prompt, options) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CITY_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: CITY_MAX_TOKENS,
        responseMimeType: 'application/json',
        ...(options.lightThinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await response.json();
  if (!response.ok) throw new ModelError(`Gemini returned ${response.status}: ${data.error?.message || ''}`.trim(), response.status);
  const candidate = data.candidates?.[0] || {};
  const usage = data.usageMetadata || {};
  return {
    text: (candidate.content?.parts || []).filter(part => part.text && !part.thought).map(part => part.text).join(''),
    stopReason: candidate.finishReason || 'unknown',
    inputTokens: usage.promptTokenCount || 0,
    // Gemini bills its thinking as output.
    outputTokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
  };
}

async function callAnthropic(provider, apiKey, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: CITY_MAX_TOKENS,
      system: CITY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await response.json();
  if (!response.ok) throw new ModelError(`Anthropic returned ${response.status}: ${data.error?.message || ''}`.trim(), response.status);
  return {
    text: (data.content || []).filter(block => block.type === 'text').map(block => block.text).join(''),
    stopReason: data.stop_reason || 'unknown',
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

function parseCuration(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in model output');
  return JSON.parse(text.slice(start, end + 1));
}

export function curationModel() {
  const name = process.env.CITY_MODEL_PROVIDER || 'gemini';
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown CITY_MODEL_PROVIDER "${name}". Use ${Object.keys(PROVIDERS).join(' or ')}.`);
  return { name, ...provider };
}

// Asks the model for a guide, retrying once when the reply is not usable JSON. Simple rewrites can use light thinking.
export async function curateCity(prompt, options = {}) {
  const provider = curationModel();
  const apiKey = process.env[provider.keyName];
  if (!apiKey) throw new Error(`${provider.keyName} is not set in .env`);

  let lastError;
  const totals = { inputTokens: 0, outputTokens: 0 };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const reply = await callWithRetry(provider, apiKey, prompt, options);
    totals.inputTokens += reply.inputTokens;
    totals.outputTokens += reply.outputTokens;
    try {
      const curation = parseCuration(reply.text);
      const cost = (totals.inputTokens / 1e6) * provider.inputPrice + (totals.outputTokens / 1e6) * provider.outputPrice;
      return { curation, model: provider.model, stopReason: reply.stopReason, attempts: attempt, ...totals, cost };
    } catch (error) {
      lastError = new Error(`${provider.model} returned unusable JSON (stop reason ${reply.stopReason}): ${error.message}`);
    }
  }
  throw lastError;
}
