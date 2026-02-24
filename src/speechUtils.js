export const applySkippingRules = (text, speechCustomization) => {
  if (!text) return text;
  let result = text;

  if (speechCustomization.skipUrls) {
    result = result.replace(/https?:\/\/\S+|www\.\S+/gi, '');
  }
  if (speechCustomization.skipSquare) {
    result = result.replace(/\[[^\]]*]/g, '');
  }
  if (speechCustomization.skipParens) {
    result = result.replace(/\([^)]*\)/g, '');
  }
  if (speechCustomization.skipCurly) {
    result = result.replace(/\{[^}]*}/g, '');
  }
  return result;
};

export const applyCustomPronunciations = (text, customPronunciations) => {
  if (!text || !customPronunciations.length) return text;
  let result = text;
  customPronunciations.forEach(rule => {
    const pattern = (rule.pattern || '').trim();
    if (!pattern) return;
    const replacement = rule.replacement || '';
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = rule.caseSensitive ? 'g' : 'gi';
    const re = new RegExp(escaped, flags);
    result = result.replace(re, replacement);
  });
  return result;
};

export const buildSpokenText = (rawText, speechCustomization, customPronunciations) => {
  let text = applySkippingRules(rawText, speechCustomization);
  text = applyCustomPronunciations(text, customPronunciations);
  return text;
};
