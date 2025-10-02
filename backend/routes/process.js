import express from 'express';
import multer from 'multer';
import path from 'path';
import { parseEpub, extractEpubCover } from '../services/fileParser.js';
import { analyzeBook, getAvailableModels } from '../services/aiService.js';
import { generateCharacterCards, generateLorebook } from '../services/cardGenerator.js';
import { updateProgress, getProgress, clearProgress } from '../utils/progressTracker.js';
import fs from 'fs/promises';

const router = express.Router();

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Get available models
router.get('/models', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const models = await getAvailableModels(apiKey);
    res.json({ models });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get progress for a session
router.get('/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const progress = getProgress(sessionId);
  
  if (progress) {
    res.json(progress);
  } else {
    res.json({ message: 'No progress available', timestamp: Date.now() });
  }
});

// Process uploaded file
router.post('/file', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 }
]), async (req, res) => {
  // Use client-provided sessionId or generate one
  const sessionId = req.body.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    console.log('Processing file upload request with sessionId:', sessionId);
    updateProgress(sessionId, 'Starting file processing...');
    
    const { apiKey, model, contextLength, useCoverFromEpub } = req.body;
    const file = req.files?.file?.[0];
    const coverImage = req.files?.coverImage?.[0];

    if (!file) {
      console.error('No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!apiKey) {
      console.error('API key missing');
      return res.status(400).json({ error: 'API key is required' });
    }
    
    console.log(`Processing file: ${file.originalname}, model: ${model}`);

    const ext = path.extname(file.originalname).toLowerCase();

    if (ext !== '.epub' && ext !== '.mobi') {
      console.error('Invalid file type:', ext);
      return res.status(400).json({ error: 'Only .epub and .mobi files are supported' });
    }

    updateProgress(sessionId, 'Parsing EPUB file...');
    console.log('Parsing EPUB file...');
    const epubData = await parseEpub(file.path);
    const bookText = epubData.text;
    const textLength = bookText.length;
    console.log(`EPUB parsed, text length: ${textLength} characters`);
    updateProgress(sessionId, `EPUB parsed (${textLength.toLocaleString()} characters)`);

    // Handle cover image
    updateProgress(sessionId, 'Processing cover image...');
    console.log('Processing cover image...');
    let coverImageBase64 = null;
    if (useCoverFromEpub === 'true' && epubData.hasCover) {
      console.log('Extracting cover from book file');
      const coverBuffer = await extractEpubCover(file.path);
      coverImageBase64 = coverBuffer.toString('base64');
    } else if (coverImage) {
      console.log('Using uploaded cover image');
      const coverBuffer = await fs.readFile(coverImage.path);
      coverImageBase64 = coverBuffer.toString('base64');
    }

    // Analyze book with AI
    updateProgress(sessionId, 'Analyzing book with AI... This may take a few minutes.');
    console.log('Starting AI analysis...');
    const contextSize = parseInt(contextLength) || 200000;
    const analysis = await analyzeBook(bookText, apiKey, model, contextSize, sessionId, updateProgress);
    console.log('AI analysis complete');
    updateProgress(sessionId, `AI analysis complete - found ${analysis.characters?.length || 0} characters`);

    // Generate character cards and lorebook
    updateProgress(sessionId, 'Generating character cards and lorebook...');
    console.log('Generating character cards and lorebook...');
    
    if (!analysis.characters || !Array.isArray(analysis.characters) || analysis.characters.length === 0) {
      throw new Error('No characters found in book analysis');
    }
    
    const characterCards = generateCharacterCards(analysis.characters, coverImageBase64);
    console.log(`Generated ${characterCards.length} character cards`);
    updateProgress(sessionId, `Generated ${characterCards.length} character cards`);
    
    const lorebook = generateLorebook(analysis.worldInfo || {});
    console.log(`Generated lorebook with ${lorebook.entries.length} entries`);
    updateProgress(sessionId, `Generated lorebook with ${lorebook.entries.length} entries`);

    // Validate the output
    if (!characterCards || characterCards.length === 0) {
      throw new Error('Failed to generate character cards');
    }

    if (!lorebook || !lorebook.entries) {
      throw new Error('Failed to generate lorebook');
    }

    // Cleanup uploaded files
    await fs.unlink(file.path).catch(() => {});
    if (coverImage) {
      await fs.unlink(coverImage.path).catch(() => {});
    }

    updateProgress(sessionId, 'Complete! Sending results...');
    console.log('Processing complete, sending response');
    
    const responseData = {
      characters: characterCards,
      lorebook,
      bookTitle: analysis.bookTitle,
      coverImage: coverImageBase64,
      sessionId
    };
    
    clearProgress(sessionId);
    res.json(responseData);

  } catch (error) {
    console.error('Error processing file:', error);
    console.error('Stack trace:', error.stack);
    clearProgress(sessionId);
    res.status(500).json({ error: error.message || 'An error occurred during processing' });
  }
});

// Process text summary
router.post('/summary', upload.single('coverImage'), async (req, res) => {
  try {
    const { summary, apiKey, model, contextLength } = req.body;
    const coverImage = req.file;

    if (!summary) {
      return res.status(400).json({ error: 'Summary text is required' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    // Handle cover image
    let coverImageBase64 = null;
    if (coverImage) {
      const coverBuffer = await fs.readFile(coverImage.path);
      coverImageBase64 = coverBuffer.toString('base64');
    }

    // Analyze summary with AI
    const contextSize = parseInt(contextLength) || 200000;
    const analysis = await analyzeBook(summary, apiKey, model, contextSize);

    // Generate character cards and lorebook
    const characterCards = generateCharacterCards(analysis.characters, coverImageBase64);
    const lorebook = generateLorebook(analysis.worldInfo);

    // Cleanup uploaded file
    if (coverImage) {
      await fs.unlink(coverImage.path).catch(() => {});
    }

    res.json({
      characters: characterCards,
      lorebook,
      bookTitle: analysis.bookTitle,
      coverImage: coverImageBase64
    });

  } catch (error) {
    console.error('Error processing summary:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
