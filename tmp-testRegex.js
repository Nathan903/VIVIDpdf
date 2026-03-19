const excludeWords = "January|February|March|April|May|June|July|August|September|October|November|December|Spring|Summer|Fall|Autumn|Winter|Section|Figure|Table|Chapter|Page|Step|Part|User|This|That|These|Those|It|We|They|He|She|See|For|Example|Eg|Ie|In|On|At|To|From|By|With|As|And|Or|But|If|When|Where|Why|How|The|A|An|Some|Any|Many|Much|Few|All|None|Every|Each|Both|Neither|Either|Such|What|Which|Who|Whom|Whose|Why|How|Where|When";

// Use case-insensitive for the exclusion list, just to be safe, though our pattern matches capitalized words anyway.
const negativeLookahead = `(?!(?:${excludeWords})\\b)`;

const testCases = {
  ieee: {
    regex: /\[\s*\d+(?:\s*(?:,|–|-)\s*\d+)*\s*\]/g,
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
    regex: new RegExp(`\\(\\s*${negativeLookahead}(?:[A-Z][A-Za-z'-]+\\s*(?:(?:and|&)\\s*${negativeLookahead}[A-Z][A-Za-z'-]+\\s*)?(?:et al\\.?[,\\s]*)?)+[\\s,;]+(?:19|20)\\d{2}[a-z]?(?:[\\s,;]+(?:p|pp)\\.?\\s*\\d+(?:-\\d+)?)?\\s*\\)`, 'g'),
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
    ],
    falsePositives: [
      "(This was discovered in 2020)",
      "(see Figure 1)",
      "(January 2020)",
      "(Spring 2020)",
      "(199.3)",
      "(1943.0)",
    ]
  },
  mla: {
    regex: new RegExp(`\\(\\s*${negativeLookahead}(?:[A-Z][A-Za-z'-]+\\s*(?:(?:and|&)\\s*${negativeLookahead}[A-Z][A-Za-z'-]+\\s*)?(?:et al\\.?\\s*)?)+\\s+\\d+(?:-\\d+)?\\s*\\)`, 'g'),
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
