
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
const regexAPA = new RegExp(regexStr, 'gu'); // removed 'i' to enforce capitalization rules

const negLookahead = `(?!(?:(?:\\s|\\p{P})*(?:${excludeWords}))\\b)`;
const singleMLA = `(?:(?:${authors})\\s+\\d+(?:-\\d+)?)`;
const regexStrMLA = `\\(\\s*${negLookahead}(?:${singleMLA}\\s*(?:;\\s*${singleMLA}\\s*)*)\\)`;
const regexMLA = new RegExp(regexStrMLA, 'gu');
const regexIEEE = /\[\s*\d+(?:\s*(?:,|–|-)\s*\d+)*\s*\]/g;


const testCases = {
  ieee: {
    regex: regexIEEE,
    truePositives: [
      "[1]",
      "[1, 2]",
      "[1,2,3]",
      "[1-5]",
      "[1, 3-5]",
      "[ 12 , 15-20 ]"
    ],
    falsePositives: [
      "[Note 1]",
      "[see 1]",
      "[1a]",
      "[ 1, 2, text ]",
      "[text]"
    ]
  },
  apa: {
    regex: regexAPA ,
    truePositives: [
      "(Smith, 2020)",
      "(Smith & Jones, 2020)",
      "(Smith and Jones, 2020)",
      "(Smith et al., 2020)",
      "(Smith, 2020, p. 15)",
      "(Smith et al., 2020, pp. 15-20)",
      "(O'Connor, 2020)",
      "(Smith-Jones, 2020)",
      "(van Rossum, 2020)",
      "(1994)",
      "(Ross and Hannan 2007; Unger and Van Waarden 2009; Helgesson and Mörth 2016; McCarthy et al. 2015)",
      "(Pettersson Ruiz and Angelis 2022; Alotibi et al. 2022; Jensen and Iosifidis 2023; Lokanan 2024; Zhiyuan Chen et al. 2018)",
      "(Y. Xu and Ni 2022)",
      "(Helgesson and Mörth 2016)",
      "(Bao, Ni, and Singh 2018)",
      "(Zheng, Birge, et al. 2025)",
      "(Bao, Ni, and, Singh 2018)",
      "(2022; 2024)",
      "(Spring, 2020)",
      "(Spring 2020)",
      "(August et al. 2025; Fan et al. 2025; Cecchini et al. 2010; Xiao et al. 2023)",
      "(Zheng, Zhengzhang Chen, H. Chen, et al. 2024; Zheng, Zhengzhang Chen, He, et al. 2024)",
    ],
    falsePositives: [
      "(This was discovered in 2020)",
      "(see Figure 1)",
      "(199.3)",
      "(1943.0)",
    ]
  },
  mla: {
    regex: regexMLA,
    truePositives: [
      "(Smith 15)",
      "(Smith and Jones 15)",
      "(Smith et al. 15)",
      "(Smith 15-20)"
      
    ],
    falsePositives: [
      "(Section 15)",
      "(Figure 15)",
      "(January 15)",
      "(Chapter 15)",
      "(Table 15)",
      "(Page 15)",
      "(Step 15)"
      "(13.5 cm)",
      "(12.4)",
      "(5,234)",
    ]
  }
};

let allPassed = true;

for (const [type, data] of Object.entries(testCases)) {
  console.log(`\nTesting ${type}...`);
  data.truePositives.forEach(tp => {
    const match = tp.match(data.regex);
    if (!match || match[0] !== tp) {
      console.error(`❌ FAILED (True Positive missed): ${tp}`);
      allPassed = false;
    } else {
      console.log(`✅ Passed (TP): ${tp}`);
    }
  });

  data.falsePositives.forEach(fp => {
    const match = fp.match(data.regex);
    if (match) {
      console.error(`❌ FAILED (False Positive matched): ${fp}`);
      allPassed = false;
    } else {
      console.log(`✅ Passed (FP ignored): ${fp}`);
    }
  });
}

if (allPassed) {
  console.log("\n🎉 All tests passed!");
} else {
  console.log("\n💥 Some tests failed.");
}
