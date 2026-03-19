const excludeWordsList = "January|February|March|April|May|June|July|August|September|October|November|December|Spring|Summer|Fall|Autumn|Winter|Section|Figure|Table|Chapter|Page|Step|Part|User|This|That|These|Those|It|We|They|He|She|See|For|Example|Eg|Ie|In|On|At|To|From|By|With|As|And|Or|But|If|When|Where|Why|How|The|A|An|Some|Any|Many|Much|Few|All|None|Every|Each|Both|Neither|Either|Such|What|Which|Who|Whom|Whose|Why|How|Where|When".split("|");
const excludeWords = excludeWordsList.map(w => w).concat(excludeWordsList.map(w => w.toLowerCase())).join("|");
const negLookahead = `(?!(?:(?:\\s|\\p{P})*(?:${excludeWords}))\\b)`;

const prefix = `(?:van|von|de|di|le|la|d'|del|du|dos|das|ten|ter|mac|mc|al)\\s+`;
const capWord = `[\\p{Lu}][\\p{L}\\p{M}\\-']*`;
const initial = `[\\p{Lu}]\\.`;
const singleName = `(?:(?:${prefix})?(?:${capWord}|${initial}))`;
const personName = `${singleName}(?:\\s+${singleName}){0,3}`;
const authors = `${personName}(?:\\s*(?:,|and|&)\\s*${personName})*(?:\\s+et\\s+al\\.?)?`;
const singleMLA = `(?:(?:${authors})\\s+\\d+(?:-\\d+)?)`;
const regexStrMLA = `\\(\\s*${negLookahead}(?:${singleMLA}\\s*(?:;\\s*${singleMLA}\\s*)*)\\)`;
const regexMLA = new RegExp(regexStrMLA, 'gu');

console.log('Testing MLA...');
[
  '(Smith 15)',
  '(Smith and Jones 15)',
  '(Smith et al. 15)',
  '(Smith 15-20)',
  '(van Rossum 15)',
  "(O'Connor 15)",
  '(Mörth 15)',
  '(Zhiyuan Chen 15)',
  '(Smith 15; Jones 20)'
].forEach(t => console.log('TP', t, !!t.match(regexMLA)));

[
  '(Section 15)',
  '(Figure 15)',
  '(January 15)',
  '(Chapter 15)',
  '(Table 15)',
  '(Page 15)',
  '(Step 15)',
  '(My discovery 15)',
  '(hello 15)'
].forEach(t => console.log('FP', t, !!t.match(regexMLA)));
