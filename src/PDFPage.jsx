import React, { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Icons } from './Icons';

// --- Text Merging Heuristics ---
const MERGE_CONFIG = {
  MAX_VERTICAL_MISALIGNMENT: 0.5, 
  MAX_INTRA_WORD_GAP: 0.1, 
  MAX_ALLOWED_OVERLAP: 0.5,
  SENTENCE_GAP_THRESHOLD: 1.5
};

const isTokenInZone = (tokenRect, zoneRect) => {
  return !(
    tokenRect.right < zoneRect.left ||
    tokenRect.left > zoneRect.right ||
    tokenRect.bottom < zoneRect.top ||
    tokenRect.top > zoneRect.bottom
  );
};

// --- Sentence Boundary Logic ---
const groupTokensIntoSentences = (tokens) => {
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

const PDFPage = forwardRef(({ 
  pdfDoc, 
  pageNum, 
  scale, 
  rotation, 
  onTokensParsed, 
  activeTokenId, 
  readingMode, 
  notifyPageVisible,
  registerPageTokens,
  isMarkingMode,
  skipZones,
  onAddSkipZone,
  onRemoveSkipZone,
  highlightEnabled = true,
  highlightColor = '#ffeb3b',
  highlightOpacity = 0.4
}, ref) => {
  const [isVisible, setIsVisible] = useState(false);
  const [pageDimensions, setPageDimensions] = useState(null); 
  const [hoveredTokenId, setHoveredTokenId] = useState(null);
  
  // New state for loading animation
  const [isRendering, setIsRendering] = useState(false);

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [currentRect, setCurrentRect] = useState(null);
    
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const pageTokensRef = useRef([]);
  const allTokensRef = useRef([]); // NEW: Store all tokens before filtering
  const spanMapRef = useRef(new Map());
  const sentenceGroupsRef = useRef([]);

  // --- Scroll Visibility Observer ---
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) notifyPageVisible(pageNum);
      },
      { rootMargin: '200px', threshold: 0.5 } 
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [pageNum, notifyPageVisible]);

  // --- Helper: Detect Background Color ---
  const getDominantColor = (ctx, w, h) => {
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

  // --- Debug / Extraction Logic ---
  useImperativeHandle(ref, () => ({
    scrollIntoView: (opts) => {
      if (containerRef.current) containerRef.current.scrollIntoView(opts);
    },
    // NEW: Allow parent to set exact dimensions immediately to prevent scroll jump bugs
    resizeImmediately: (w, h) => {
        setPageDimensions({ width: w, height: h });
    },
    // NEW: Get exact bounding rect of a token for smart scrolling
    getTokenRect: (tokenId) => {
        const token = pageTokensRef.current.find(t => t.id === tokenId);
        if (token && token.parts && token.parts.length > 0) {
            // Return the bounding client rect of the first span part
            // This is relative to the viewport
            return token.parts[0].spanElement.getBoundingClientRect();
        }
        return null;
    },
    getThumbnail: async () => {
        if (!canvasRef.current) return null;
        // Create a small canvas for the thumbnail
        const thumbCanvas = document.createElement('canvas');
        const aspect = canvasRef.current.height / canvasRef.current.width;
        const w = 200; // Thumbnail width
        const h = w * aspect;
        
        thumbCanvas.width = w;
        thumbCanvas.height = h;
        
        const ctx = thumbCanvas.getContext('2d');
        // Draw the main canvas onto the thumbnail canvas
        ctx.drawImage(canvasRef.current, 0, 0, w, h);
        
        return thumbCanvas.toDataURL('image/jpeg', 0.7);
    },
    generateDebugImages: async () => {
        if (!canvasRef.current || pageTokensRef.current.length === 0) return [];
        
        const tokens = pageTokensRef.current;
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
                canvasRef.current, 
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
    }
  }));

  // --- NEW: Apply Skip Zones Logic ---
  const applySkipZones = useCallback(() => {
    if (allTokensRef.current.length === 0 || !pageDimensions) return;
    
    // If we are currently rendering, skip this update as the render will call it at the end
    // (Optimization to avoid double work, though isRendering might toggle too fast)

    const validTokens = [];
    spanMapRef.current.clear(); 

    allTokensRef.current.forEach(t => {
        // Calculate intersection with skip zones
        const isSkipped = skipZones.some(zone => {
             const zonePx = {
                left: zone.x * pageDimensions.width,
                top: zone.y * pageDimensions.height,
                right: (zone.x + zone.w) * pageDimensions.width,
                bottom: (zone.y + zone.h) * pageDimensions.height
            };
            return isTokenInZone(t.bounds, zonePx);
        });

        // Apply visual styles directly
        t.parts.forEach(p => {
            if (isSkipped) {
                p.spanElement.style.opacity = '0.2';
                p.spanElement.style.textDecoration = 'line-through';
            } else {
                p.spanElement.style.opacity = '1';
                p.spanElement.style.textDecoration = 'none';
            }
        });

        if (!isSkipped) {
            // Add to map for interaction
            t.parts.forEach(part => {
                const existing = spanMapRef.current.get(part.spanElement) || [];
                existing.push(t);
                spanMapRef.current.set(part.spanElement, existing);
            });
            validTokens.push(t);
        }
    });

    pageTokensRef.current = validTokens;
    if (readingMode === 'sentence') { 
        sentenceGroupsRef.current = groupTokensIntoSentences(validTokens);
    } else {
        sentenceGroupsRef.current = groupTokensIntoSentences(validTokens); 
    }
    registerPageTokens(pageNum, validTokens);

  }, [skipZones, pageDimensions, pageNum, registerPageTokens, readingMode]);

  // --- NEW: Effect to trigger skip zone updates without full re-render ---
  useEffect(() => {
    applySkipZones();
  }, [applySkipZones]);


  // --- Rendering Logic ---
  useEffect(() => {
    if (!isVisible || !pdfDoc) return;
    let isCancelled = false;

    const render = async () => {
      setIsRendering(true); // Start Spinner
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (isCancelled) return;

        const pixelRatio = window.devicePixelRatio || 1;
        
        const viewport = page.getViewport({ 
            scale: scale, 
            rotation: (page.rotate + rotation) % 360 
        });
        const renderViewport = page.getViewport({ 
            scale: scale * pixelRatio, 
            rotation: (page.rotate + rotation) % 360 
        });

        // Update dimensions logic to handle pre-resizing
        setPageDimensions({ width: viewport.width, height: viewport.height });
        if (containerRef.current) containerRef.current.style.setProperty('--scale-factor', scale);

        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            canvasRef.current.width = renderViewport.width;
            canvasRef.current.height = renderViewport.height;
            canvasRef.current.style.width = `${viewport.width}px`;
            canvasRef.current.style.height = `${viewport.height}px`;
            await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
        }

        if (isCancelled) return;

        if (textLayerRef.current) {
            textLayerRef.current.innerHTML = '';
            textLayerRef.current.style.width = `${viewport.width}px`;
            textLayerRef.current.style.height = `${viewport.height}px`;

            const textContent = await page.getTextContent();
            
            await pdfjsLib.renderTextLayer({
                textContent,
                container: textLayerRef.current,
                viewport,
                enhanceTextSelection: true
            }).promise;

            const spans = Array.from(textLayerRef.current.querySelectorAll('span'));
            let rawTokens = [];
            
            spans.forEach((span, i) => {
                const text = span.textContent;
                if (!text.trim()) return; 

                const item = textContent.items[i];
                const computed = window.getComputedStyle(span);
                
                const fontInfo = {
                    name: item?.fontName || computed.fontFamily, 
                    family: computed.fontFamily,
                    size: parseFloat(computed.fontSize) || 12
                };

                const containerRect = containerRef.current.getBoundingClientRect();
                const regex = /\S+/g;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    const range = document.createRange();
                    range.setStart(span.firstChild, match.index);
                    range.setEnd(span.firstChild, regex.lastIndex);
                    const rect = range.getBoundingClientRect();

                    rawTokens.push({
                        text: match[0],
                        spanElement: span,
                        fontInfo, 
                        startOffset: match.index,
                        endOffset: regex.lastIndex,
                        bounds: {
                            left: rect.left - containerRect.left,
                            top: rect.top - containerRect.top,
                            right: rect.right - containerRect.left,
                            bottom: rect.bottom - containerRect.top,
                            width: rect.width,
                            height: rect.height
                        }
                    });
                }
            });

            // Merging Pass
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

            // Finalize
            let allCandidates = [];
            // We do NOT clear spanMapRef here; applySkipZones will handle it.

            mergedTokens.forEach((t, index) => {
                const finalToken = {
                    id: `p${pageNum}_t${index}`,
                    pageNum,
                    text: t.text,
                    spokenText: t.text,
                    bounds: t.bounds, 
                    parts: t.parts,
                    fontInfo: t.parts[0].fontInfo
                };
                
                // Store all tokens, regardless of skip zones
                allCandidates.push(finalToken);
            });

            allTokensRef.current = allCandidates;
            applySkipZones(); // Trigger initial zone application
        }
      } catch (err) {
        console.error(`Error rendering page ${pageNum}`, err);
      } finally {
        if (!isCancelled) setIsRendering(false); // Stop Spinner
      }
    };

    render();
    return () => { isCancelled = true; };
  }, [isVisible, pdfDoc, pageNum, scale, rotation, registerPageTokens]); // Removed skipZones

  // --- Drawing Logic ---
  const handleMouseDown = (e) => {
    if (!isMarkingMode) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDrawStart({ x, y });
    setCurrentRect({ x, y, w: 0, h: 0 });
    setIsDrawing(true);
  };

  const handleMouseMoveDrawing = (e) => {
    if (!isDrawing || !isMarkingMode) return;
    const rect = containerRef.current.getBoundingClientRect();
    const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const x = Math.min(drawStart.x, curX);
    const y = Math.min(drawStart.y, curY);
    const w = Math.abs(curX - drawStart.x);
    const h = Math.abs(curY - drawStart.y);

    setCurrentRect({ x, y, w, h });
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentRect && currentRect.w > 5 && currentRect.h > 5 && pageDimensions) {
        const normZone = {
            id: Date.now(),
            x: currentRect.x / pageDimensions.width,
            y: currentRect.y / pageDimensions.height,
            w: currentRect.w / pageDimensions.width,
            h: currentRect.h / pageDimensions.height
        };
        onAddSkipZone(normZone);
    }
    setCurrentRect(null);
  };

  // --- Drawing Logic on Tablets ---
  const handleTouchStart = (e) => {
      if (!isMarkingMode) return;
      // Prevent scrolling while drawing
      if (e.cancelable) e.preventDefault();

      const touch = e.touches[0];
      const rect = containerRef.current.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      setDrawStart({ x, y });
      setCurrentRect({ x, y, w: 0, h: 0 });
      setIsDrawing(true);
  };

  const handleTouchMove = (e) => {
      if (!isDrawing || !isMarkingMode) return;
      if (e.cancelable) e.preventDefault();

      const touch = e.touches[0];
      const rect = containerRef.current.getBoundingClientRect();
      const curX = Math.max(0, Math.min(touch.clientX - rect.left, rect.width));
      const curY = Math.max(0, Math.min(touch.clientY - rect.top, rect.height));

      const x = Math.min(drawStart.x, curX);
      const y = Math.min(drawStart.y, curY);
      const w = Math.abs(curX - drawStart.x);
      const h = Math.abs(curY - drawStart.y);

      setCurrentRect({ x, y, w, h });
  };

  // --- Interaction Logic ---
  const getTokenFromEvent = (e) => {
    if (isMarkingMode) return null;
    let range;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
    else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.setEnd(pos.offsetNode, pos.offset);
    }
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;

    const targetSpan = range.startContainer.parentElement;
    const candidates = spanMapRef.current.get(targetSpan);
    if (!candidates) return null;
    if (candidates.length === 1) return candidates[0];

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    return candidates.find(t => 
        mouseX >= t.bounds.left && 
        mouseX <= t.bounds.right && 
        mouseY >= t.bounds.top && 
        mouseY <= t.bounds.bottom
    );
  };

  const getSentenceTokens = useCallback((targetTokenId) => {
      if (!targetTokenId) return [];
      const cachedSentences = sentenceGroupsRef.current;
      if (cachedSentences && cachedSentences.length > 0) {
          for (const sent of cachedSentences) {
              if (sent.some(t => t.id === targetTokenId || t.linkedTo === targetTokenId)) {
                  return sent;
              }
          }
      }
      const tokens = pageTokensRef.current;
      const foundToken = tokens.find(t => t.id === targetTokenId);
      return foundToken ? [foundToken] : [];
  }, []);

  const handlePageClick = (e) => {
    if (isMarkingMode) return;
    const clickedToken = getTokenFromEvent(e);
    if (clickedToken) {
        if (readingMode === 'sentence') {
            const sentenceTokens = getSentenceTokens(clickedToken.id);
            if (sentenceTokens.length > 0) {
                onTokensParsed(pageTokensRef.current, sentenceTokens[0].id, pageNum);
            } else {
                onTokensParsed(pageTokensRef.current, clickedToken.id, pageNum);
            }
        } else {
            onTokensParsed(pageTokensRef.current, clickedToken.id, pageNum); 
        }
    }
  };

  const handleMouseMove = (e) => {
    if (isMarkingMode) {
        handleMouseMoveDrawing(e);
        return;
    }
    const hoveredToken = getTokenFromEvent(e);
    if (hoveredToken) {
        if (hoveredToken.id !== hoveredTokenId) setHoveredTokenId(hoveredToken.id);
    } else {
        if (hoveredTokenId !== null) setHoveredTokenId(null);
    }
  };

  // --- Multi-Rect Calculation ---
  const getHighlightRects = useCallback((tokenOrId) => {
    let targetTokens = [];
    if (readingMode === 'sentence') {
         const id = typeof tokenOrId === 'string' ? tokenOrId : tokenOrId.id;
         targetTokens = getSentenceTokens(id);
    } else {
         const t = typeof tokenOrId === 'string' ? pageTokensRef.current.find(x => x.id === tokenOrId) : tokenOrId;
         if (t) targetTokens = [t];
         if (t && t.linkedTo) {
             const linked = pageTokensRef.current.find(x => x.id === t.linkedTo);
             if (linked) targetTokens.push(linked);
         }
         if (t) {
             const linkedFrom = pageTokensRef.current.find(x => x.linkedTo === t.id);
             if (linkedFrom) targetTokens.push(linkedFrom);
         }
    }

    if (targetTokens.length === 0) return [];

    const allRects = [];
    targetTokens.forEach(tok => {
        if (tok.parts) {
            tok.parts.forEach(p => allRects.push(p.bounds));
        }
    });

    if (allRects.length === 0) return [];

    const mergedRects = [];
    let currentRect = { ...allRects[0] };

    for (let i = 1; i < allRects.length; i++) {
        const nextBounds = allRects[i];
        
        const isSameLine = Math.abs(currentRect.top - nextBounds.top) < 
                           (currentRect.height * MERGE_CONFIG.MAX_VERTICAL_MISALIGNMENT);
        
        if (isSameLine) {
             const newLeft = Math.min(currentRect.left, nextBounds.left);
             const newTop = Math.min(currentRect.top, nextBounds.top);
             const newRight = Math.max(currentRect.left + currentRect.width, nextBounds.left + nextBounds.width);
             const newBottom = Math.max(currentRect.top + currentRect.height, nextBounds.top + nextBounds.height);
             
             currentRect = {
                 left: newLeft,
                 top: newTop,
                 width: newRight - newLeft,
                 height: newBottom - newTop
             };
        } else {
            mergedRects.push(currentRect);
            currentRect = { ...nextBounds };
        }
    }
    mergedRects.push(currentRect);
    return mergedRects;

  }, [readingMode, getSentenceTokens]);

  const activeRects = useMemo(() => {
      if (!activeTokenId) return [];
      return getHighlightRects(activeTokenId);
  }, [activeTokenId, getHighlightRects]);

  const hoverRects = useMemo(() => {
      if (!hoveredTokenId) return [];
      return getHighlightRects(hoveredTokenId);
  }, [hoveredTokenId, getHighlightRects]);

  return (
    <div 
      ref={containerRef}
      className="pdf-page-container" 
      style={{ 
        width: pageDimensions ? pageDimensions.width : '100%',
        maxWidth: pageDimensions ? pageDimensions.width : '800px',
        // If dimensions are known, use them. If not, minHeight prevents collapse to 0
        height: pageDimensions ? pageDimensions.height : 'auto', 
        minHeight: pageDimensions ? pageDimensions.height : '200px',
        marginBottom: '20px',
        position: 'relative',
        backgroundColor: 'white',
        boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
        cursor: isMarkingMode ? 'crosshair' : 'default',
        userSelect: isMarkingMode ? 'none' : 'auto',
        // Center placeholder content
        display: isVisible ? 'block' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888',
        // Handle touch screen actions
        touchAction: isMarkingMode ? 'none' : 'auto'
      }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUp}
    >
      {isVisible && (
        <>
            <canvas ref={canvasRef} style={{ display: 'block', pointerEvents: 'none' }} />
            <div 
                ref={textLayerRef} 
                className="textLayer" 
                onClick={handlePageClick}
                onMouseLeave={() => setHoveredTokenId(null)}
                style={{ pointerEvents: isMarkingMode ? 'none' : 'auto' }}
            />
            
            {/* ACTIVE HIGHLIGHT */}
            {activeRects.map((style, i) => (
                !isMarkingMode && highlightEnabled && (
                    <div 
                        key={`active-${i}`} 
                        className="highlight-box" 
                        style={{
                            ...style, 
                            backgroundColor: highlightColor,
                            opacity: highlightOpacity,
                            // Soft edge style
                            border: 'none',
                            borderRadius: '4px',
                            boxShadow: `0 0 6px ${highlightColor}`
                        }} 
                    />
                )
            ))}
            
            {/* HOVER HIGHLIGHT */}
            {hoverRects.map((style, i) => (
                !isMarkingMode && (
                    <div 
                        key={`hover-${i}`} 
                        className="hover-box" 
                        style={{
                            ...style,
                            // Derived from active color settings
                            backgroundColor: highlightColor, 
                            opacity: 0.25, 
                            // Soft edge style
                            border: 'none',
                            borderRadius: '4px',
                            boxShadow: `0 0 6px ${highlightColor}`
                        }} 
                    />
                )
            ))}

            {pageDimensions && skipZones.map(zone => (
                <div 
                    key={zone.id}
                    className="skip-zone-overlay"
                    style={{
                        left: zone.x * pageDimensions.width,
                        top: zone.y * pageDimensions.height,
                        width: zone.w * pageDimensions.width,
                        height: zone.h * pageDimensions.height,
                    }}
                >
                  {isMarkingMode && (
                      <button 
                          className="delete-zone-btn"
                          onClick={(e) => { e.stopPropagation(); onRemoveSkipZone(zone.id); }}
                          title="Remove Skip Zone"
                      >
                          <Icons.Close />
                      </button>
                  )}
                </div>
            ))}

            {isDrawing && currentRect && (
                <div 
                    className="skip-zone-drawing"
                    style={{
                        left: currentRect.x,
                        top: currentRect.y,
                        width: currentRect.w,
                        height: currentRect.h
                    }}
                />
            )}

            {/* Loading Overlay (When page is visible but still rendering) */}
            {isRendering && (
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)', zIndex: 5 }}>
                    <div className="spinner" style={{width: '30px', height: '30px', border: '3px solid #ccc', borderTop: '3px solid #333', borderRadius: '50%', animation: 'spin 1s linear infinite'}}></div>
                </div>
            )}
        </>
      )}
      {!isVisible && (
          <div className="loading-placeholder"><span>Page {pageNum}</span></div>
      )}
    </div>
  );
});

export default PDFPage;