const excludeWords = "January|February|March|April|May|June|July|August|September|October|November|December|Spring|Summer|Fall|Autumn|Winter|Section|Figure|Table|Chapter|Page|Step|Part|User|This|That|These|Those|It|We|They|He|She|See|For|Example|Eg|Ie|In|On|At|To|From|By|With|As|And|Or|But|If|When|Where|Why|How|The|A|An|Some|Any|Many|Much|Few|All|None|Every|Each|Both|Neither|Either|Such|What|Which|Who|Whom|Whose|Why|How|Where|When";

// Use case-insensitive for the exclusion list, just to be safe, though our pattern matches capitalized words anyway.
const negativeLookahead = `(?!(?:${excludeWords})\\b)`;

// Let's create a better APA regex.
// Single author block allows letters, dots, hyphens, spaces, apostrophes, &, "and", "et al."
// Year block: 19xx or 20xx optionally followed by a-z
// Pages block: optional p. or pp. followed by digits
// We allow multiple citations separated by semicolons.

// Actually, any text not containing numbers or parens is fine for the author block, 
// so long as the whole thing ends with a year (and optional pages).
// Wait, we can't use `[^\d()]+` blindly because that matches "This was discovered in " 
// But the negative lookahead `(?!(?:excludeWords)\b)` will reject "This".

const prefix = `(?:van|von|de|di|le|la|d'|del|du|dos|das|ten|ter|mac|mc|al)\\s+`;
const capWord = `[\\p{Lu}][\\p{L}\\p{M}\\-']*`;
const initial = `[\\p{Lu}]\\.`;
const singleName = `(?:(?:${prefix})?(?:${capWord}|${initial}))`;
const personName = `${singleName}(?:\\s+${singleName}){0,3}`;

// An author can be one person, or multiple separated by commas and "and"/"&"
const authors = `${personName}(?:\\s*(?:,|and|&)\\s*${personName})*(?:\\s+et\\s+al\\.?)?`;
const singleCitation = `(?:(?:${authors})[,\\s]+)?(?:19|20)\\d{2}[a-z]?(?:[,\\s]*(?:p|pp)\\.?\\s*\\d+(?:-\\d+)?)?`;
const regexStr = `\\(\\s*${negativeLookahead}(?:${singleCitation}\\s*(?:;\\s*${singleCitation}\\s*)*)\\)`;
const regex = new RegExp(regexStr, 'gu'); // removed 'i' to enforce capitalization rules

const tests = [
  '(Smith, 2020)',
  '(Smith & Jones, 2020)',
  '(Smith and Jones, 2020)',
  '(Smith et al., 2020)',
  '(Smith, 2020, p. 15)',
  '(Smith et al., 2020, pp. 15-20)',
  "(O'Connor, 2020)",
  '(Smith-Jones, 2020)',
  '(van Rossum, 2020)',
  '(1994)',
  '(Ross and Hannan 2007; Unger and Van Waarden 2009; Helgesson and Mörth 2016; McCarthy et al. 2015)',
  '(Pettersson Ruiz and Angelis 2022; Alotibi et al. 2022; Jensen and Iosifidis 2023; Lokanan 2024; Zhiyuan Chen et al. 2018)',
  '(Y. Xu and Ni 2022)'
];

const falseTests = [
  '(This was discovered in 2020)',
  '(see Figure 1)',
  '(January 2020)',
  '(Spring 2020)',
  '(My discovery in 2020)',
  '(hello 2020)'
];

tests.forEach(t => console.log('TP', t, !!t.match(regex)));
falseTests.forEach(t => console.log('FP', t, !!t.match(regex)));