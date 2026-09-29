import { CITY_MAX_TOKENS, CITY_SYSTEM_PROMPT } from './poi-curation.js';

// Gemini curates by default; set CITY_MODEL_PROVIDER=anthropic to use Claude instead.
const PROVIDERS = {
  gemini: { model: 'gemini-3.8-flash', keyName: 'GEMINI_API_KEY', inputPrice: 0.75, outputPrice: 3.75, call: callGemini },
  anthropic: { model: 'claude-haiku-4-5-20251001', keyName: 'ANTHROPIC_API_KEY', inputPrice: 1, outputPrice: 5, call: callAnthropic },
};
const TIMEOUT_MS = 180000;

async function callGemini(provider, apiKey, prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CITY_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: CITY_MAX_TOKENS, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Gemini returned ${response.status}: ${data.error?.message || ''}`.trim());
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
  if (!response.ok) throw new Error(`Anthropic returned ${response.status}: ${data.error?.message || ''}`.trim());
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

// Asks the model for a guide, retrying once when the reply is not usable JSON.
export async function curateCity(prompt) {
  const provider = curationModel();
  const apiKey = process.env[provider.keyName];
  if (!apiKey) throw new Error(`${provider.keyName} is not set in .env`);

  let lastError;
  const totals = { inputTokens: 0, outputTokens: 0 };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const reply = await provider.call(provider, apiKey, prompt);
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
