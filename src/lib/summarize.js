// AI summary generation.
//
// With ANTHROPIC_API_KEY set, new items are summarized by Claude in small
// batches (neutral, factual, 50–100 words). Without a key — or on any API
// failure — a clean extractive fallback builds the summary from the feed's
// own excerpt, so the platform always works.
//
// Only headline + short feed excerpt are sent to the model; full article
// bodies are never fetched or stored.

const { splitSentences, wordCount, truncateWords } = require('./text');

const MODEL = process.env.SUMMARY_MODEL || 'claude-opus-4-8';
const BATCH_SIZE = 10;

let client = null;
if (process.env.ANTHROPIC_API_KEY) {
  const Anthropic = require('@anthropic-ai/sdk');
  client = new Anthropic();
}

function aiEnabled() {
  return client !== null;
}

// Extractive fallback: first sentences of the excerpt, capped at ~90 words.
function extractiveSummary(item) {
  const source = item.excerpt || item.title;
  const sentences = splitSentences(source);
  let summary = '';
  for (const sentence of sentences) {
    const candidate = summary ? `${summary} ${sentence}` : sentence;
    if (wordCount(candidate) > 90 && summary) break;
    summary = candidate;
    if (wordCount(summary) >= 50) break;
  }
  return truncateWords(summary || item.title, 100);
}

const SCHEMA = {
  type: 'object',
  properties: {
    summaries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['id', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['summaries'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You write short summaries for a news aggregation platform.
For each news item you receive (headline + excerpt), write one neutral, factual summary of 40-70 words (3-4 short lines).
State what happened, who is involved, and why it matters. No opinion, no hype, no clickbait, no first person, no "the article says". Never copy more than a short phrase verbatim from the excerpt.`;

async function summarizeBatchWithClaude(items) {
  const payload = items.map((item) => ({
    id: item.id,
    headline: item.title,
    source: item.sourceName,
    excerpt: truncateWords(item.excerpt || '', 180),
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Summarize each of these news items:\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('summary request refused');
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('empty summary response');

  const byId = new Map();
  for (const entry of JSON.parse(text).summaries || []) {
    if (entry.id && entry.summary) byId.set(entry.id, truncateWords(entry.summary.trim(), 100));
  }
  return byId;
}

/**
 * Attach a `summary` (and `summarySource`) to every item, in place.
 * Items that already have an AI summary are skipped.
 */
async function summarizeAll(items) {
  const pending = items.filter((item) => !item.summary || item.summarySource === 'excerpt');

  // Always have a summary immediately; AI upgrades it when available.
  for (const item of pending) {
    if (!item.summary) {
      item.summary = extractiveSummary(item);
      item.summarySource = 'excerpt';
    }
  }

  if (!aiEnabled() || pending.length === 0) return;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    try {
      const summaries = await summarizeBatchWithClaude(batch);
      for (const item of batch) {
        const aiSummary = summaries.get(item.id);
        if (aiSummary && wordCount(aiSummary) >= 15) {
          item.summary = aiSummary;
          item.summarySource = 'ai';
        }
      }
    } catch (err) {
      console.warn(`[summarize] Claude batch failed (${err.message}); keeping extractive summaries`);
    }
  }
}

module.exports = { summarizeAll, extractiveSummary, aiEnabled };
