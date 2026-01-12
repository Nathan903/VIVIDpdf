// aiService.js

const LS_COST_COUNT = 'pdf_reader_total_cost'; 

export const getStoredCost = () => {
  return parseFloat(localStorage.getItem(LS_COST_COUNT) || '0.000000');
};

export const resetCostUsage = () => {
  localStorage.setItem(LS_COST_COUNT, '0.000000');
  return 0.000000;
};

/**
 * Calculates cost based on model (Updated for 2026 Pricing)
 */
const calculateCost = (usage, model) => {
  if (!usage) return 0;
  
  let inputRate = 0;
  let outputRate = 0;

  // Pricing per 1M tokens
  if (model === 'gpt-4o') {
      inputRate = 2.50;
      outputRate = 10.00;
  } else if (model === 'gpt-4o-mini') {
      inputRate = 0.15;
      outputRate = 0.60;
  } else if (model.includes('gemini-2.5-flash-lite')) {
      // Very cheap tier
      inputRate = 0.10;
      outputRate = 0.40;
  } else if (model.includes('gemini-3-flash-preview')) {
      // Standard Flash tier
      inputRate = 0.15;
      outputRate = 0.60;
  } else {
      // Fallback (assume mini/flash rates)
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

const queue = new RequestQueue(1); // Process 4 sentences in parallel

// --- HELPER: Gemini API Call ---
const callGeminiAPI = async (imageDataUrl, promptText, apiKey, model) => {
  // 1. Strip Data URL Prefix for Gemini (requires raw base64)
  const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const mimeType = imageDataUrl.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: promptText },
          { 
            inline_data: { 
              mime_type: mimeType, 
              data: base64Data 
            } 
          }
        ]
      }],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0.3
      }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Gemini API Failed");
  }

  const data = await response.json();
  
  // Normalize Gemini Response to OpenAI-like structure for the main function
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const usage = data.usageMetadata || {};

  return {
    content,
    usage: {
      prompt_tokens: usage.promptTokenCount || 0,
      completion_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0
    }
  };
};

// --- HELPER: OpenAI API Call ---
const callOpenAIAPI = async (imageDataUrl, promptText, apiKey, model) => {
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
            { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } }
          ]
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "OpenAI API Failed");
  }

  const data = await response.json();
  return {
    content: data.choices[0].message.content,
    usage: data.usage
  };
};


export const fixTranscriptWithAI = async (imageDataUrl, rawText, apiKey, userInstruction, model = 'gpt-4o-mini') => {
  return queue.add(async () => {
    if (!apiKey) throw new Error("Missing API Key");

    const promptText = `
You are an expert TTS (Text-to-Speech) Script Pre-processor.
Your goal is to convert a raw text string extracted from a PDF into a clean, spoken-word transcript.

INPUT DATA:
1. IMAGE: Visual ground truth of the text.
2. RAW TEXT: "${rawText}"
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
    
    // // Download image for debugging
    // const link = document.createElement("a");
    // link.href = imageDataUrl;
    // link.download = `debug_segment_${Date.now()}.png`; 
    // document.body.appendChild(link);
    // link.click();
    // document.body.removeChild(link);
    // // --- DEBUGGING END ---

    const startTime = performance.now(); // Start Timer

    try {
      let result;

      // ROUTING LOGIC
      if (model.startsWith('gemini')) {
         result = await callGeminiAPI(imageDataUrl, promptText, apiKey, model);
      } else {
         result = await callOpenAIAPI(imageDataUrl, promptText, apiKey, model);
      }

      const endTime = performance.now();
      
      // Calculate Cost
      const cost = calculateCost(result.usage, model);

      // Update Stored Total Cost
      const currentTotal = getStoredCost();
      localStorage.setItem(LS_COST_COUNT, (currentTotal + cost).toFixed(6));

      const parsed = JSON.parse(result.content);
      
      // --- METRICS CALCULATION ---
      const durationMs = (endTime - startTime).toFixed(2);
      
      console.log("[Prompt]", rawText, 
        "\n[output]"+parsed.transcript,
        `\n[Metrics] Model: ${model} | Time: ${durationMs}ms | Cost: $${cost.toFixed(6)}`);
      
      return {
        transcript: parsed.transcript || "NO CHANGE",
        usage: result.usage?.total_tokens || 0,
        cost: cost,
        duration: durationMs
      };

    } catch (error) {
      console.error("AI Fix Error:", error);
      return { transcript: rawText, error: true }; // Fallback to raw
    }
  });
};