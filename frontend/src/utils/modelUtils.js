/**
 * Check if a model is free based on its pricing data.
 * Handles OpenRouter format (string "0") and standard format (number 0).
 * @param {Object} model - Model object with optional pricing property
 * @returns {boolean}
 */
export function isModelFree(model) {
  if (!model) return false;
  const p = model.pricing;
  if (!p) return model.id?.includes(':free') || model.id?.includes('free');
  const promptFree = p.prompt === '0' || p.prompt === 0;
  const completionFree = p.completion === '0' || p.completion === 0;
  return (promptFree && completionFree) || model.id?.includes(':free');
}
