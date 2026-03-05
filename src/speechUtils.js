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

export const buildPronunciationRegex = (rule, globalFlag = true) => {
  const pattern = (rule.pattern || '').trim();
  if (!pattern) return null;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchType = rule.matchType || 'exact';
  let expr;
  if (matchType === 'exact') {
    expr = `\\b${escaped}\\b`;
  } else if (matchType === 'startsWith') {
    expr = `\\b${escaped}`;
  } else if (matchType === 'endsWith') {
    expr = `${escaped}\\b`;
  } else {
    expr = escaped;
  }
  const flags = (rule.caseSensitive ? '' : 'i') + (globalFlag ? 'g' : '');
  return new RegExp(expr, flags);
};

export const applyCustomPronunciations = (text, customPronunciations) => {
  if (!text || !customPronunciations.length) return text;
  let result = text;
  customPronunciations.forEach(rule => {
    const re = buildPronunciationRegex(rule, true);
    if (!re) return;
    const replacement = rule.replacement || '';
    result = result.replace(re, replacement);
  });
  return result;
};

export const buildSpokenText = (rawText, speechCustomization, customPronunciations) => {
  let text = applySkippingRules(rawText, speechCustomization);
  text = applyCustomPronunciations(text, customPronunciations);
  return text;
};
