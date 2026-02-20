import { useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

/**
 * Custom hook for polling backend progress updates.
 * Automatically cleans up on unmount to prevent memory leaks.
 *
 * @param {Function} onMessage - Callback when a new progress message arrives
 * @param {number} intervalMs - Polling interval in milliseconds
 * @returns {{ start: (sessionId: string) => void, stop: () => void }}
 */
export default function useProgressPolling(onMessage, intervalMs = 2000) {
  const intervalRef = useRef(null);
  const lastMessageRef = useRef('');

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    lastMessageRef.current = '';
  }, []);

  const start = useCallback((sessionId) => {
    stop(); // clear any existing interval
    intervalRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`/api/process/progress/${sessionId}`);
        const msg = res.data?.message;
        if (msg && msg !== lastMessageRef.current) {
          lastMessageRef.current = msg;
          onMessage(msg);
        }
      } catch {
        // Progress polling is optional — swallow errors
      }
    }, intervalMs);
  }, [onMessage, intervalMs, stop]);

  // Cleanup on unmount
  useEffect(() => stop, [stop]);

  return { start, stop };
}
