// aiService.js

const LS_TOKEN_COUNT = 'pdf_reader_token_count';

export const getStoredTokenUsage = () => {
  return parseInt(localStorage.getItem(LS_TOKEN_COUNT) || '0', 10);
};

export const resetTokenUsage = () => {
  localStorage.setItem(LS_TOKEN_COUNT, '0');
  return 0;
};

// Simple queue to prevent browser from choking on 50 simultaneous fetch requests
class RequestQueue {
  constructor(concurrency = 3) {
    this.queue = [];
    this.active = 0;
    this.limit = concurrency;
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.next();
    });
  }

  next() {
    if (this.active >= this.limit || this.queue.length === 0) return;
    this.active++;
    const { fn, resolve, reject } = this.queue.shift();
    fn().then(resolve).catch(reject).finally(() => {
      this.active--;
      this.next();
    });
  }
}

const queue = new RequestQueue(4); // Process 4 sentences in parallel

export const fixTranscriptWithAI = async (imageDataUrl, rawText, apiKey, userInstruction) => {
  return queue.add(async () => {
    if (!apiKey) throw new Error("Missing API Key");

    const promptText = `
You are an expert TTS (Text-to-Speech) Script Pre-processor.
Your goal is to convert a raw text string extracted from a PDF into a clean, spoken-word transcript.

INPUT DATA:
1. IMAGE: Visual ground truth of the text (refer to this for subscripts, superscripts, and formulas).
2. RAW TEXT: "${rawText}" (Likely contains encoding artifacts like 'x2' for 'x squared' or merged footnote numbers).
3. USER CONSTRAINT: "${userInstruction}"

GUIDELINES:
- **Visual Verification:** Look at the image to disambiguate artifacts. If the text says "CO2" but the image shows a subscript, output "C O two".
- **Math/Formulas:** Unless told to skip, convert visual math notation into spoken English (e.g., "x^{2}" -> "x squared", "∑" -> "the sum of").
- **Cleanliness:** Remove non-spoken artifacts (e.g., page numbers, random geometrical shapes, invisible formatting chars).
- **Strict Adherence:** If the USER CONSTRAINT says "skip equations", replace them with a brief pause or silence, do not read them.

OUTPUT FORMAT:
Return valid JSON only.
{
  "transcript": "The cleaned, spoken-word string here."
}
`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o", 
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: promptText },
                { type: "image_url", image_url: { url: imageDataUrl } }
              ]
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || "API Request Failed");
      }

      const data = await response.json();
      
      // Update Token Usage
      if (data.usage) {
        const current = getStoredTokenUsage();
        const total = data.usage.total_tokens || 0;
        localStorage.setItem(LS_TOKEN_COUNT, (current + total).toString());
      }

      const content = data.choices[0].message.content;
      const parsed = JSON.parse(content);
      
      return {
        transcript: parsed.transcript || "NO CHANGE",
        usage: data.usage?.total_tokens || 0
      };

    } catch (error) {
      console.error("AI Fix Error:", error);
      return { transcript: rawText, error: true }; // Fallback to raw
    }
  });
};