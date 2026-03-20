import { 
    SENTENCE_TERMINATOR_REGEX, 
    COLON_END_REGEX, 
    CONTINUATION_END_REGEX, 
    CAPITAL_LETTER_START_REGEX, 
    EXTENDED_HYPHEN_END_REGEX 
} from './speechUtils';

// --- Text Merging Heuristics ---
export const MERGE_CONFIG = {
  MAX_VERTICAL_MISALIGNMENT: 0.5, 
  MAX_INTRA_WORD_GAP: 0.1, 
  MAX_ALLOWED_OVERLAP: 0.5,
  SENTENCE_GAP_THRESHOLD: 1.5
};

export const isTokenInZone = (tokenRect, zoneRect) => {
  return !(
    tokenRect.right < zoneRect.left ||
    tokenRect.left > zoneRect.right ||
    tokenRect.bottom < zoneRect.top ||
    tokenRect.top > zoneRect.bottom
  );
};

// --- Sentence Boundary Logic ---
export const groupTokensIntoSentences = (tokens) => {
  if (!tokens || tokens.length === 0) return [];

  // Calculate generic page statistics to make heuristics robust
  const lineHeights = [];
  const lineGaps = [];
  for (let i = 0; i < tokens.length - 1; i++) {
      const t1 = tokens[i];
      const t2 = tokens[i+1];
      const avgH = (t1.bounds.height + t2.bounds.height) / 2;
      lineHeights.push(t1.bounds.height);
      const gap = t2.bounds.top - t1.bounds.top;
      if (gap > avgH * 0.5 && gap < avgH * 5) {
          lineGaps.push(gap / avgH);
      }
  }
  if (tokens.length > 0) lineHeights.push(tokens[tokens.length - 1].bounds.height);

  let medianLineGap = 1.2; // default standard line spacing
  if (lineGaps.length > 0) {
      lineGaps.sort((a, b) => a - b);
      medianLineGap = lineGaps[Math.floor(lineGaps.length / 2)];
  }

  // Ensure median is within reasonable bounds (e.g. 1.0 to 2.5)
  medianLineGap = Math.max(1.0, Math.min(medianLineGap, 2.5));

  const sentences = [];
  let currentSentence = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    currentSentence.push(t);

    if (i === tokens.length - 1) {
      sentences.push(currentSentence);
      break;
    }

    const nextT = tokens[i + 1];
    
    const averageHeight = (nextT.bounds.height + t.bounds.height) / 2;
    const topToTop = nextT.bounds.top - t.bounds.top;
    
    // Check if the current and next tokens vertically overlap significantly.
    // E.g. "fg:" and "d/dx(f(x)..." might not share exact tops, but they overlap.
    const minTop = Math.max(t.bounds.top, nextT.bounds.top);
    const maxBottom = Math.min(t.bounds.top + t.bounds.height, nextT.bounds.top + nextT.bounds.height);
    const overlap = Math.max(0, maxBottom - minTop);
    const overlapRatio = Math.max(overlap / t.bounds.height, overlap / nextT.bounds.height);
    
    // It's a newline ONLY IF there's no substantial vertical overlap and topToTop is relatively large.
    const isNewline = topToTop > averageHeight * 0.5 && overlapRatio < 0.3;
    
    // A gap is a paragraph gap if it's significantly larger than the regular line gap for this page
    // Needs to be at least 1.4x, AND 1.3x the median gap.
    const isParagraphGap = topToTop > averageHeight * Math.max(1.4, medianLineGap * 1.3);
    const isMassiveGap = topToTop > averageHeight * 2.5;

    const isDifferentFontName = t.fontInfo && nextT.fontInfo && t.fontInfo.name !== nextT.fontInfo.name;
    const sizeDiff = t.fontInfo && nextT.fontInfo ? Math.abs(t.fontInfo.size - nextT.fontInfo.size) : 0;
    const isBigSizeChange = sizeDiff > 1.2;
    const isAnyFontChange = isDifferentFontName || sizeDiff > 0.5;

    const currentText = t.spokenText.trim();
    const nextText = nextT.spokenText.trim();

    const hasPunctuation = SENTENCE_TERMINATOR_REGEX.test(currentText);
    const endsWithColon = COLON_END_REGEX.test(currentText);
    const endsWithContinuation = CONTINUATION_END_REGEX.test(currentText); // Removed colon and semicolon; semicolons/Chinese stops now trigger sentence breaks
    // Allow punctuation to break only if it's not immediately followed by math logic,
    // though usually math won't follow terminal punctuation without a newline.
    const nextStartsCapital = CAPITAL_LETTER_START_REGEX.test(nextText); // Remove numbers, so we don't snap on inline equations

    const activeTriggers = [];

    if (hasPunctuation) {
        // If it's the end of a sentence visually, it breaks.
        // We removed the overlapRatio condition because sentences naturally overlap on the same line.
        // We only want to avoid breaking if the "punctuation" is part of an inline math expression,
        // but regular sentences ending with . ! ? should always break.
        activeTriggers.push('Punctuation');
    }

    if (isNewline) {
        // 1. Heading or Title transition (Big size change)
        if (isBigSizeChange && !endsWithContinuation) {
            activeTriggers.push('Big Font Size Change');
        }

        // 2. Safe Font Change (e.g. bold to normal) AND capital letter (like Heading -> Paragraph)
        if (isAnyFontChange && nextStartsCapital && !endsWithContinuation) {
            activeTriggers.push('Font Change + Capital');
        }

        // 3. Significant vertical gap
        // If it's a paragraph gap (likely a block equation or new paragraph), always break, even after a colon.
        if (isParagraphGap) {
            activeTriggers.push('Paragraph Gap');
        }

        // 4. Strong structural break: Massively separated
        if (isMassiveGap) {
            activeTriggers.push('Massive Gap');
        }

        // 5. Colon before a newline — list/equation intro, break at the colon
        if (endsWithColon) {
            activeTriggers.push('Colon + Newline');
        }

        // // 6. Fallback for scanned PDFs with missing terminal punctuation:
        // //    if the next line starts with a capital letter and the current token
        // //    doesn't end with a continuation character, assume a new sentence.
        // //    This avoids merging entire paragraphs when periods are absent from OCR output.
        // if (nextStartsCapital && !endsWithContinuation && !hasPunctuation && !endsWithColon) {
        //     activeTriggers.push('Capital Start (OCR fallback)');
        // }
    }

    if (activeTriggers.length > 0) {
      sentences.push(currentSentence);
      currentSentence = [];
    }
  }
  return sentences;
};

// --- Helper: Detect Background Color ---
export const getDominantColor = (ctx, w, h) => {
    try {
        const frame = ctx.getImageData(0, 0, w, h);
        const data = frame.data;
        const counts = {};
        let max = 0;
        let dom = 'rgb(255,255,255)';
        
        for (let i = 0; i < data.length; i += 40) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            const alpha = data[i+3];
            if (alpha < 10) continue;
            const k = `${r},${g},${b}`;
            counts[k] = (counts[k] || 0) + 1;
            if (counts[k] > max) { max = counts[k]; dom = `rgb(${r},${g},${b})`; }
        }
        return dom;
    } catch (e) { return 'rgb(255,255,255)'; }
};

// --- Merging Heuristics: Iterates through raw tokens to merge split words ---
export const mergeRawTokens = (rawTokens) => {
    const mergedTokens = [];
    if (rawTokens.length > 0) {
        let currentToken = { ...rawTokens[0], parts: [rawTokens[0]] };

        for (let i = 1; i < rawTokens.length; i++) {
            const nextToken = rawTokens[i];
            const prevBounds = currentToken.bounds;
            const nextBounds = nextToken.bounds;

            const isSameLine = Math.abs(prevBounds.top - nextBounds.top) < 
                                (prevBounds.height * MERGE_CONFIG.MAX_VERTICAL_MISALIGNMENT);
            
            const gap = nextBounds.left - prevBounds.right;
            const isTouching = gap < (prevBounds.height * MERGE_CONFIG.MAX_INTRA_WORD_GAP) && 
                                gap > -(prevBounds.height * MERGE_CONFIG.MAX_ALLOWED_OVERLAP);

            const isHyphenated = EXTENDED_HYPHEN_END_REGEX.test(currentToken.text); 
            const isLineBreakSplit = isHyphenated && !isSameLine;
            const isSameSuperscriptStatus = currentToken.isSuperscriptCitation === nextToken.isSuperscriptCitation;

            if (isSameSuperscriptStatus && ((isSameLine && isTouching) || isLineBreakSplit)) {
                if (isLineBreakSplit) {
                    currentToken.text = currentToken.text.slice(0, -1) + nextToken.text;
                } else {
                    currentToken.text += nextToken.text;
                }

                // Union bounds
                const newLeft = Math.min(prevBounds.left, nextBounds.left);
                const newTop = Math.min(prevBounds.top, nextBounds.top);
                const newRight = Math.max(prevBounds.right, nextBounds.right);
                const newBottom = Math.max(prevBounds.bottom, nextBounds.bottom);
                
                currentToken.bounds = {
                    left: newLeft,
                    top: newTop,
                    right: newRight,
                    bottom: newBottom,
                    width: newRight - newLeft,
                    height: newBottom - newTop
                };
                currentToken.parts.push(nextToken);
            } else {
                mergedTokens.push(currentToken);
                currentToken = { ...nextToken, parts: [nextToken] };
            }
        }
        mergedTokens.push(currentToken);
    }
    return mergedTokens;
};

// --- Debug Logic Extraction ---
export const generateDebugImagesFromCanvas = async (sourceCanvas, tokens, pageDimensions) => {
    if (!sourceCanvas || tokens.length === 0) return [];
    
    const sentences = groupTokensIntoSentences(tokens);

    const dpr = window.devicePixelRatio || 1;
    const results = [];

    for (const sentenceTokens of sentences) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        sentenceTokens.forEach(t => {
            t.parts.forEach(p => {
                minX = Math.min(minX, p.bounds.left);
                minY = Math.min(minY, p.bounds.top);
                maxX = Math.max(maxX, p.bounds.left + p.bounds.width);
                maxY = Math.max(maxY, p.bounds.top + p.bounds.height);
            });
        });

        const pad = 5;
        minX = Math.max(0, minX - pad);
        minY = Math.max(0, minY - pad);
        maxX = Math.min(pageDimensions.width, maxX + pad);
        maxY = Math.min(pageDimensions.height, maxY + pad);

        const width = maxX - minX;
        const height = maxY - minY;

        if (width <= 0 || height <= 0) continue;

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = width * dpr;
        cropCanvas.height = height * dpr;
        const ctx = cropCanvas.getContext('2d');
        ctx.scale(dpr, dpr);

        ctx.drawImage(
            sourceCanvas, 
            minX * dpr, minY * dpr, width * dpr, height * dpr, 
            0, 0, width, height 
        );

        const bgColor = getDominantColor(ctx, width * dpr, height * dpr);

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = width * dpr;
        maskCanvas.height = height * dpr;
        const mCtx = maskCanvas.getContext('2d');
        mCtx.scale(dpr, dpr);

        const sentenceTokenIds = new Set(sentenceTokens.map(t => t.id));

        mCtx.fillStyle = bgColor;
        tokens.forEach(t => {
            if (!sentenceTokenIds.has(t.id)) {
                t.parts.forEach(p => {
                    mCtx.fillRect(p.bounds.left - minX, p.bounds.top - minY, p.bounds.width, p.bounds.height);
                });
            }
        });

        mCtx.globalCompositeOperation = 'destination-out';
        sentenceTokens.forEach(t => {
            t.parts.forEach(p => {
                mCtx.fillRect(p.bounds.left - minX, p.bounds.top - minY, p.bounds.width, p.bounds.height);
            });
        });

        ctx.drawImage(maskCanvas, 0, 0, width, height);

        results.push({
            text: sentenceTokens.map(t => t.spokenText).join(' '),
            img: cropCanvas.toDataURL('image/jpeg', 0.8)
        });
    }
    return results;
};