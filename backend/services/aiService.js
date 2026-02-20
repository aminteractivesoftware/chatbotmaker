import axios from 'axios';
import logger from '../utils/logger.js';
import {
  DEFAULT_API_BASE_URL,
  CHARS_PER_TOKEN,
  CONTEXT_INPUT_RATIO,
  CHUNK_FILL_RATIO,
  MAX_RESPONSE_TOKENS,
  AI_REQUEST_TIMEOUT_MS,
  CONNECTION_TEST_TIMEOUT_MS,
} from '../config/constants.js';

/**
 * Test connection to an OpenAI-compatible API
 * @param {string} apiBaseUrl
 * @param {string} apiKey
 * @returns {Promise<{success: boolean, modelCount?: number, error?: string}>}
 */
export async function testConnection(apiBaseUrl, apiKey) {
  try {
    const response = await axios.get(`${apiBaseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: CONNECTION_TEST_TIMEOUT_MS,
    });
    const models = response.data.data || response.data;
    return { success: true, modelCount: Array.isArray(models) ? models.length : 0 };
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.response?.statusText || error.message;
    return { success: false, error: msg };
  }
}

/**
 * Get available models from an OpenAI-compatible API
 * @param {string} apiKey
 * @param {string} apiBaseUrl
 * @returns {Promise<Array>}
 */
export async function getAvailableModels(apiKey, apiBaseUrl = DEFAULT_API_BASE_URL) {
  try {
    const response = await axios.get(`${apiBaseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    const models = response.data.data || response.data;
    if (!Array.isArray(models)) throw new Error('Unexpected response format from models endpoint');

    return models.map(model => ({
      id: model.id,
      name: model.name || model.id,
      context_length: model.context_length || 4096,
      pricing: model.pricing,
    }));
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.response?.statusText || error.message;
    throw new Error(`Failed to fetch models: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Text chunking
// ---------------------------------------------------------------------------

/**
 * Split text into chunks by paragraphs (fallback for oversized chapters).
 */
function chunkText(text, maxTokens) {
  const charsPerChunk = maxTokens * CHARS_PER_TOKEN;
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + paragraph).length < charsPerChunk) {
      current += paragraph + '\n\n';
    } else {
      if (current) chunks.push(current.trim());
      current = paragraph + '\n\n';
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

/**
 * Split text into chunks at chapter boundaries.
 * Falls back to paragraph splitting for oversized chapters.
 */
function chunkByChapters(chapters, maxTokens) {
  const charsPerChunk = maxTokens * CHARS_PER_TOKEN;
  const chunks = [];
  let current = '';

  for (const chapter of chapters) {
    const chapterText = chapter.title
      ? `--- ${chapter.title} ---\n\n${chapter.text}`
      : chapter.text;

    if (chapterText.length > charsPerChunk) {
      if (current) { chunks.push(current.trim()); current = ''; }
      chunks.push(...chunkText(chapterText, maxTokens));
      continue;
    }

    if (current && (current.length + chapterText.length) > charsPerChunk) {
      chunks.push(current.trim());
      current = '';
    }
    current += chapterText + '\n\n';
  }
  if (current) chunks.push(current.trim());

  logger.info(`Chapter-aware chunking: ${chapters.length} chapters -> ${chunks.length} chunks`);
  return chunks;
}

// ---------------------------------------------------------------------------
// AI API helpers
// ---------------------------------------------------------------------------

function makeHeaders(apiKey) {
  return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

/**
 * Summarize a single chunk of text.
 */
async function summarizeChunk(chunk, apiKey, model, apiBaseUrl) {
  const response = await axios.post(
    `${apiBaseUrl}/chat/completions`,
    {
      model,
      messages: [{
        role: 'user',
        content: `Summarize this excerpt from a book, focusing on characters, plot events, world-building details, and key information:\n\n${chunk}`,
      }],
    },
    { headers: makeHeaders(apiKey) },
  );
  return response.data.choices[0].message.content;
}

/**
 * Chunk and summarize text that exceeds the model's context window.
 */
async function chunkAndSummarize(bookText, chapters, maxCharsForInput, safeContextSize, apiKey, model, apiBaseUrl, sessionId, updateProgress) {
  const progress = (msg) => { if (updateProgress && sessionId) updateProgress(sessionId, msg); };
  progress('Book too large, chunking into smaller pieces...');

  const chunkTokenSize = Math.floor(safeContextSize * CHUNK_FILL_RATIO);
  const chunks = (chapters && chapters.length > 0)
    ? chunkByChapters(chapters, chunkTokenSize)
    : chunkText(bookText, chunkTokenSize);

  logger.info(`Split into ${chunks.length} chunks`);

  const summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    progress(`Summarizing chunk ${i + 1} of ${chunks.length}...`);
    summaries.push(await summarizeChunk(chunks[i], apiKey, model, apiBaseUrl));
  }

  let combined = summaries.join('\n\n---\n\n');

  if (combined.length > maxCharsForInput) {
    logger.info('Combined summary still too large, creating final summary...');
    combined = await summarizeChunk(combined, apiKey, model, apiBaseUrl);
  }

  return combined;
}

/**
 * Send the analysis prompt to the AI and return the raw content string.
 */
async function requestAnalysis(textToAnalyze, apiKey, model, apiBaseUrl) {
  const prompt = buildAnalysisPrompt(textToAnalyze);

  const response = await axios.post(
    `${apiBaseUrl}/chat/completions`,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      max_tokens: MAX_RESPONSE_TOKENS,
    },
    {
      headers: makeHeaders(apiKey),
      timeout: AI_REQUEST_TIMEOUT_MS,
    },
  );

  if (!response.data?.choices?.[0]?.message?.content) {
    throw new Error('AI response missing message content');
  }

  return response.data.choices[0].message.content;
}

/**
 * Attempt to parse JSON from AI response, with repair logic for common issues.
 */
function parseAIResponse(content) {
  // Try direct parse first
  try { return JSON.parse(content); } catch { /* fall through to repair */ }

  logger.debug('Direct JSON parse failed, attempting repair...');
  let cleaned = content.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

  // Extract outermost JSON object
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    cleaned = cleaned.substring(first, last + 1);
  }

  try { return JSON.parse(cleaned); } catch (err) {
    throw new Error(`Failed to parse AI response: ${err.message}`);
  }
}

/**
 * Validate and normalize the parsed analysis object.
 */
function validateAnalysis(analysis) {
  if (!analysis.characters || !Array.isArray(analysis.characters)) {
    throw new Error('AI response missing characters array');
  }
  if (!analysis.worldInfo) {
    logger.warn('AI response missing worldInfo, using empty structure');
    analysis.worldInfo = { setting: '', locations: [], factions: [], items: [], concepts: [] };
  }
  if (!analysis.bookTitle) {
    analysis.bookTitle = 'Unknown Book';
  }
  return analysis;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Analyze book text and extract characters and world information.
 * @param {string} bookText - The book text or summary
 * @param {string} apiKey
 * @param {string} model
 * @param {number} contextLength - Model's context window size in tokens
 * @param {string|null} sessionId
 * @param {Function|null} updateProgress
 * @param {string} apiBaseUrl
 * @param {Array|null} chapters - Optional chapter array for chapter-aware chunking
 * @returns {Promise<Object>} Analysis with characters and worldInfo
 */
export async function analyzeBook(bookText, apiKey, model = 'anthropic/claude-3.5-sonnet', contextLength = 200000, sessionId = null, updateProgress = null, apiBaseUrl = DEFAULT_API_BASE_URL, chapters = null) {
  const progress = (msg) => { if (updateProgress && sessionId) updateProgress(sessionId, msg); };

  const safeContextSize = Math.floor(contextLength * CONTEXT_INPUT_RATIO);
  const maxCharsForInput = safeContextSize * CHARS_PER_TOKEN;

  logger.info(`Book: ${bookText.length} chars, max input: ${maxCharsForInput} chars`);

  // Chunk and summarize if needed
  let textToAnalyze = bookText;
  if (bookText.length > maxCharsForInput) {
    textToAnalyze = await chunkAndSummarize(
      bookText, chapters, maxCharsForInput, safeContextSize,
      apiKey, model, apiBaseUrl, sessionId, updateProgress,
    );
  }

  // Send to AI
  progress(`Sending ${textToAnalyze.length.toLocaleString()} characters to AI (${model})...`);
  logger.info(`Sending analysis request: ${textToAnalyze.length} chars to ${model}`);

  try {
    const content = await requestAnalysis(textToAnalyze, apiKey, model, apiBaseUrl);
    logger.info(`Received response: ${content.length} chars`);
    progress(`Received response (${content.length.toLocaleString()} characters), parsing...`);

    const analysis = validateAnalysis(parseAIResponse(content));
    logger.info(`Parsed ${analysis.characters.length} characters`);
    progress(`Parsed ${analysis.characters.length} characters from AI response`);

    return analysis;
  } catch (error) {
    logger.error('AI analysis error:', error.message);

    if (error.code === 'ECONNABORTED') {
      throw new Error('AI request timed out. The book may be too large or the AI service is slow. Try a smaller book or try again later.');
    }
    if (error.response) {
      const msg = error.response.data?.error?.message || error.response.data?.error || error.response.statusText;
      throw new Error(`AI service error: ${msg}`);
    }
    if (error.request) {
      throw new Error('No response from AI service. Check your internet connection and API key.');
    }
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Analysis prompt
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(text) {
  return `Analyze this book text and extract detailed information about the characters and world.

CRITICAL: Return ONLY valid JSON. No markdown, no explanations, no code blocks. Just raw JSON starting with { and ending with }.
Ensure all quotes inside strings are properly escaped with backslashes.

Book Text:
${text}

Return a JSON object with this structure:
{
  "bookTitle": "Title of the book",
  "characters": [
    {
      "name": "Character Name",
      "role": "main_character|love_interest|protagonist|antagonist|supporting|mentor|rival",
      "background": "1-2 paragraph background covering history, relationships, what shaped them",
      "physicalDescription": "1 paragraph: height, build, age, hair, eyes, distinctive features, clothing",
      "personality": "1-2 paragraphs: core traits, quirks, motivations, values, strengths, weaknesses",
      "commonPhrases": ["3-5 distinctive phrases or expressions they use"],
      "scenario": "Describe the scenario of when this character first meets {{user}} (1 paragraph). Set the scene with key details: setting, circumstances, mood, what brings them together. Use {{user}} instead of the other character's actual name.",
      "firstMessages": [
        "First message option 1 - Opening message when meeting {{user}}. 1-3 paragraphs. Start with backstory/context: what led to this moment, their emotional state, recent events. Then describe the scene with sensory details. Finally, their greeting or first action. Use quotes for dialogue and asterisks for actions/thoughts. Make it immersive and in-character.",
        "First message option 2 - Different opening showing another personality aspect. 1-3 paragraphs with context, scene-setting, and interaction. Use quotes for dialogue and asterisks for actions/thoughts.",
        "First message option 3 - Another variation (emotional, action-packed, humorous, or intimate). 1-3 paragraphs with comprehensive backstory and scene details. Use quotes for dialogue and asterisks for actions/thoughts."
      ],
      "exampleDialogue": "4-6 short exchanges. Use {{user}} for other person. Use quotes for speech, asterisks for actions",
      "tags": ["5-15 tags: gender, genre, personality, role"],
      "canBePersona": true
    }
  ],
  "worldInfo": {
    "setting": "Detailed world/universe description (2-3 paragraphs covering geography, society, rules, tone)",
    "locations": [{"name": "Location Name", "description": "Detailed description of this place, its significance, and what happens there", "keywords": ["alias", "nickname", "related terms that should trigger this entry"]}],
    "factions": [{"name": "Faction Name", "description": "Who they are, their goals, structure, and role in the story", "keywords": ["alias", "abbreviation", "leader name", "related terms"]}],
    "items": [{"name": "Item Name", "description": "What it is, its properties, significance, and who uses it", "keywords": ["alias", "nickname", "related terms"]}],
    "concepts": [{"name": "Concept Name", "description": "Explanation of this magic system, technology, social concept, etc.", "keywords": ["alias", "related terms", "slang used in-universe"]}]
  }
}

Instructions:
- Extract 3-10 main characters
- Aim for ~3000 tokens per character
- Replace interaction partner names with {{user}} in scenarios/messages/dialogue
- Use quotes for dialogue, asterisks for actions in messages
- Mark main characters with canBePersona: true
- For worldInfo entries: include 3-6 keywords per entry (aliases, nicknames, abbreviations, related terms that should trigger the entry in a chatbot lorebook)
- Write worldInfo descriptions as detailed context an AI would need to roleplay accurately in this setting
- Return ONLY JSON, no other text`;
}
