import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { parseEpub, extractEpubCover } from '../services/fileParser.js';
import { analyzeBook, getAvailableModels, testConnection } from '../services/aiService.js';
import { generateCharacterCards, generateLorebook } from '../services/cardGenerator.js';
import { updateProgress, getProgress, clearProgress } from '../utils/progressTracker.js';
import logger from '../utils/logger.js';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_CONTEXT_LENGTH,
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_EXTENSIONS,
  CONTEXT_INPUT_RATIO,
  CHUNK_FILL_RATIO,
  CHARS_PER_TOKEN,
} from '../config/constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateFileExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return `Only ${SUPPORTED_EXTENSIONS.join(' and ')} files are supported`;
  }
  return null;
}

async function cleanupFiles(...filePaths) {
  for (const p of filePaths) {
    if (!p) continue;
    try {
      await fs.unlink(p);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        logger.error(`Failed to delete uploaded file ${p}:`, error.message);
      }
    }
  }
}

function getUploadedPaths(req) {
  const paths = [];

  if (req?.file?.path) paths.push(req.file.path);

  if (!req?.files) return paths;

  if (Array.isArray(req.files)) {
    for (const f of req.files) {
      if (f?.path) paths.push(f.path);
    }
    return paths;
  }

  for (const entry of Object.values(req.files)) {
    if (Array.isArray(entry)) {
      for (const f of entry) {
        if (f?.path) paths.push(f.path);
      }
    } else if (entry?.path) {
      paths.push(entry.path);
    }
  }

  return paths;
}

async function cleanupRequestUploads(req) {
  await cleanupFiles(...getUploadedPaths(req));
}

function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Router factory — accepts a configurable uploads path
// ---------------------------------------------------------------------------

export function createProcessRouter(uploadsPath) {
  const router = express.Router();

  const storage = multer.diskStorage({
    destination: uploadsPath,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  });

  const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE_BYTES } });

  // GET /models
  router.get('/models', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'];
      const apiBaseUrl = req.headers['x-api-base-url'] || DEFAULT_API_BASE_URL;
      if (!apiKey) return res.status(400).json({ error: 'API key is required' });

      const models = await getAvailableModels(apiKey, apiBaseUrl);
      res.json({ models });
    } catch (error) {
      logger.error('Error fetching models:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /test-connection
  router.post('/test-connection', async (req, res) => {
    try {
      const { apiBaseUrl, apiKey } = req.body;
      if (!apiKey) return res.status(400).json({ success: false, error: 'API key is required' });
      if (!apiBaseUrl) return res.status(400).json({ success: false, error: 'API base URL is required' });

      const result = await testConnection(apiBaseUrl, apiKey);
      res.json(result);
    } catch (error) {
      logger.error('Error testing connection:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /preview — parse-only stats (no AI cost)
  router.post('/preview', upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'No file uploaded' });

      const extError = validateFileExtension(file.originalname);
      if (extError) {
        await cleanupFiles(file.path);
        return res.status(400).json({ error: extError });
      }

      const epubData = await parseEpub(file.path);
      const contextLength = parseInt(req.body.contextLength) || DEFAULT_CONTEXT_LENGTH;

      const safeContextSize = Math.floor(contextLength * CONTEXT_INPUT_RATIO);
      const maxCharsForInput = safeContextSize * CHARS_PER_TOKEN;
      const charsPerChunk = Math.floor(safeContextSize * CHUNK_FILL_RATIO) * CHARS_PER_TOKEN;

      const textLength = epubData.text.length;
      const estimatedTokens = Math.ceil(textLength / CHARS_PER_TOKEN);
      const chapterCount = epubData.chapters?.length || 1;
      const fitsInContext = textLength <= maxCharsForInput;

      let estimatedChunks = 1;
      if (!fitsInContext) {
        let currentSize = 0;
        estimatedChunks = 1;
        for (const ch of (epubData.chapters || [])) {
          const chLen = ch.text.length + (ch.title ? ch.title.length + 10 : 0);
          if (chLen > charsPerChunk) {
            if (currentSize > 0) estimatedChunks++;
            estimatedChunks += Math.ceil(chLen / charsPerChunk);
            currentSize = 0;
          } else if (currentSize + chLen > charsPerChunk) {
            estimatedChunks++;
            currentSize = chLen;
          } else {
            currentSize += chLen;
          }
        }
      }

      const totalRequests = fitsInContext ? 1 : estimatedChunks + 1;

      await cleanupFiles(file.path);

      res.json({
        fileName: file.originalname,
        textLength,
        estimatedTokens,
        chapterCount,
        fitsInContext,
        estimatedChunks: fitsInContext ? 0 : estimatedChunks,
        totalRequests,
        contextLength,
      });
    } catch (error) {
      logger.error('Error previewing file:', error.message);
      if (req.file) await cleanupFiles(req.file.path);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /progress/:sessionId
  router.get('/progress/:sessionId', (req, res) => {
    const progress = getProgress(req.params.sessionId);
    res.json(progress || { message: 'No progress available', timestamp: Date.now() });
  });

  // POST /file — full EPUB processing pipeline
  router.post('/file', upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]), async (req, res) => {
    const sessionId = req.body.sessionId || generateSessionId();

    try {
      updateProgress(sessionId, 'Starting file processing...');

      const { apiKey, model, contextLength, useCoverFromEpub, apiBaseUrl } = req.body;
      const file = req.files?.file?.[0];
      const coverImage = req.files?.coverImage?.[0];

      if (!file) {
        await cleanupRequestUploads(req);
        return res.status(400).json({ error: 'No file uploaded' });
      }
      if (!apiKey) {
        await cleanupRequestUploads(req);
        return res.status(400).json({ error: 'API key is required' });
      }

      const extError = validateFileExtension(file.originalname);
      if (extError) {
        await cleanupRequestUploads(req);
        return res.status(400).json({ error: extError });
      }

      logger.info(`Processing: ${file.originalname}, model: ${model}`);

      // Parse EPUB
      updateProgress(sessionId, 'Parsing EPUB file...');
      const epubData = await parseEpub(file.path);
      const bookText = epubData.text;
      logger.info(`EPUB parsed: ${bookText.length} chars`);
      updateProgress(sessionId, `EPUB parsed (${bookText.length.toLocaleString()} characters)`);

      // Cover image
      updateProgress(sessionId, 'Processing cover image...');
      let coverImageBase64 = null;
      if (useCoverFromEpub === 'true' && epubData.hasCover) {
        const coverBuffer = await extractEpubCover(file.path);
        coverImageBase64 = coverBuffer.toString('base64');
      } else if (coverImage) {
        const coverBuffer = await fs.readFile(coverImage.path);
        coverImageBase64 = coverBuffer.toString('base64');
      }

      // AI analysis
      updateProgress(sessionId, 'Analyzing book with AI... This may take a few minutes.');
      const contextSize = parseInt(contextLength) || DEFAULT_CONTEXT_LENGTH;
      const providerUrl = apiBaseUrl || DEFAULT_API_BASE_URL;
      const analysis = await analyzeBook(bookText, apiKey, model, contextSize, sessionId, updateProgress, providerUrl, epubData.chapters);
      updateProgress(sessionId, `AI analysis complete - found ${analysis.characters?.length || 0} characters`);

      // Generate outputs
      updateProgress(sessionId, 'Generating character cards and lorebook...');

      if (!analysis.characters?.length) throw new Error('No characters found in book analysis');

      const characterCards = generateCharacterCards(analysis.characters, coverImageBase64);
      const lorebook = generateLorebook(analysis.worldInfo || {});
      logger.info(`Generated ${characterCards.length} cards, ${lorebook.entries.length} lorebook entries`);

      if (!characterCards.length) throw new Error('Failed to generate character cards');
      if (!lorebook?.entries) throw new Error('Failed to generate lorebook');

      // Cleanup
      await cleanupFiles(file.path, coverImage?.path);

      updateProgress(sessionId, 'Complete! Sending results...');
      clearProgress(sessionId);

      res.json({
        characters: characterCards,
        lorebook,
        bookTitle: analysis.bookTitle,
        coverImage: coverImageBase64,
        sessionId,
      });
    } catch (error) {
      await cleanupRequestUploads(req);
      logger.error('Error processing file:', error.message);
      clearProgress(sessionId);
      res.status(500).json({ error: error.message || 'An error occurred during processing' });
    }
  });

  // POST /summary — text summary processing
  router.post('/summary', upload.single('coverImage'), async (req, res) => {
    try {
      const { summary, apiKey, model, contextLength, apiBaseUrl } = req.body;
      const coverImage = req.file;

      if (!summary) return res.status(400).json({ error: 'Summary text is required' });
      if (!apiKey) return res.status(400).json({ error: 'API key is required' });

      let coverImageBase64 = null;
      if (coverImage) {
        const coverBuffer = await fs.readFile(coverImage.path);
        coverImageBase64 = coverBuffer.toString('base64');
      }

      const contextSize = parseInt(contextLength) || DEFAULT_CONTEXT_LENGTH;
      const providerUrl = apiBaseUrl || DEFAULT_API_BASE_URL;
      const analysis = await analyzeBook(summary, apiKey, model, contextSize, null, null, providerUrl);

      const characterCards = generateCharacterCards(analysis.characters, coverImageBase64);
      const lorebook = generateLorebook(analysis.worldInfo);

      if (coverImage) await cleanupFiles(coverImage.path);

      res.json({
        characters: characterCards,
        lorebook,
        bookTitle: analysis.bookTitle,
        coverImage: coverImageBase64,
      });
    } catch (error) {
      await cleanupFiles(req.file?.path);
      logger.error('Error processing summary:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

// Default export for backward compatibility (standalone node server.js usage)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRouter = createProcessRouter(path.resolve(__dirname, '..', 'uploads'));
export default defaultRouter;
