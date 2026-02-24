// pronunciationUtils.js

/**
 * Replaces text based on user-defined custom pronunciation rules.
 * @param {string} text - The original transcript text.
 * @param {Array} rules - Array of rules: { original, target, caseSensitive }.
 * @returns {string} - The text with pronunciations applied.
 */
export const applyCustomPronunciation = (text, rules) => {
  if (!text || !rules || rules.length === 0) return text;

  let result = text;
  // Sort by length descending to ensure longer phrases are replaced first
  const sortedRules = [...rules].sort((a, b) => b.original.length - a.original.length);

  sortedRules.forEach(rule => {
    if (!rule.original.trim()) return;
    
    try {
      // Escape regex special characters
      const escaped = rule.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = rule.caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(escaped, flags);
      
      result = result.replace(regex, rule.target);
    } catch (e) {
      console.error("Pronunciation replacement error:", e);
    }
  });

  return result;
};
