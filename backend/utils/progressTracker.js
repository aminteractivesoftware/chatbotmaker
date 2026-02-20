import logger from './logger.js';

// Simple in-memory progress tracker
const progressStore = new Map();

export function updateProgress(sessionId, message) {
  progressStore.set(sessionId, { message, timestamp: Date.now() });
  logger.debug(`[Progress ${sessionId}]: ${message}`);
}

export function getProgress(sessionId) {
  return progressStore.get(sessionId);
}

export function clearProgress(sessionId) {
  progressStore.delete(sessionId);
}
