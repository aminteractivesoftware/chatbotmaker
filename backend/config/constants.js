// Centralized backend constants

export const DEFAULT_API_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_CONTEXT_LENGTH = 200000;
export const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';

// Token estimation: 1 token ≈ 4 characters
export const CHARS_PER_TOKEN = 4;

// Use 50% of context for input, leaving room for prompt + response
export const CONTEXT_INPUT_RATIO = 0.5;

// Chunk sizing: use 80% of safe context for each chunk
export const CHUNK_FILL_RATIO = 0.8;

// AI request limits
export const MAX_RESPONSE_TOKENS = 8000;
export const AI_REQUEST_TIMEOUT_MS = 300000; // 5 minutes
export const CONNECTION_TEST_TIMEOUT_MS = 15000;

// File upload limits
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const SUPPORTED_EXTENSIONS = ['.epub', '.mobi'];
