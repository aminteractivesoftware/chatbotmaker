import axios from 'axios';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Get available models from OpenRouter
 * @param {string} apiKey - OpenRouter API key
 * @returns {Promise<Array>} List of available models with context info
 */
export async function getAvailableModels(apiKey) {
  try {
    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Chatbot Maker'
      }
    });

    // Return models with context_length info
    return response.data.data.map(model => ({
      id: model.id,
      name: model.name || model.id,
      context_length: model.context_length || 4096,
      pricing: model.pricing
    }));
  } catch (error) {
    if (error.response) {
      throw new Error(`Failed to fetch models: ${error.response.data.error?.message || error.response.statusText}`);
    }
    throw new Error(`Failed to fetch models: ${error.message}`);
  }
}

/**
 * Split text into chunks based on token limit
 * @param {string} text - Text to chunk
 * @param {number} maxTokens - Maximum tokens per chunk (approximate)
 * @returns {Array<string>} Array of text chunks
 */
function chunkText(text, maxTokens = 8000) {
  // Approximate: 1 token ≈ 4 characters
  const charsPerChunk = maxTokens * 4;
  const chunks = [];

  // Split by paragraphs first
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length < charsPerChunk) {
      currentChunk += paragraph + '\n\n';
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = paragraph + '\n\n';
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());

  return chunks;
}

/**
 * Summarize a chunk of text
 * @param {string} chunk - Text chunk to summarize
 * @param {string} apiKey - OpenRouter API key
 * @param {string} model - Model to use
 * @returns {Promise<string>} Summary of the chunk
 */
async function summarizeChunk(chunk, apiKey, model) {
  const response = await axios.post(
    OPENROUTER_API_URL,
    {
      model: model,
      messages: [
        {
          role: 'user',
          content: `Summarize this excerpt from a book, focusing on characters, plot events, world-building details, and key information:\n\n${chunk}`
        }
      ]
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Chatbot Maker'
      }
    }
  );

  return response.data.choices[0].message.content;
}

/**
 * Analyze book text and extract characters and world information
 * @param {string} bookText - The book text or summary
 * @param {string} apiKey - OpenRouter API key
 * @param {string} model - Model to use (default: anthropic/claude-3.5-sonnet)
 * @param {number} contextLength - Model's context window size
 * @param {string} sessionId - Session ID for progress tracking
 * @param {Function} updateProgress - Progress update callback function
 * @returns {Promise<Object>} Analysis result with characters and world info
 */
export async function analyzeBook(bookText, apiKey, model = 'anthropic/claude-3.5-sonnet', contextLength = 200000, sessionId = null, updateProgress = null) {
  // Calculate safe chunk size (leave room for prompt and response)
  const safeContextSize = Math.floor(contextLength * 0.5); // Use 50% for input
  const maxCharsForInput = safeContextSize * 4; // Approximate char to token ratio

  console.log(`Book size check: ${bookText.length} chars, max allowed: ${maxCharsForInput} chars`);

  let textToAnalyze = bookText;

  // If text is too large, chunk and summarize first
  if (bookText.length > maxCharsForInput) {
    console.log(`Book text too large (${bookText.length} chars). Chunking and summarizing...`);
    if (updateProgress && sessionId) {
      updateProgress(sessionId, `Book too large, chunking into smaller pieces...`);
    }

    const chunks = chunkText(bookText, Math.floor(safeContextSize * 0.8));
    console.log(`Split into ${chunks.length} chunks`);

    // Summarize each chunk
    const summaries = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Summarizing chunk ${i + 1}/${chunks.length}...`);
      const summary = await summarizeChunk(chunks[i], apiKey, model);
      summaries.push(summary);
    }

    // Combine summaries
    textToAnalyze = summaries.join('\n\n---\n\n');
    console.log(`Combined summary length: ${textToAnalyze.length} chars`);

    // If still too large, summarize the summaries
    if (textToAnalyze.length > maxCharsForInput) {
      console.log('Combined summary still too large. Creating final summary...');
      const finalSummary = await summarizeChunk(textToAnalyze, apiKey, model);
      textToAnalyze = finalSummary;
    }
  }

  const prompt = `Analyze this book text and extract detailed information about the characters and world. Respond with ONLY valid JSON.

Book Text:
${textToAnalyze}

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
      "scenario": "Scenario when meeting {{user}}. Replace interaction partner name with {{user}}",
      "firstMessages": [
        "Opening message 1. Use quotes for dialogue and asterisks for actions",
        "Opening message 2 with different tone",
        "Opening message 3"
      ],
      "exampleDialogue": "4-6 short exchanges. Use {{user}} for other person. Use quotes for speech, asterisks for actions",
      "tags": ["5-15 tags: gender, genre, personality, role"],
      "canBePersona": true
    }
  ],
  "worldInfo": {
    "setting": "World description",
    "locations": [{"name": "Location", "description": "Details"}],
    "factions": [{"name": "Faction", "description": "Details"}],
    "items": [{"name": "Item", "description": "Details"}],
    "concepts": [{"name": "Concept", "description": "Explanation"}]
  }
}

Instructions:
- Extract 3-10 main characters
- Aim for ~3000 tokens per character
- Replace interaction partner names with {{user}} in scenarios/messages/dialogue
- Use quotes for dialogue, asterisks for actions in messages
- Mark main characters with canBePersona: true
- Return ONLY JSON, no other text`;

  try {
    console.log('Sending analysis request to OpenRouter...');
    console.log('Model:', model);
    console.log('Text length:', textToAnalyze.length, 'characters');
    console.log('API Key present:', !!apiKey);
    if (updateProgress && sessionId) {
      updateProgress(sessionId, `Sending ${textToAnalyze.length.toLocaleString()} characters to AI (${model})...`);
    }
    
    const requestBody = {
      model: model,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      stream: false, // Explicitly disable streaming
      max_tokens: 8000 // Limit response size to prevent huge responses
    };
    
    console.log('Request body prepared, sending to OpenRouter...');
    console.log('Request URL:', OPENROUTER_API_URL);
    console.log('Prompt length:', prompt.length);
    console.log('Total payload size:', JSON.stringify(requestBody).length, 'bytes');
    console.log('Making axios POST request NOW...');
    
    // Add a heartbeat to show the process is alive while waiting
    const heartbeatInterval = setInterval(() => {
      console.log('Still waiting for OpenRouter response... (heartbeat)');
    }, 10000); // Every 10 seconds
    
    let response;
    try {
      response = await axios.post(
        OPENROUTER_API_URL,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Chatbot Maker'
          },
          timeout: 300000, // 5 minute timeout for large books
          validateStatus: (status) => {
            console.log('Received status code:', status);
            return status >= 200 && status < 300;
          },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
              console.log(`Upload progress: ${percent}%`);
            }
          },
          onDownloadProgress: (progressEvent) => {
            // Only log every 10KB to reduce spam
            if (progressEvent.loaded % 10000 < 1000) {
              console.log(`Download progress: ${(progressEvent.loaded / 1024).toFixed(1)} KB received`);
            }
          }
        }
      );
      console.log('Axios call completed');
      clearInterval(heartbeatInterval);
    } catch (axiosError) {
      clearInterval(heartbeatInterval);
      console.error('Axios request failed with error:', axiosError.message);
      console.error('Error code:', axiosError.code);
      console.error('Error config:', axiosError.config?.url);
      throw axiosError;
    }
    
    console.log('Response received successfully');
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);
    console.log('Response data keys:', Object.keys(response.data || {}));
    console.log('Response data:', JSON.stringify(response.data).substring(0, 500)); // First 500 chars

    console.log('Received response from OpenRouter');
    
    // Validate response structure
    if (!response.data) {
      console.error('ERROR: No data in response');
      throw new Error('No data received from AI service');
    }
    
    console.log('Checking for choices array...');
    if (!response.data.choices || !Array.isArray(response.data.choices) || response.data.choices.length === 0) {
      console.error('Invalid response structure. Full response:', JSON.stringify(response.data, null, 2));
      throw new Error('AI response missing choices array');
    }
    
    console.log('Found', response.data.choices.length, 'choices');
    console.log('First choice structure:', Object.keys(response.data.choices[0]));
    
    if (!response.data.choices[0].message || !response.data.choices[0].message.content) {
      console.error('Invalid message structure. First choice:', JSON.stringify(response.data.choices[0], null, 2));
      throw new Error('AI response missing message content');
    }
    
    const content = response.data.choices[0].message.content;
    console.log('Response content length:', content.length);
    console.log('Content preview:', content.substring(0, 200));
    if (updateProgress && sessionId) {
      updateProgress(sessionId, `Received response (${content.length.toLocaleString()} characters), parsing...`);
    }
    
    const analysis = JSON.parse(content);
    console.log('Successfully parsed JSON response');

    // Validate the response structure
    if (!analysis.characters || !Array.isArray(analysis.characters)) {
      console.error('Invalid response: missing or invalid characters array');
      throw new Error('AI response missing characters array');
    }

    if (!analysis.worldInfo) {
      console.warn('AI response missing worldInfo, using empty structure');
      analysis.worldInfo = {
        setting: '',
        locations: [],
        factions: [],
        items: [],
        concepts: []
      };
    }

    if (!analysis.bookTitle) {
      console.warn('AI response missing bookTitle');
      analysis.bookTitle = 'Unknown Book';
    }

    console.log(`Parsed ${analysis.characters.length} characters`);
    if (updateProgress && sessionId) {
      updateProgress(sessionId, `Parsed ${analysis.characters.length} characters from AI response`);
    }

    return analysis;
  } catch (error) {
    console.error('AI analysis error:', error.message);
    if (error.code === 'ECONNABORTED') {
      throw new Error('AI request timed out. The book may be too large or the AI service is slow. Try a smaller book or try again later.');
    }
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      const errorMsg = error.response.data?.error?.message || error.response.data?.error || error.response.statusText;
      throw new Error(`AI service error: ${errorMsg}`);
    }
    if (error.request) {
      console.error('No response received from AI service');
      throw new Error('No response from AI service. Check your internet connection and API key.');
    }
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}
