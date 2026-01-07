// aiService.js

const LS_COST_COUNT = 'pdf_reader_total_cost'; // Changed from token count to cost

export const getStoredCost = () => {
  return parseFloat(localStorage.getItem(LS_COST_COUNT) || '0.000000');
};

export const resetCostUsage = () => {
  localStorage.setItem(LS_COST_COUNT, '0.000000');
  return 0.000000;
};

/**
 * Calculates cost based on model
 */
const calculateCost = (usage, model) => {
  if (!usage) return 0;
  
  let inputRate = 0;
  let outputRate = 0;

  if (model === 'gpt-4o') {
      // $2.50 / 1M input, $10.00 / 1M output
      inputRate = 2.50;
      outputRate = 10.00;
  } else {
      // gpt-4o-mini (default)
      // $0.15 / 1M input, $0.60 / 1M output
      inputRate = 0.15;
      outputRate = 0.60;
  }

  const inputCost = (usage.prompt_tokens / 1_000_000) * inputRate;
  const outputCost = (usage.completion_tokens / 1_000_000) * outputRate;
  return inputCost + outputCost;
};

// Simple queue to prevent browser from choking on simultaneous fetch requests
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

export const fixTranscriptWithAI = async (imageDataUrl, rawText, apiKey, userInstruction, model = 'gpt-4o-mini') => {
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

    // --- DEBUGGING START ---
    
    const startTime = performance.now(); // Start Timer

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model, 
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
      const endTime = performance.now(); // End Timer
      
      // Calculate Cost
      const cost = calculateCost(data.usage, model);

      // Update Stored Total Cost
      const currentTotal = getStoredCost();
      localStorage.setItem(LS_COST_COUNT, (currentTotal + cost).toFixed(6));

      const content = data.choices[0].message.content;
      const parsed = JSON.parse(content);
      
      // --- METRICS CALCULATION ---
      const durationMs = (endTime - startTime).toFixed(2);
      
      console.log("[Prompt]", rawText);
      console.log(`[Metrics] Model: ${model} | Time: ${durationMs}ms | Cost: $${cost.toFixed(6)} | Tokens: ${data.usage?.total_tokens}`);
      
      return {
        transcript: parsed.transcript || "NO CHANGE",
        usage: data.usage?.total_tokens || 0,
        cost: cost,
        duration: durationMs
      };

    } catch (error) {
      console.error("AI Fix Error:", error);
      return { transcript: rawText, error: true }; // Fallback to raw
    }
  });
};