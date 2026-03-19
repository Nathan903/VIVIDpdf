
const excludeWordsList = "January|February|March|April|May|June|July|August|September|October|November|December|Spring|Summer|Fall|Autumn|Winter|Section|Figure|Table|Chapter|Page|Step|Part|User|This|That|These|Those|It|We|They|He|She|See|For|Example|Eg|Ie|In|On|At|To|From|By|With|As|And|Or|But|If|When|Where|Why|How|The|A|An|Some|Any|Many|Much|Few|All|None|Every|Each|Both|Neither|Either|Such|What|Which|Who|Whom|Whose|Why|How|Where|When".split("|");
const excludeWords = excludeWordsList.map(w => w).concat(excludeWordsList.map(w => w.toLowerCase())).join("|");

// Use case-insensitive for the exclusion list, just to be safe, though our pattern matches capitalized words anyway.
const negativeLookahead =""; `(?!(?:${excludeWords})\\b)`;
const prefix = `(?:van|von|de|di|le|la|d'|del|du|dos|das|ten|ter|mac|mc|al)\\s+`;
const capWord = `[\\p{Lu}][\\p{L}\\p{M}\\-']*`;
const initial = `[\\p{Lu}]\\.`;
const singleName = `(?:(?:${prefix})?(?:${capWord}|${initial}))`;
const personName = `${singleName}(?:\\s+${singleName}){0,3}`;
// An author can be one person, or multiple separated by commas and "and"/"&"
const authorSeparator = `(?:[\\s,]*(?:and|&)[\\s,]+|,\\s*)`;
const authors = `${personName}(?:${authorSeparator}${personName})*(?:[\\s,]*et\\s+al\\.?)?`;
const singleCitation = `(?:(?:${authors})[,\\s]+)?(?:19|20)\\d{2}[a-z]?(?:[,\\s]*(?:p|pp)\\.?\\s*\\d+(?:-\\d+)?)?`;
const regexStr = `\\(\\s*${negativeLookahead}(?:${singleCitation}\\s*(?:;\\s*${singleCitation}\\s*)*)\\)`;
export const APA_REGEX = new RegExp(regexStr, 'gu'); // removed 'i' to enforce capitalization rules

const negLookahead = `(?!(?:(?:\\s|\\p{P})*(?:${excludeWords}))\\b)`;
const singleMLA = `(?:(?:${authors})\\s+\\d+(?:-\\d+)?)`;
const regexStrMLA = `\\(\\s*${negLookahead}(?:${singleMLA}\\s*(?:;\\s*${singleMLA}\\s*)*)\\)`;
export const MLA_REGEX = new RegExp(regexStrMLA, 'gu');
export const IEEE_REGEX = /\[\s*\d+(?:\s*(?:,|–|-)\s*\d+)*\s*\]/g;
export const URL_REGEX = /(?:https?:\/\/|www\.)[^\s()<>]+(?:\([^\s()<>]*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’])/gi;

export const applySkippingRules = (text, speechCustomization) => {
  if (!text) return text;
  let result = text;

  if (speechCustomization.skipUrls) {
    result = result.replace(URL_REGEX, '');
  }
  if (speechCustomization.skipEmails) {
    result = result.replace(/[\w.-]+@[\w.-]+\.\w+/gi, '');
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
  if (speechCustomization.skipCitations) {
    result = result.replace(IEEE_REGEX, '');
    result = result.replace(APA_REGEX, '');
    result = result.replace(MLA_REGEX, '');
  }
  return result;
};

export const containsSkippableItem = (text) => {
  if (!text) return false;
  // Create a non-global version for .test() if needed, or just use the same one
  // (Note: .test() with global regex maintains lastIndex, so it's safer to use non-global or reset)
  const urlRe = new RegExp(URL_REGEX.source, 'i');
  return (
    urlRe.test(text) ||
    /[\w.-]+@[\w.-]+\.\w+/i.test(text) ||
    /\[[^\]]*]/.test(text) ||
    /\([^)]*\)/.test(text) ||
    /\{[^}]*}/.test(text) ||
    new RegExp(IEEE_REGEX.source, 'i').test(text) ||
    new RegExp(APA_REGEX.source, 'i').test(text) ||
    new RegExp(MLA_REGEX.source, 'i').test(text)
  );
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
