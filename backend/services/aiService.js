import axios from 'axios';
import logger from '../utils/logger.js';
import {
  DEFAULT_API_BASE_URL,
  CHARS_PER_TOKEN,
  CONTEXT_INPUT_RATIO,
  CHUNK_FILL_RATIO,
  MAX_RESPONSE_TOKENS,
  MAX_CONTINUATION_ATTEMPTS,
  MAX_CHARACTER_RETRIES,
  MAX_PARALLEL_CHARACTER_CALLS,
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
      max_completion_tokens: model.top_provider?.max_completion_tokens || null,
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
    {
      headers: makeHeaders(apiKey),
      timeout: AI_REQUEST_TIMEOUT_MS,
    },
  );
  if (!response.data?.choices?.[0]?.message?.content) {
    throw new Error('AI returned an empty or unexpected response while summarizing chunk');
  }
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

  const maxReduceAttempts = 3;
  let reduceAttempt = 0;
  while (combined.length > maxCharsForInput && reduceAttempt < maxReduceAttempts) {
    reduceAttempt += 1;
    logger.info(`Combined summary too large (${combined.length} chars), reduction attempt ${reduceAttempt}/${maxReduceAttempts}...`);
    combined = await summarizeChunk(combined, apiKey, model, apiBaseUrl);
  }

  if (combined.length > maxCharsForInput) {
    logger.warn(`Combined summary still exceeds max input (${combined.length} > ${maxCharsForInput}) after ${maxReduceAttempts} attempts; truncating safely.`);
    combined = `${combined.slice(0, maxCharsForInput - 1)}…`;
  }

  return combined;
}

/**
 * Send the analysis prompt to the AI and return content + finish reason.
 */
async function requestAnalysis(prompt, apiKey, model, apiBaseUrl, maxResponseTokens) {
  const response = await axios.post(
    `${apiBaseUrl}/chat/completions`,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      stream: false,
      max_tokens: maxResponseTokens,
    },
    {
      headers: makeHeaders(apiKey),
      timeout: AI_REQUEST_TIMEOUT_MS,
    },
  );

  if (!response.data?.choices?.[0]?.message?.content) {
    throw new Error('AI response missing message content');
  }

  const choice = response.data.choices[0];
  return { content: choice.message.content, finishReason: choice.finish_reason };
}

/**
 * Ask the AI to continue a truncated JSON response.
 */
async function continueResponse(originalPrompt, partialResponse, apiKey, model, apiBaseUrl, maxResponseTokens) {
  const response = await axios.post(
    `${apiBaseUrl}/chat/completions`,
    {
      model,
      messages: [
        { role: 'user', content: originalPrompt },
        { role: 'assistant', content: partialResponse },
        { role: 'user', content: 'Your JSON response was cut off. Continue EXACTLY from where you stopped. Output ONLY the remaining JSON to complete the object. Do not repeat any content.' },
      ],
      stream: false,
      max_tokens: maxResponseTokens,
    },
    {
      headers: makeHeaders(apiKey),
      timeout: AI_REQUEST_TIMEOUT_MS,
    },
  );

  return response.data?.choices?.[0]?.message?.content || '';
}

/**
 * Attempt to parse JSON from AI response, with repair logic for common issues.
 */
function parseAIResponse(content) {
  let initialParseError = null;

  // Try direct parse first
  try {
    return JSON.parse(content);
  } catch (err) {
    initialParseError = err;
  }

  logger.debug(`Direct JSON parse failed, attempting repair: ${initialParseError?.message || 'Unknown parse error'}`);
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
    // Attempt to fix truncated JSON by closing open strings/brackets
    logger.debug('Standard repair failed, attempting truncation repair...');
    const repaired = repairTruncatedJSON(cleaned);
    if (repaired) {
      try { return JSON.parse(repaired); } catch (_) { /* fall through */ }
    }

    throw new Error(
      `Failed to parse AI response after repair attempt: ${err.message}. Initial parse error: ${initialParseError?.message || 'Unknown parse error'}`,
    );
  }
}

/**
 * Attempt to repair truncated JSON by closing open strings, arrays, and objects.
 */
function repairTruncatedJSON(json) {
  // Trim back to the last complete value (ends with ", }, ], true, false, null, or a number)
  let trimmed = json.replace(/,\s*$/, '');

  // If we're inside an unterminated string, close it
  let inString = false;
  let lastGoodPos = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && inString) { i++; continue; }
    if (ch === '"') { inString = !inString; }
    if (!inString && (ch === '}' || ch === ']' || ch === '"')) {
      lastGoodPos = i;
    }
  }

  if (inString) {
    // Cut at the last good position before the unterminated string and close it
    trimmed = trimmed.substring(0, lastGoodPos + 1);
  }

  // Remove any trailing comma
  trimmed = trimmed.replace(/,\s*$/, '');

  // Count open brackets and close them
  const stack = [];
  inString = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && inString) { i++; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    if (ch === '}' || ch === ']') stack.pop();
  }

  // Close any remaining open brackets
  let suffix = '';
  while (stack.length > 0) {
    const open = stack.pop();
    suffix += open === '{' ? '}' : ']';
  }

  if (suffix) {
    logger.info(`Repaired truncated JSON by appending: ${suffix}`);
    return trimmed + suffix;
  }
  return null;
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
// Phase-specific validation
// ---------------------------------------------------------------------------

/**
 * Validate Phase 1 extraction result.
 */
function validateExtractionResult(result) {
  if (!result.bookTitle) result.bookTitle = 'Unknown Book';
  if (!result.characters || !Array.isArray(result.characters)) {
    throw new Error('AI extraction response missing characters array');
  }
  result.characters = result.characters.filter(c => c.name && c.role);
  if (result.characters.length === 0) {
    throw new Error('AI extraction returned no valid characters (each needs name and role)');
  }
  if (!result.worldInfo) {
    logger.warn('AI extraction response missing worldInfo, using empty structure');
    result.worldInfo = { setting: '', locations: [], factions: [], items: [], concepts: [] };
  }
  return result;
}

/**
 * Validate Phase 2 character detail result with fallback defaults.
 */
function validateCharacterDetail(detail, expectedName) {
  if (!detail.name) detail.name = expectedName;
  detail.background = detail.background || '';
  detail.physicalDescription = detail.physicalDescription || '';
  detail.personality = detail.personality || '';
  detail.commonPhrases = Array.isArray(detail.commonPhrases) ? detail.commonPhrases : [];
  detail.scenario = detail.scenario || '';
  detail.firstMessages = Array.isArray(detail.firstMessages) ? detail.firstMessages.filter(m => m && m.trim()) : [];
  detail.exampleDialogue = detail.exampleDialogue || '';
  detail.tags = Array.isArray(detail.tags) ? detail.tags : [];
  detail.canBePersona = detail.canBePersona ?? false;
  return detail;
}

// ---------------------------------------------------------------------------
// Concurrency utility
// ---------------------------------------------------------------------------

/**
 * Run async tasks with a concurrency limit, preserving result order.
 */
async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Phase 2: per-character detail fetch
// ---------------------------------------------------------------------------

/**
 * Fetch full details for a single character with continuation + retry logic.
 * Returns null if all retries are exhausted (caller should skip).
 */
async function fetchCharacterDetail(
  textToAnalyze, characterSummary, bookTitle,
  apiKey, model, apiBaseUrl, maxResponseTokens,
  sessionId, updateProgress, characterIndex, totalCharacters,
) {
  const progress = (msg) => { if (updateProgress && sessionId) updateProgress(sessionId, msg); };
  const charLabel = `${characterSummary.name} (${characterIndex + 1}/${totalCharacters})`;

  const prompt = buildCharacterDetailPrompt(textToAnalyze, characterSummary, bookTitle);

  for (let retry = 0; retry <= MAX_CHARACTER_RETRIES; retry++) {
    try {
      progress(`Generating details for ${charLabel}...`);
      logger.info(`Character detail request for ${characterSummary.name} (attempt ${retry + 1})`);

      let { content, finishReason } = await requestAnalysis(
        prompt, apiKey, model, apiBaseUrl, maxResponseTokens,
      );

      // Handle truncation with continuation
      if (finishReason === 'length') {
        for (let attempt = 1; attempt <= MAX_CONTINUATION_ATTEMPTS; attempt++) {
          logger.info(`Character ${characterSummary.name} truncated, continuation ${attempt}/${MAX_CONTINUATION_ATTEMPTS}`);
          progress(`Response for ${charLabel} was truncated, continuing...`);

          const continuation = await continueResponse(prompt, content, apiKey, model, apiBaseUrl, maxResponseTokens);
          if (!continuation) break;
          content += continuation;

          try {
            return validateCharacterDetail(parseAIResponse(content), characterSummary.name);
          } catch (err) {
            logger.error(
              `Still cannot parse ${characterSummary.name} after continuation: ${err.message}\n${err.stack || ''}`,
            );
            logger.debug(`Raw continuation content for ${characterSummary.name}: ${content}`);
          }
        }
      }

      const detail = validateCharacterDetail(parseAIResponse(content), characterSummary.name);
      logger.info(`Parsed character detail for ${characterSummary.name}`);
      progress(`Completed ${charLabel}`);
      return detail;
    } catch (error) {
      logger.error(`Character detail failed for ${characterSummary.name} (attempt ${retry + 1}):`, error.message);
      if (retry < MAX_CHARACTER_RETRIES) {
        progress(`Retrying ${charLabel} (attempt ${retry + 2})...`);
        continue;
      }
      logger.warn(`Skipping ${characterSummary.name} after ${MAX_CHARACTER_RETRIES + 1} failed attempts`);
      progress(`Could not generate details for ${characterSummary.name}, skipping...`);
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Analyze book text and extract characters and world information.
 * Uses a two-phase approach: Phase 1 extracts a character roster + worldInfo,
 * Phase 2 fetches full details for each character in parallel.
 *
 * @param {string} bookText - The book text or summary
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {string} [options.model='anthropic/claude-3.5-sonnet']
 * @param {number} [options.contextLength=200000] - Model's context window size in tokens
 * @param {string|null} [options.sessionId=null]
 * @param {Function|null} [options.updateProgress=null]
 * @param {string} [options.apiBaseUrl=DEFAULT_API_BASE_URL]
 * @param {Array|null} [options.chapters=null] - Optional chapter array for chapter-aware chunking
 * @param {number|null} [options.maxCompletionTokens=null] - Model's max output tokens (from provider)
 * @returns {Promise<Object>} Analysis with characters and worldInfo
 */
export async function analyzeBook(bookText, {
  apiKey,
  model = 'anthropic/claude-3.5-sonnet',
  contextLength = 200000,
  sessionId = null,
  updateProgress = null,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  chapters = null,
  maxCompletionTokens = null,
} = {}) {
  if (!apiKey) {
    throw new Error('apiKey is required for analyzeBook');
  }

  const progress = (msg) => { if (updateProgress && sessionId) updateProgress(sessionId, msg); };

  const safeContextSize = Math.floor(contextLength * CONTEXT_INPUT_RATIO);
  const maxCharsForInput = safeContextSize * CHARS_PER_TOKEN;

  logger.info(`Book: ${bookText.length} chars, max input: ${maxCharsForInput} chars`);

  // Chunk and summarize if needed (unchanged)
  let textToAnalyze = bookText;
  if (bookText.length > maxCharsForInput) {
    textToAnalyze = await chunkAndSummarize(
      bookText, chapters, maxCharsForInput, safeContextSize,
      apiKey, model, apiBaseUrl, sessionId, updateProgress,
    );
  }

  // Helper to calculate max response tokens for a given prompt
  function calcMaxResponseTokens(prompt) {
    const inputTokenEstimate = Math.ceil(prompt.length / CHARS_PER_TOKEN);
    let tokens = Math.max(MAX_RESPONSE_TOKENS, contextLength - inputTokenEstimate);
    if (maxCompletionTokens) tokens = Math.min(tokens, maxCompletionTokens);
    return tokens;
  }

  // ---- PHASE 1: Extract character roster + worldInfo ----
  progress('Extracting character roster and world info...');
  const extractionPrompt = buildExtractionPrompt(textToAnalyze);
  const extractionMaxTokens = calcMaxResponseTokens(extractionPrompt);

  logger.info(`Phase 1: sending ${textToAnalyze.length} chars, max response tokens: ${extractionMaxTokens}`);

  let extraction;
  try {
    let { content, finishReason } = await requestAnalysis(
      extractionPrompt, apiKey, model, apiBaseUrl, extractionMaxTokens,
    );
    logger.info(`Phase 1 response: ${content.length} chars (finish_reason: ${finishReason})`);

    if (finishReason === 'length') {
      for (let attempt = 1; attempt <= MAX_CONTINUATION_ATTEMPTS; attempt++) {
        logger.info(`Phase 1 truncated, continuation ${attempt}/${MAX_CONTINUATION_ATTEMPTS}`);
        progress(`Extraction response truncated, requesting continuation (${attempt}/${MAX_CONTINUATION_ATTEMPTS})...`);
        const continuation = await continueResponse(extractionPrompt, content, apiKey, model, apiBaseUrl, extractionMaxTokens);
        if (!continuation) break;
        content += continuation;
        try {
          extraction = validateExtractionResult(parseAIResponse(content));
          break;
        } catch {
          logger.info('Phase 1 still cannot parse after continuation');
        }
      }
    }

    if (!extraction) {
      extraction = validateExtractionResult(parseAIResponse(content));
    }

    logger.info(`Phase 1 complete: "${extraction.bookTitle}", ${extraction.characters.length} characters identified`);
    progress(`Found ${extraction.characters.length} characters. Generating detailed profiles...`);
  } catch (error) {
    logger.error('Phase 1 error:', error.message);
    if (error.code === 'ECONNABORTED') {
      throw new Error('AI request timed out during extraction. Try a smaller book or try again later.');
    }
    if (error.response) {
      const msg = error.response.data?.error?.message || error.response.data?.error || error.response.statusText;
      throw new Error(`AI service error during extraction: ${msg}`);
    }
    if (error.request) {
      throw new Error('No response from AI service. Check your internet connection and API key.');
    }
    throw new Error(`AI extraction failed: ${error.message}`);
  }

  // ---- PHASE 2: Per-character detail calls ----
  const samplePrompt = buildCharacterDetailPrompt(textToAnalyze, extraction.characters[0], extraction.bookTitle);
  const charMaxTokens = calcMaxResponseTokens(samplePrompt);
  const totalCharacters = extraction.characters.length;

  logger.info(`Phase 2: ${totalCharacters} characters, max response tokens per character: ${charMaxTokens}`);

  const tasks = extraction.characters.map((charSummary, index) => {
    return () => fetchCharacterDetail(
      textToAnalyze, charSummary, extraction.bookTitle,
      apiKey, model, apiBaseUrl, charMaxTokens,
      sessionId, updateProgress, index, totalCharacters,
    );
  });

  const characterDetails = await runWithConcurrency(tasks, MAX_PARALLEL_CHARACTER_CALLS);
  const successfulCharacters = characterDetails.filter(c => c !== null);

  if (successfulCharacters.length === 0) {
    throw new Error('Failed to generate details for any characters. Please try again.');
  }

  if (successfulCharacters.length < totalCharacters) {
    logger.warn(`${totalCharacters - successfulCharacters.length} character(s) failed and were skipped`);
    progress(`Completed with ${successfulCharacters.length}/${totalCharacters} characters`);
  }

  // ---- Assemble final result ----
  const analysis = {
    bookTitle: extraction.bookTitle,
    characters: successfulCharacters,
    worldInfo: extraction.worldInfo,
  };

  const validated = validateAnalysis(analysis);
  logger.info(`Analysis complete: ${validated.characters.length} characters, book: "${validated.bookTitle}"`);
  progress(`Analysis complete — ${validated.characters.length} character profiles generated`);

  return validated;
}

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

/**
 * Phase 1: Extraction prompt — character roster + worldInfo.
 */
function buildExtractionPrompt(text) {
  return `Analyze this book text and extract a list of important characters and detailed world information.

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
      "briefDescription": "1-2 sentences summarizing who this character is, their significance, and key traits"
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
- Identify 3-10 important characters
- For each character, provide ONLY name, role, and a brief 1-2 sentence description
- For worldInfo entries: include 3-6 keywords per entry (aliases, nicknames, abbreviations, related terms)
- Write worldInfo descriptions as detailed context an AI would need to roleplay accurately in this setting
- Return ONLY JSON, no other text`;
}

/**
 * Phase 2: Character detail prompt — full profile for a single character.
 */
function buildCharacterDetailPrompt(text, characterSummary, bookTitle) {
  return `You are analyzing the book "${bookTitle}". Focus on this specific character:

Name: ${characterSummary.name}
Role: ${characterSummary.role}
Summary: ${characterSummary.briefDescription}

CRITICAL: Return ONLY valid JSON. No markdown, no explanations, no code blocks. Just raw JSON starting with { and ending with }.
Ensure all quotes inside strings are properly escaped with backslashes.

Book Text:
${text}

Return a JSON object with detailed information about ${characterSummary.name}:
{
  "name": "${characterSummary.name}",
  "role": "${characterSummary.role}",
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

Instructions:
- Focus ONLY on ${characterSummary.name}
- Aim for ~3000 tokens of detailed content
- Replace interaction partner names with {{user}} in scenarios/messages/dialogue
- Use quotes for dialogue, asterisks for actions in messages
- Mark as canBePersona: true if this is a main character the user could roleplay as
- Return ONLY JSON, no other text`;
}
