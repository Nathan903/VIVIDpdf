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
  const sentences = [];
  let currentSentence = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    currentSentence.push(t);

    const isLast = i === tokens.length - 1;

    if (isLast) {
      sentences.push(currentSentence);
      break;
    }

    const nextT = tokens[i + 1];

    // Heuristics
    const hasPunctuation = /[.!?]["']?$/.test(t.spokenText.trim());
    
    const verticalGap = nextT.bounds.top - t.bounds.bottom;
    const isNewParagraph = Math.abs(verticalGap) > ((nextT.bounds.height+t.bounds.height)/2 * MERGE_CONFIG.SENTENCE_GAP_THRESHOLD);

    const isPossiblyNewParagraph = Math.abs(verticalGap) > (Math.max(nextT.bounds.height+t.bounds.height) * MERGE_CONFIG.SENTENCE_GAP_THRESHOLD);

    const isFontChange = (t.fontInfo && nextT.fontInfo) && 
                         (t.fontInfo.name !== nextT.fontInfo.name || Math.abs(t.fontInfo.size - nextT.fontInfo.size) > 1);
    const isBigFontChange = (t.fontInfo && nextT.fontInfo) && ((Math.abs(t.fontInfo.size - nextT.fontInfo.size) > 10) || (t.fontInfo.name !== nextT.fontInfo.name && Math.abs(t.fontInfo.size - nextT.fontInfo.size) > 4));

    const activeTriggers = [];
    if (hasPunctuation) activeTriggers.push('Punctuation');
    if (isNewParagraph&&isFontChange) activeTriggers.push('New Paragraph &&Font Change');
    if (isBigFontChange&&isPossiblyNewParagraph) activeTriggers.push('big font change');

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

            const isHyphenated = /[—\-\u00AD]$/.test(currentToken.text); 
            const isLineBreakSplit = isHyphenated && !isSameLine;

            if ((isSameLine && isTouching) || isLineBreakSplit) {
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