import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';
import PDFPage from './PDFPage';
import { Icons } from './Icons';
import { initDB, saveFileRecord, getRecentFiles, updateFileMeta, getFileId } from './db';
import { fixTranscriptWithAI, getStoredCost, resetCostUsage } from './aiService'; // IMPORT AI SERVICE
import { applySkippingRules, applyCustomPronunciations } from './speechUtils';
import SpeechCustomizationPanel from './SpeechCustomizationPanel';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// --- Local Storage Keys ---
const LS_GLOBALS = 'pdf_reader_globals';
const LS_AI_CONFIG = 'pdf_reader_ai_config'; // New Key

const DEFAULT_GLOBALS = {
  voiceURI: "",
  readingMode: 'sentence',
  rate: 1.0,
  highlightEnabled: true,
  highlightColor: '#ffeb3b',
  highlightOpacity: 0.4,
  autoHide: false,
  autoScroll: true,
  layoutMode: 'grid',
  speechCustomization: {
    skipUrls: false,
    skipSquare: false,
    skipParens: false,
    skipCurly: false,
    visualIndicator: false
  },
  customPronunciations: []
};

const DEFAULT_AI_CONFIG = {
  apiKey: "",
  model: "gemini-2.5-flash-lite", // Default to cheap model
  instructions: "Skip equations unless they are simple variables. Read naturally.",
  enabled: false
};

const App = () => {
  // --- Global Settings (Init from LocalStorage) ---
  const [globalSettings, setGlobalSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_GLOBALS);
      return saved ? { ...DEFAULT_GLOBALS, ...JSON.parse(saved) } : DEFAULT_GLOBALS;
    } catch (e) {
      return DEFAULT_GLOBALS;
    }
  });

  // --- AI Config State ---
  const [aiConfig, setAiConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_AI_CONFIG);
      return saved ? { ...DEFAULT_AI_CONFIG, ...JSON.parse(saved) } : DEFAULT_AI_CONFIG;
    } catch (e) {
      return DEFAULT_AI_CONFIG;
    }
  });

  const [totalCost, setTotalCost] = useState(getStoredCost());
  const [ocrLoading, setOcrLoading] = useState(false); // Spinner for AI processing

  // Save AI Config on change
  useEffect(() => {
    localStorage.setItem(LS_AI_CONFIG, JSON.stringify(aiConfig));
  }, [aiConfig]);


  // state for auto-hide
  const [autoHide, setAutoHide] = useState(globalSettings.autoHide);
  const [autoScroll, setAutoScroll] = useState(globalSettings.autoScroll); 
  const [pdf, setPdf] = useState(null);
  const [fileId, setFileId] = useState(null); 
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Mapped from Global Settings or UI
  const [rate, setRate] = useState(globalSettings.rate);
  const [isDragging, setIsDragging] = useState(false);
  
  // New: Reading Mode State
  const [readingMode, setReadingMode] = useState(globalSettings.readingMode); 

  // New: Highlight Settings
  const [highlightEnabled, setHighlightEnabled] = useState(globalSettings.highlightEnabled);
  const [highlightColor, setHighlightColor] = useState(globalSettings.highlightColor); 
  const [highlightOpacity, setHighlightOpacity] = useState(globalSettings.highlightOpacity);

  // New: Speech Customization
  const [speechCustomization, setSpeechCustomization] = useState(globalSettings.speechCustomization || DEFAULT_GLOBALS.speechCustomization);
  const [customPronunciations, setCustomPronunciations] = useState(globalSettings.customPronunciations || DEFAULT_GLOBALS.customPronunciations);
  const [showCustomSpeech, setShowCustomSpeech] = useState(false);

  // Navigation
  const [numPages, setNumPages] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [jumpInput, setJumpInput] = useState("1");
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Zoom / View
  const [scale, setScale] = useState(1.5);
  const [rotation, setRotation] = useState(0);
  const [zoomInput, setZoomInput] = useState("150"); 
  const [fitMode, setFitMode] = useState('custom'); 

  // TTS State
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(globalSettings.voiceURI);
  const [activeTokenId, setActiveTokenId] = useState(null);

  // Skip / Zones
  const [isMarkingMode, setIsMarkingMode] = useState(false);
  const [skipZones, setSkipZones] = useState([]);
  
  // Debug
  const [debugImages, setDebugImages] = useState([]);

  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false); 
  const [recentFiles, setRecentFiles] = useState([]);

  // Refs
  const isPlayingRef = useRef(false); 
  const isJumpingRef = useRef(false); 
  const rateRef = useRef(rate);
  const autoScrollRef = useRef(autoScroll);
  const customPronunciationsRef = useRef(customPronunciations);
  const speechCustomizationRef = useRef(speechCustomization);
  const synth = window.speechSynthesis;
  const pageRefs = useRef({}); 
  const viewportRef = useRef(null); 
  
  const settingsRef = useRef(null);
  const settingsBtnRef = useRef(null);
  
  // DOM Refs for Shortcuts
  const fileInputRef = useRef(null);
  const jumpInputRef = useRef(null);
  const voiceSelectRef = useRef(null);
  
  const pageTokensMap = useRef(new Map());
  const waitingForPageRef = useRef(null);
  
  // Visual
  const [isLoading, setIsLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);
  useEffect(() => { customPronunciationsRef.current = customPronunciations; }, [customPronunciations]);
  useEffect(() => { speechCustomizationRef.current = speechCustomization; }, [speechCustomization]);

  // --- Persistence Effects ---

  // 1. Save Global Settings to LocalStorage on change
  useEffect(() => {
    const settings = {
      voiceURI: selectedVoiceURI,
      readingMode,
      rate,
      highlightEnabled,
      highlightColor,
      highlightOpacity,
      autoHide,
      autoScroll,
      layoutMode: globalSettings.layoutMode,
      speechCustomization,
      customPronunciations
    };
    localStorage.setItem(LS_GLOBALS, JSON.stringify(settings));
  }, [selectedVoiceURI, readingMode, rate, highlightEnabled, 
      highlightColor, highlightOpacity, autoHide, autoScroll, 
      globalSettings.layoutMode, speechCustomization, customPronunciations
  ]);

  // Sync speech customization state with global settings when it changes
  useEffect(() => {
    setGlobalSettings(prev => ({
      ...prev,
      speechCustomization,
      customPronunciations
    }));
  }, [speechCustomization, customPronunciations]);

  // 2. Load Recent Files on Mount
  useEffect(() => {
    loadRecentFilesList();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
        if (
            showSettings && 
            settingsRef.current && 
            !settingsRef.current.contains(event.target) &&
            settingsBtnRef.current &&
            !settingsBtnRef.current.contains(event.target)
        ) {
            setShowSettings(false);
        }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettings]);

  const loadRecentFilesList = async () => {
    try {
      const files = await getRecentFiles();
      setRecentFiles(files);
    } catch (e) { console.error("Failed to load recents", e); }
  };

  // 3. Save PDF-Specific State (Debounced)
  useEffect(() => {
    if (!fileId || !pdf) return;
    
    const timer = setTimeout(() => {
      updateFileMeta(fileId, {
        lastPage: activePage,
        scale,
        rotation,
        darkMode,
        skipZones,
        lastOpened: Date.now()
      });
      // Try to capture thumbnail of current page
      captureThumbnail();
    }, 1000);

    return () => clearTimeout(timer);
  }, [fileId, activePage, scale, rotation, darkMode, skipZones]);

  // --- Thumbnail Logic ---
  const captureThumbnail = async () => {
    if (!fileId || !pageRefs.current[activePage]) return;
    try {
      const thumbDataUrl = await pageRefs.current[activePage].getThumbnail();
      if (thumbDataUrl) {
        updateFileMeta(fileId, { thumbnail: thumbDataUrl });
      }
    } catch (e) { /* page might not be fully rendered yet */ }
  };

  // Sync Zoom Input
  useEffect(() => {
      setZoomInput(Math.round(scale * 100).toString());
  }, [scale]);

  useEffect(() => {
    if (!isInputFocused) setJumpInput(String(activePage));
  }, [activePage, isInputFocused]);

  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      // If we have a saved voiceURI, verify it exists, otherwise default
      if (available.length > 0) {
        if (selectedVoiceURI && available.some(v => v.voiceURI === selectedVoiceURI)) {
             // Saved voice is valid, keep it
        } else {
             const defaultVoice = available.find(v => v.default) || available[0];
             setSelectedVoiceURI(defaultVoice?.voiceURI || "");
        }
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [selectedVoiceURI]);

  // --- Zoom & Rotation ---
  const updateScale = (newScale) => {
      const clamped = Math.min(Math.max(newScale, 0.5), 5.0); 
      setScale(clamped);
      setFitMode('custom');
  };

  const handleZoomIn = () => updateScale(scale + 0.1);
  const handleZoomOut = () => updateScale(scale - 0.1);

  const handleZoomInputChange = (e) => setZoomInput(e.target.value);
  
  const handleZoomInputBlur = () => {
      const val = parseInt(zoomInput, 10);
      if (!isNaN(val)) updateScale(val / 100);
      else setZoomInput(Math.round(scale * 100).toString());
  };

  const handleZoomInputKeyDown = (e) => {
      if (e.key === 'Enter') e.target.blur();
  };

  const handleRotate = () => {
      setRotation(prev => (prev + 90) % 360);
  };

  const toggleFitMode = async () => {
    if (!pdf || !viewportRef.current) return;
    try {
        const page = await pdf.getPage(activePage);
        const unscaledViewport = page.getViewport({ scale: 1.0, rotation: (page.rotate + rotation) % 360 });
        const containerWidth = viewportRef.current.clientWidth;
        const containerHeight = viewportRef.current.clientHeight;
        const pad = 40; 
        
        if (fitMode === 'width') {
            const newScale = (containerHeight - pad) / unscaledViewport.height;
            setScale(newScale);
            setFitMode('height');
        } else {
            const newScale = (containerWidth - pad) / unscaledViewport.width;
            setScale(newScale);
            setFitMode('width');
        }
    } catch (err) {
        console.error("Error calculating fit:", err);
    }
  };

  // --- Core Logic ---
  const handleAddSkipZone = useCallback((zone) => {
      setSkipZones(prev => [...prev, zone]);
  }, []);

  const handleRemoveSkipZone = useCallback((id) => {
      setSkipZones(prev => prev.filter(z => z.id !== id));
  }, []);

  const handlePageTokensRegistered = useCallback((pageNum, tokens) => {
    pageTokensMap.current.set(pageNum, tokens);

    // --- FIX: Cross-Page Hyphenation Merge ---
    const tryMergeNeighbors = (p1, p2) => {
        const t1 = pageTokensMap.current.get(p1);
        const t2 = pageTokensMap.current.get(p2);
        if (!t1 || !t2 || t1.length === 0 || t2.length === 0) return;

        const last = t1[t1.length - 1];
        const first = t2[0];

        // If already linked, skip
        if (first.linkedTo === last.id) return;

        // Check for hyphen at end of previous page
        if (/[-\u2010\u2011\u00AD]$/.test(last.text)) {
            // Remove hyphen from spoken text and append next word
            const cleanPrefix = last.text.replace(/[-\u2010\u2011\u00AD]$/, '');
            last.spokenText = cleanPrefix + first.text;
            
            // Silence the second part so it doesn't trigger a separate read
            first.spokenText = "";
            
            // Link them for highlighting
            first.linkedTo = last.id;
        }
    };

    // Check boundary with previous page
    tryMergeNeighbors(pageNum - 1, pageNum);
    // Check boundary with next page
    tryMergeNeighbors(pageNum, pageNum + 1);

    if (waitingForPageRef.current === pageNum && isPlayingRef.current) {
        waitingForPageRef.current = null;
        // Check if AI Mode is enabled to route correctly
        if (aiConfig.enabled) {
            const tokens = pageTokensMap.current.get(pageNum);
            if(tokens && tokens.length > 0) {
                 playNextSentenceAI(pageNum, tokens[0].id);
            }
        } else {
            scheduleNextBatch(pageNum, []);
        }
    }
  }, [aiConfig.enabled]); // Added dependency

  // --- Smart Jump Logic ---
  const performJump = async (pageNumber, doc = pdf) => {
    if (!doc || pageNumber < 1 || pageNumber > (doc.numPages || numPages)) return;

    // Optional: show loading if jumping far
    const isFarJump = Math.abs(pageNumber - activePage) > 5;
    if (isFarJump) setIsLoading(true);

    try {
      // 1. Prefetch page to get true dimensions
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ 
          scale: scale, 
          rotation: (page.rotate + rotation) % 360 
      });

      // 2. Force the placeholder to the correct size IMMEDIATELY
      if (pageRefs.current[pageNumber]) {
        // We use the new exposed method on PDFPage
        pageRefs.current[pageNumber].resizeImmediately(viewport.width, viewport.height);
        
        // Wait a tick for DOM update
        await new Promise(r => setTimeout(r, 20));
        
        pageRefs.current[pageNumber].scrollIntoView({ behavior: 'auto', block: 'start' });
      }

      setActivePage(pageNumber);
      if (!isInputFocused) setJumpInput(String(pageNumber));
    } catch (e) {
      console.error("Smart jump failed:", e);
    } finally {
      if (isFarJump) setIsLoading(false);
    }
  };

  const loadFromBlob = async (blob, existingMeta = null) => {
    setIsLoading(true); 
    try {
        if (blob.name) { document.title = blob.name;}
        const data = await blob.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdfDoc = await loadingTask.promise;
        
        // Generate or Use ID
        const fid = existingMeta ? existingMeta.id : getFileId(blob);
        setFileId(fid);

        // Save new record if it doesn't exist
        if (!existingMeta) {
          await saveFileRecord({
            id: fid,
            name: blob.name,
            blob: blob,
            lastOpened: Date.now(),
            lastPage: 1,
            scale: 1.5,
            rotation: 0,
            darkMode: false,
            skipZones: []
          });
        }

        setPdf(pdfDoc);
        setNumPages(pdfDoc.numPages);
        
        // Restore Settings or Default
        const meta = existingMeta || { lastPage: 1, scale: 1.5, rotation: 0, darkMode: false, skipZones: [] };
        
        setActivePage(meta.lastPage || 1);
        setJumpInput(String(meta.lastPage || 1));
        
        // Restore view settings
        setScale(meta.scale || 1.5);
        setRotation(meta.rotation || 0);
        setDarkMode(!!meta.darkMode);
        setSkipZones(meta.skipZones || []);

        setFitMode('custom');
        setActiveTokenId(null);
        setIsPlaying(false);
        pageTokensMap.current.clear();
        waitingForPageRef.current = null;
        setDebugImages([]);
        synth.cancel();

        // Scroll to saved page (delayed to allow render)
        setTimeout(() => {
           // USE NEW JUMP LOGIC HERE
           performJump(meta.lastPage || 1, pdfDoc);
        }, 300);

    } catch (error) {
        console.error("Error loading PDF:", error);
        alert("Failed to load PDF. Please ensure it is a valid file.");
    } finally {
        setIsLoading(false); 
    }
  };

  const handleRecentClick = (fileRecord) => {
    loadFromBlob(fileRecord.blob, fileRecord);
  };

  const onFileChange = (e) => {
    const file = e.target.files[0];
    if (file) loadFromBlob(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0 && files[0].type === "application/pdf") {
        loadFromBlob(files[0]);
    } else {
        alert("Please drop a valid PDF file.");
    }
  };

  // Note: Updated to store the Component Ref, not just the DIV
  const registerPageRef = (num, ref) => { pageRefs.current[num] = ref; };
  const notifyPageVisible = useCallback((pageNum) => { setActivePage(pageNum); }, []);

  const handleJumpKey = (e) => {
      if (e.key === 'Enter') {
          const page = parseInt(jumpInput);
          if (page >= 1 && page <= numPages) {
              // USE NEW JUMP LOGIC HERE
              performJump(page);
              e.target.blur(); 
          }
      }
  };

  const handleTokenClick = useCallback((pageTokens, clickedTokenId, pageNum) => {
      // Flag that we are intentionally jumping so the 'onend'/'onerror' 
      // of the canceled utterance doesn't stop playback.
      isJumpingRef.current = true;
      synth.cancel();
      setIsPlaying(true);
      isPlayingRef.current = true;
      waitingForPageRef.current = null;
      
      // Determine Start logic
      if (aiConfig.enabled) {
          playNextSentenceAI(pageNum, clickedTokenId);
      } else {
          let startIndex = 0;
          if (clickedTokenId) {
              startIndex = pageTokens.findIndex(t => t.id === clickedTokenId);
              if (startIndex === -1) startIndex = 0;
          }
          const tokens = pageTokens.slice(startIndex);
          scheduleNextBatch(pageNum, tokens, true);
      }

      // Reset the jump flag after a short delay (enough for async cancel events to fire)
      setTimeout(() => { isJumpingRef.current = false; }, 50);
  }, [voices, selectedVoiceURI, rate, aiConfig.enabled]);

  // --- Smart Scrolling Logic (Safe Zone) ---
  const handleSmartScroll = (pageNum, tokenId) => {
    // If auto-scroll is disabled, do nothing
    if (!autoScrollRef.current) return;
    if (!viewportRef.current) return;

    const pageRef = pageRefs.current[pageNum];
    if (!pageRef || !pageRef.getTokenRect) return;

    // Get token coordinates relative to viewport
    const tokenRect = pageRef.getTokenRect(tokenId);
    if (!tokenRect) return;

    const viewport = viewportRef.current;
    const containerRect = viewport.getBoundingClientRect();

    // Calculate token's top position relative to the visible area
    const relativeTop = tokenRect.top - containerRect.top;
    
    // Viewport height
    const vHeight = containerRect.height;

    // Safe Zone Definitions
    const safeTop = vHeight * 0.1;   // 10%
    const safeBottom = vHeight * 0.8; // 80%

    // Target Position (Where we want to move the token if it's out of bounds)
    // We aim for the top 20% mark to show context below
    const targetOffset = vHeight * 0.2; 

    // Calculate Scroll Shift needed
    let shiftAmount = 0;

    if (relativeTop < safeTop) {
        // Token is too high (or above viewport) -> Scroll Up
        // Current Scroll Top + (Where it is - Where we want it)
        shiftAmount = relativeTop - targetOffset;
    } else if (relativeTop > safeBottom) {
        // Token is too low (or below viewport) -> Scroll Down
        shiftAmount = relativeTop - targetOffset;
    }

    // Only scroll if outside the Safe Zone
    if (Math.abs(shiftAmount) > 5) { // Small threshold to prevent micro-jitters
        viewport.scrollTo({
            top: viewport.scrollTop + shiftAmount,
            behavior: 'smooth'
        });
    }
  };

  // --- Helper for AI Flow: Sentence Parsing (From Legacy) ---
  const getNextSentenceInfo = (startPageNum, startTokenId) => {
      let tokens = pageTokensMap.current.get(startPageNum) || [];
      if (tokens.length === 0) return { nextPage: true, pageNum: startPageNum };

      let startIndex = 0;
      if (startTokenId) {
          startIndex = tokens.findIndex(t => t.id === startTokenId);
          if (startIndex === -1) startIndex = 0;
      }

      if (startIndex >= tokens.length) return { nextPage: true, pageNum: startPageNum };

      const sentenceTokens = [];
      let nextIndex = startIndex;

      for (let i = startIndex; i < tokens.length; i++) {
          const t = tokens[i];
          sentenceTokens.push(t);
          nextIndex = i + 1;
          // Basic Sentence Boundary Check
          if (/[.!?]["']?$/.test(t.spokenText.trim())) {
              break;
          }
      }

      return {
          tokens: sentenceTokens,
          pageNum: startPageNum,
          nextTokenId: nextIndex < tokens.length ? tokens[nextIndex].id : null,
          nextPageNum: nextIndex >= tokens.length ? startPageNum + 1 : startPageNum
      };
  };

  // --- NEW: AI-Enhanced Playback Loop ---
  const playNextSentenceAI = async (pageNum, tokenId) => {
      if (!isPlayingRef.current) return;

      const info = getNextSentenceInfo(pageNum, tokenId);

      // Handle Page Transitions
      if (info.nextPage && !info.tokens) {
          if (info.pageNum < numPages) {
              const nextPage = info.pageNum + 1;
              if (pageTokensMap.current.has(nextPage)) {
                  const nextTokens = pageTokensMap.current.get(nextPage);
                  playNextSentenceAI(nextPage, nextTokens[0]?.id);
              } else {
                  waitingForPageRef.current = nextPage;
                  if (pageRefs.current[nextPage]) {
                      pageRefs.current[nextPage].scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
              }
          } else {
              setIsPlaying(false);
          }
          return;
      }

      const sentenceTokens = info.tokens;
      if (!sentenceTokens || sentenceTokens.length === 0) return;

      const firstTokenId = sentenceTokens[0].id;
      setActiveTokenId(firstTokenId);
      if (pageNum !== activePage) setActivePage(pageNum);

      // Scroll to current sentence
      handleSmartScroll(pageNum, firstTokenId);

      let textToSpeak = sentenceTokens.map(t => t.spokenText).join(' ');
      textToSpeak = applySkippingRules(textToSpeak, speechCustomizationRef.current);

      // --- AI VISUAL FIX STEP ---
      if (textToSpeak.trim() && pageRefs.current[pageNum]) {
          const ids = sentenceTokens.map(t => t.id);
          // Get clean image of JUST this sentence
          const imgBase64 = pageRefs.current[pageNum].getWrappedImageForTokens(ids);

          if (imgBase64) {
              setOcrLoading(true); // Show Spinner
              
              const aiResult = await fixTranscriptWithAI(
                  imgBase64, 
                  textToSpeak, 
                  aiConfig.apiKey, 
                  aiConfig.instructions,
                  aiConfig.model
              );

              setOcrLoading(false); // Hide Spinner
              setTotalCost(getStoredCost()); // Update Cost UI

              if (!isPlayingRef.current) return; // Check if paused during fetch

              if (aiResult.transcript && !aiResult.error) {
                  textToSpeak = aiResult.transcript;
              }
          }
      }
      // ---------------------------

      textToSpeak = applyCustomPronunciations(textToSpeak, customPronunciationsRef.current);

      if (!textToSpeak.trim()) {
          if (info.nextTokenId) {
              playNextSentenceAI(info.pageNum, info.nextTokenId);
          } else {
              playNextSentenceAI(info.nextPageNum, null);
          }
          return;
      }

      const utter = new SpeechSynthesisUtterance(textToSpeak);
      utter.rate = rateRef.current;
      const targetVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
      if (targetVoice) { utter.voice = targetVoice; utter.lang = targetVoice.lang; }

      utter.onend = () => {
          if (isJumpingRef.current) return;
          if (isPlayingRef.current) {
              if (info.nextTokenId) {
                  playNextSentenceAI(info.pageNum, info.nextTokenId);
              } else {
                  playNextSentenceAI(info.nextPageNum, null);
              }
          }
      };

      utter.onerror = (e) => {
          if (isJumpingRef.current) return;
          if (e.error !== 'interrupted' && e.error !== 'canceled') {
              console.error("Speech Error", e);
              setIsPlaying(false);
          }
      };

      synth.speak(utter);
  };

  // --- TTS Engine (Standard Batch Mode) ---

  const scheduleNextBatch = (startPageNum, carryOverTokens, isFirstBatch = false, allowWait = true) => {
    if (!isPlayingRef.current) return false;

    let pool = [...carryOverTokens];
    
    if (pool.length === 0) {
        const pageTokens = pageTokensMap.current.get(startPageNum);
        if (!pageTokens) {
            if (allowWait) {
                waitingForPageRef.current = startPageNum;
                // Scroll into view if waiting for page
                if (pageRefs.current[startPageNum]) {
                    pageRefs.current[startPageNum].scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
            return false;
        }
        pool = [...pageTokens];
    }

    const nextPageNum = startPageNum + 1;
    const nextPageTokens = pageTokensMap.current.get(nextPageNum);
    let hasNextPage = false;

    if (nextPageTokens && nextPageTokens.length > 0) {
        pool = [...pool, ...nextPageTokens];
        hasNextPage = true;
    }

    let endIndex = pool.length;
    let nextLeftovers = [];
    
    if (hasNextPage) {
        let safetyFound = false;
        for (let i = pool.length - 1; i > 0; i--) {
             const txt = pool[i].spokenText.trim();
             if (!txt) continue;

             if (/[.!?]["']?$/.test(txt)) {
                 endIndex = i + 1;
                 safetyFound = true;
                 break;
             }
        }
        if (safetyFound && endIndex < pool.length) {
            nextLeftovers = pool.slice(endIndex);
            pool = pool.slice(0, endIndex);
        }
    }

    // Apply skipping rules on the full joined text so bracket pairs that span
    // multiple tokens (e.g. "(hello world)") are matched correctly, then split
    // back to per-token pieces for the character map.
    const rawTokenTexts = pool.map(t => t.spokenText || '');
    const joinedRaw = rawTokenTexts.join(' ');

    // Build per-token pronunciation-corrected texts (skipping is handled separately below)
    const cleanedTokenTexts = [];
    {
        for (let ti = 0; ti < rawTokenTexts.length; ti++) {
            let tokText = rawTokenTexts[ti];
            tokText = applyCustomPronunciations(tokText, customPronunciationsRef.current);
            cleanedTokenTexts.push(tokText);
        }
    }

    // Now figure out which tokens were removed by skipping rules.
    // Re-apply skipping rules to identify removed regions in the raw joined text,
    // then mark tokens that overlap with those regions.
    const removedRanges = [];
    const skippingPatterns = [];
    if (speechCustomizationRef.current.skipUrls) skippingPatterns.push(/https?:\/\/\S+|www\.\S+/gi);
    if (speechCustomizationRef.current.skipSquare) skippingPatterns.push(/\[[^\]]*\]/g);
    if (speechCustomizationRef.current.skipParens) skippingPatterns.push(/\([^)]*\)/g);
    if (speechCustomizationRef.current.skipCurly) skippingPatterns.push(/\{[^}]*\}/g);

    for (const pat of skippingPatterns) {
        let m;
        while ((m = pat.exec(joinedRaw)) !== null) {
            removedRanges.push([m.index, m.index + m[0].length]);
        }
    }

    // For each token, check if it's fully inside a removed range
    const tokenSkipped = [];
    {
        let rawPos = 0;
        for (let ti = 0; ti < rawTokenTexts.length; ti++) {
            const rawTok = rawTokenTexts[ti];
            const tStart = rawPos;
            const tEnd = rawPos + rawTok.length;
            rawPos = tEnd + 1;
            const isSkipped = removedRanges.some(([rStart, rEnd]) => tStart >= rStart && tStart < rEnd);
            tokenSkipped.push(isSkipped);
        }
    }

    let script = "";
    const map = [];
    pool.forEach((token, ti) => {
        if (tokenSkipped[ti]) return;
        let text = cleanedTokenTexts[ti];
        if (!text || !text.trim()) return;

        const start = script.length;
        script += text + " ";
        const end = start + text.length;
        map.push({ start, end, token });
    });

    if (!script.trim()) {
        if (startPageNum < numPages) {
            return scheduleNextBatch(nextPageNum, nextLeftovers, false, allowWait);
        } else {
            setIsPlaying(false);
            return false;
        }
    }

    const utter = new SpeechSynthesisUtterance(script);
    utter.rate = rateRef.current;
    const targetVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
    if (targetVoice) { utter.voice = targetVoice; utter.lang = targetVoice.lang; }
    
    utter.audioMap = map;
    utter.nextBatchInfo = {
        pageNum: hasNextPage ? nextPageNum : startPageNum + 1,
        leftovers: nextLeftovers
    };
    utter.hasQueuedNext = false; 

    utter.onboundary = (event) => {
        if (!isPlayingRef.current) { synth.cancel(); return; }
        
        const currentMap = event.target.audioMap;
        if (!currentMap) return;

        const currentIdx = event.charIndex;
        const entry = currentMap.find(m => currentIdx >= m.start && currentIdx < m.end);
        
        if (entry) {
            const tokenId = entry.token.id;
            const pageNum = entry.token.pageNum;

            setActiveTokenId(tokenId);
            
            if (pageNum !== activePage) {
                setActivePage(pageNum);
            }
            
            // Execute Smart Scroll Logic
            handleSmartScroll(pageNum, tokenId);
        }
    };

    utter.onstart = (event) => {
        if (!isPlayingRef.current) return;
        const info = event.target.nextBatchInfo;
        
        if (info && !event.target.hasQueuedNext && info.pageNum <= numPages) {
             const queued = scheduleNextBatch(info.pageNum, info.leftovers, false, false);
             if (queued) {
                 event.target.hasQueuedNext = true;
             }
        }
    };

    utter.onend = (event) => {
        // If we are currently jumping (manual click), ignore the 'end' event 
        // from the canceled utterance so we don't stop playback.
        if (isJumpingRef.current) return;

        if (!isPlayingRef.current) return;
        if (!event.target.hasQueuedNext) {
            const info = event.target.nextBatchInfo;
            if (info && info.pageNum <= numPages) {
                 scheduleNextBatch(info.pageNum, info.leftovers, false, true);
            } else {
                setIsPlaying(false);
                setActiveTokenId(null);
            }
        }
    };

    utter.onerror = (event) => {
        // Ignore errors caused by manual cancellation or during a jump
        if (isJumpingRef.current) return;
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        
        if (isPlayingRef.current) setIsPlaying(false);
    };

    synth.speak(utter);
    return true;
  };

  const togglePlay = () => {
    if (isMarkingMode) return;
    if (isPlaying) {
        setIsPlaying(false);
        isPlayingRef.current = false;
        waitingForPageRef.current = null;
        synth.cancel();
    } else {
        setIsPlaying(true);
        isPlayingRef.current = true;
        const tokens = pageTokensMap.current.get(activePage) || [];
        
        // Determine Start Token
        let startTokenId = activeTokenId;
        if (!startTokenId && tokens.length > 0) startTokenId = tokens[0].id;

        // Route based on AI Config
        if (aiConfig.enabled) {
            playNextSentenceAI(activePage, startTokenId);
        } else {
            let startTokens = [];
            if (startTokenId && tokens.length > 0) {
                const idx = tokens.findIndex(t => t.id === startTokenId);
                startTokens = idx >= 0 ? tokens.slice(idx) : tokens;
            } else {
                startTokens = tokens;
            }
            scheduleNextBatch(activePage, startTokens, true); 
        }
    }
  };

  // --- Keyboard Navigation Logic (Word/Sentence aware) ---
  const handleSmartNavigation = useCallback((direction) => {
    // direction: -1 (prev) or 1 (next)
    const tokens = pageTokensMap.current.get(activePage) || [];
    if (tokens.length === 0) return;

    let currentIndex = -1;
    if (activeTokenId) {
        currentIndex = tokens.findIndex(t => t.id === activeTokenId);
    }
    
    // Default to start if not found
    if (currentIndex === -1) currentIndex = 0;

    let newIndex = currentIndex;
    
    if (readingMode === 'word') {
        newIndex = currentIndex + direction;
    } else {
        // Sentence Mode logic: Find previous/next punctuation boundary
        if (direction === 1) {
            // Find next sentence start
            for (let i = currentIndex; i < tokens.length; i++) {
                 if (/[.!?]["']?$/.test(tokens[i].spokenText)) {
                     newIndex = i + 1;
                     break;
                 }
                 // If we reach end, newIndex becomes tokens.length (trigger next page)
                 if (i === tokens.length - 1) newIndex = tokens.length;
            }
        } else {
            // Find previous sentence start
            // Scan backwards from current index - 2 (to skip immediately preceding punctuation)
            let found = false;
            for (let i = currentIndex - 2; i >= 0; i--) {
                if (/[.!?]["']?$/.test(tokens[i].spokenText)) {
                    newIndex = i + 1;
                    found = true;
                    break;
                }
            }
            if (!found) newIndex = -1; // Trigger prev page
        }
    }

    // Boundary Checks
    if (newIndex < 0) {
        // Go to previous page
        if (activePage > 1) {
             const prevPage = activePage - 1;
             const prevTokens = pageTokensMap.current.get(prevPage);
             // Start reading from the very beginning of previous page (common behavior) 
             setActivePage(prevPage);
             performJump(prevPage);
             // Wait for state update is hard in callback. 
             // We manually call click with new data
             if (prevTokens && prevTokens.length > 0) {
                 handleTokenClick(prevTokens, prevTokens[0].id, prevPage);
             }
        }
    } else if (newIndex >= tokens.length) {
        // Go to next page
        if (activePage < numPages) {
            const nextPage = activePage + 1;
            const nextTokens = pageTokensMap.current.get(nextPage);
            setActivePage(nextPage);
            performJump(nextPage);
            if (nextTokens && nextTokens.length > 0) {
                handleTokenClick(nextTokens, nextTokens[0].id, nextPage);
            }
        }
    } else {
        // Same page jump
        handleTokenClick(tokens, tokens[newIndex].id, activePage);
    }

  }, [activePage, activeTokenId, readingMode, numPages, handleTokenClick, performJump]);

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
        // Ignore inputs unless it's specific keys that shouldn't matter (like F1)
        const tag = e.target.tagName.toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
             if (e.key === 'Escape') e.target.blur();
             return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) {
          return;
        }

        const key = e.key.toLowerCase();

        switch (key) {
            case 'o':
                e.preventDefault();
                if (fileInputRef.current) fileInputRef.current.click();
                break;
            case 'w':
                e.preventDefault();
                performJump(activePage - 1);
                break;
            case 's':
                e.preventDefault();
                performJump(activePage + 1);
                break;
            case 'a':
                e.preventDefault();
                handleSmartNavigation(-1);
                break;
            case 'd':
                e.preventDefault();
                handleSmartNavigation(1);
                break;
            case 'f':
                e.preventDefault();
                toggleFitMode();
                break;
            case 'r': // Reading Mode (Mapped from "M switch reading mode" conflict)
                e.preventDefault();
                setReadingMode(prev => prev === 'sentence' ? 'word' : 'sentence');
                break;
            case 'n':
                e.preventDefault();
                setAutoScroll(prev => !prev);
                break;
            case 'z': // Focus Mode (Mapped from "H" conflict)
                e.preventDefault();
                setAutoHide(prev => !prev);
                break;
            case 'p':
                e.preventDefault();
                if (jumpInputRef.current) jumpInputRef.current.focus();
                break;
            case ' ':
                e.preventDefault();
                togglePlay();
                break;
            case 'v':
                e.preventDefault();
                setShowSettings(true); // Ensure settings are visible first
                setTimeout(() => {
                    if (voiceSelectRef.current) {
                        voiceSelectRef.current.focus();
                        try {
                            if (typeof voiceSelectRef.current.showPicker === 'function') {
                                voiceSelectRef.current.showPicker();
                            }
                        } catch (err) {
                            console.warn('Could not open voice picker programmatically', err);
                        }
                    }
                }, 10);
                break;
            case 'c': // Customize Speech
                e.preventDefault();
                setShowCustomSpeech(prev => !prev);
                break;
            case 'm': // Mark Skip (Mapped from "M Mark Skip")
                e.preventDefault();
                // If playing, pause first
                if (isPlaying) togglePlay();
                setIsMarkingMode(prev => !prev);
                break;
            case 'h': // Help
                e.preventDefault();
                setShowHelp(prev => !prev);
                break;
            default:
                break;
        }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activePage, activeTokenId, readingMode, isPlaying, numPages, handleSmartNavigation, performJump, toggleFitMode]);

  const handleDebugExtract = async () => {
      const pageRef = pageRefs.current[activePage];
      if (pageRef && pageRef.generateDebugImages) {
          const images = await pageRef.generateDebugImages();
          setDebugImages(images);
          setShowSettings(false); 
      } else {
          alert("Debug: Page not ready or loaded.");
      }
  };

  const handleResetCost = () => {
    if(confirm("Reset accumulated cost tracker to $0.00?")) {
        setTotalCost(resetCostUsage());
    }
  };

  return (
    <div className="app-layout" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* Hidden File Input with Ref */}
      <input 
        type="file" 
        accept="application/pdf" 
        onChange={onFileChange} 
        style={{display:'none'}} 
        ref={fileInputRef}
      />

      {isDragging && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '24px', pointerEvents: 'none' }}>
            <div><Icons.Upload style={{width: 64, height: 64, marginBottom: 20}} /><p>Drop PDF to Open</p></div>
        </div>
      )}

      {/* HELP MODAL */}
      {showHelp && (
          <div className="modal-overlay" onClick={() => setShowHelp(false)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                      <h3>Keyboard Shortcuts</h3>
                      <button className="icon-btn" onClick={() => setShowHelp(false)}><Icons.Close /></button>
                  </div>
                  <div className="modal-body">
                      <table className="shortcuts-table">
                          <tbody>
                              <tr><td><kbd>O</kbd></td><td>Open File</td></tr>
                              <tr><td><kbd>Space</kbd></td><td>Play / Pause</td></tr>
                              <tr><td><kbd>W</kbd> / <kbd>S</kbd></td><td>Prev / Next Page</td></tr>
                              <tr><td><kbd>A</kbd> / <kbd>D</kbd></td><td>Prev / Next Sentence (or Word)</td></tr>
                              <tr><td><kbd>F</kbd></td><td>Toggle Fit Mode</td></tr>
                              <tr><td><kbd>R</kbd></td><td>Switch Reading Mode (Sentence/Word)</td></tr>
                              <tr><td><kbd>C</kbd></td><td>Toggle Customize Speech</td></tr>
                              <tr><td><kbd>M</kbd></td><td>Toggle Mark Skip Mode</td></tr>
                              <tr><td><kbd>N</kbd></td><td>Toggle Auto-Scroll</td></tr>
                              <tr><td><kbd>Z</kbd></td><td>Toggle Focus Mode (Auto-Hide)</td></tr>
                              <tr><td><kbd>P</kbd></td><td>Focus Page Input</td></tr>
                              <tr><td><kbd>V</kbd></td><td>Focus Voice Selection</td></tr>
                              <tr><td><kbd>H</kbd></td><td>Toggle this Help</td></tr>
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>
      )}

      {/* CUSTOMIZE SPEECH MODAL */}
      {showCustomSpeech && (
          <SpeechCustomizationPanel 
              speechCustomization={speechCustomization}
              setSpeechCustomization={setSpeechCustomization}
              customPronunciations={customPronunciations}
              setCustomPronunciations={setCustomPronunciations}
              onClose={() => setShowCustomSpeech(false)}
          />
      )}

      <main className="main-content">
        <div className="scroll-viewport" ref={viewportRef}>
            {isLoading && (
                <div className="loading-overlay">
                    <div className="spinner"></div>
                    <p>Processing Document...</p>
                </div>
            )}
            {!pdf ? (
                <div className="dashboard-container">
                    <div className="empty-placeholder">
                        <label className="upload-btn main-upload" onClick={() => fileInputRef.current.click()}>
                            <Icons.Upload /> Open PDF File
                        </label>
                        <p style={{marginTop: '20px', color: '#9e9e9e', fontSize: '14px'}}>or drag and drop a file here</p>
                        <button 
                            className="upload-btn" 
                            onClick={() => setShowHelp(true)} 
                            style={{ border: '1px solid #3f3f46' }}
                        >
                            <span style={{ fontSize: '16px', fontWeight: 'bold' }}>?</span>
                            (Press H for Help Menu)
                        </button>
                        
                    </div>

                    {/* RECENT FILES SECTION */}
                    {recentFiles.length > 0 && (
                        <div className="recent-files-section">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #3f3f46', marginBottom: '20px', paddingBottom: '10px' }}>
                                <h3 style={{ margin: 0, border: 'none', padding: 0 }}>Recently Opened</h3>
                                
                                {/* Toggle Button for layout view */}
                                <button 
                                    className="icon-btn" 
                                    onClick={() => setGlobalSettings(prev => ({
                                        ...prev, 
                                        layoutMode: prev.layoutMode === 'grid' ? 'list' : 'grid' 
                                    }))}
                                    title={`Switch to ${globalSettings.layoutMode === 'grid' ? 'List' : 'Grid'} Layout`}
                                >
                                    {globalSettings.layoutMode === 'grid' ? <Icons.List /> : <Icons.Grid />}
                                </button>
                            </div>

                            <div className={globalSettings.layoutMode === 'grid' ? 'recent-grid' : 'recent-list'}>
                                {recentFiles.map(file => (
                                    <div key={file.id} className="recent-card" onClick={() => handleRecentClick(file)}>
                                        <div className="recent-thumb">
                                            {file.thumbnail ? <img src={file.thumbnail} alt="preview" /> : <div className="no-thumb">PDF</div>}
                                            <div className="page-badge">Pg {file.lastPage}</div>
                                        </div>
                                        <div className="recent-info">
                                            <div className="recent-name" title={file.name}>{file.name}</div>
                                            <div className="recent-date">
                                                {new Date(file.lastOpened).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            ) : (
                <>
                    <div className={`pdf-stream ${darkMode ? 'dark-mode' : ''}`}>
                        {Array.from(new Array(numPages), (_, i) => i + 1).map(pageNum => (
                            <PDFPage 
                                key={pageNum}
                                ref={(r) => registerPageRef(pageNum, r)}
                                pdfDoc={pdf}
                                pageNum={pageNum}
                                scale={scale}
                                rotation={rotation}
                                activeTokenId={activeTokenId}
                                readingMode={readingMode} 
                                onTokensParsed={handleTokenClick}
                                notifyPageVisible={notifyPageVisible}
                                registerPageTokens={handlePageTokensRegistered}
                                isMarkingMode={isMarkingMode}
                                skipZones={skipZones}
                                onAddSkipZone={handleAddSkipZone}
                                onRemoveSkipZone={handleRemoveSkipZone}
                                highlightEnabled={highlightEnabled}
                                highlightColor={highlightColor}
                                highlightOpacity={highlightOpacity}
                                speechCustomization={speechCustomization}
                                customPronunciations={customPronunciations}
                            />
                        ))}
                    </div>
                    {debugImages.length > 0 && (
                        <div className="debug-panel" style={{ padding: '20px', background: '#f5f5f5', borderTop: '1px solid #ccc' }}>
                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 15}}>
                                <h3>Debug Extraction Output ({debugImages.length})</h3>
                                <button className="icon-btn" onClick={() => setDebugImages([])}><Icons.Close/> Clear</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {debugImages.map((item, idx) => (
                                    <div key={idx} style={{ background: 'white', padding: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}>
                                        <div style={{ marginBottom: '5px', fontSize: '12px', color: '#555', fontFamily: 'monospace' }}>
                                            {item.text}
                                        </div>
                                        <img src={item.img} alt={`Sentence ${idx}`} style={{ maxWidth: '100%', border: '1px solid #ddd' }} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
        
        {/* OCR LOADING INDICATOR */}
        {ocrLoading && (
            <div style={{position: 'absolute', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: '#333', color: 'white', padding: '8px 16px', borderRadius: '20px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', zIndex: 2000}}>
                <div className="spinner" style={{width: 14, height: 14, borderWidth: 2, marginBottom: 0}}></div> AI Improving Text...
            </div>
        )}

        {pdf && (
            <div className={`player-bar-container ${autoHide ? 'auto-hide-active' : ''}`}>
                <div className="player-bar">
                    {/* LEFT: Playback & Navigation */}
                    <div className="section-left">
                        <button className="icon-btn" onClick={togglePlay} disabled={isMarkingMode} style={{ opacity: isMarkingMode ? 0.5 : 1 }} title="Play/Pause (Space)">
                            {isPlaying ? <Icons.Pause /> : <Icons.Play />}
                        </button>
                        <div className="divider-vertical"></div>
                        <div className="jump-group">
                            <span className="label">Pg</span>
                            <input 
                                ref={jumpInputRef}
                                type="number" min="1" max={numPages} value={jumpInput} 
                                onChange={(e) => setJumpInput(e.target.value)}
                                onKeyDown={handleJumpKey}
                                onFocus={() => setIsInputFocused(true)}
                                onBlur={() => setIsInputFocused(false)}
                                className="page-input"
                                title="Page Number (P)"
                            />
                            <span className="label">/ {numPages}</span>
                        </div>
                    </div>
                    
                    {/* CENTER: View Controls */}
                    <div className="section-center">
                        <div className="zoom-group">
                            <button className="icon-btn-ghost" onClick={handleZoomOut} title="Zoom Out">-</button>
                            <input 
                                className="zoom-input"
                                type="text"
                                value={zoomInput}
                                onChange={handleZoomInputChange}
                                onBlur={handleZoomInputBlur}
                                onKeyDown={handleZoomInputKeyDown}
                            />
                            <span className="zoom-unit">%</span>
                            <button className="icon-btn-ghost" onClick={handleZoomIn} title="Zoom In">+</button>
                        </div>

                        <div className="divider-vertical small"></div>

                        <button className="text-btn" onClick={toggleFitMode} title="Toggle Fit (F)">
                           {fitMode === 'width' ? 'Fit W' : fitMode === 'height' ? 'Fit H' : 'Fit'}
                        </button>

                         <div className="divider-vertical small"></div>
                        
                        <button className="icon-btn" onClick={handleRotate} title="Rotate 90°">
                            <Icons.Rotate style={{ width: '20px', height: '20px' }} />
                        </button>
                    </div>

                    {/* RIGHT: Tools & Settings */}
                    <div className="section-right">
                        <div style={{ position: 'relative' }}>
                            <button 
                                className={`icon-btn ${showCustomSpeech ? 'active' : ''}`} 
                                onClick={() => setShowCustomSpeech(!showCustomSpeech)} 
                                title="Customize Speech (C)"
                            >
                                <Icons.Pencil />
                            </button>
                        </div>

                        <button 
                            className={`icon-btn ${isMarkingMode ? 'active-danger' : ''}`} 
                            onClick={() => { if (!isMarkingMode && isPlaying) togglePlay(); setIsMarkingMode(!isMarkingMode); }} 
                            title="Mark Skip Area (M)"
                        >
                            <Icons.Crop />
                        </button>

                        <button 
                            className={`icon-btn ${darkMode ? 'active' : ''}`} 
                            onClick={() => setDarkMode(!darkMode)} 
                            title="Toggle Dark Mode"
                        >
                            <Icons.Moon /> 
                        </button>

                        {/* NEW: Upload Button in Reader */}
                        <button 
                            className="icon-btn"
                            onClick={() => fileInputRef.current.click()}
                            title="Open File (O)"
                        >
                            <Icons.Upload />
                        </button>


                        <button
                            className={`icon-btn ${showHelp ? 'active' : ''}`}
                            onClick={() => setShowHelp(!showHelp)}
                            title="Shortcuts (H)"
                        >
                            <span style={{fontSize: '18px', fontWeight: 'bold'}}>?</span>
                        </button>

                        <div style={{ position: 'relative' }}>
                            <button 
                                ref={settingsBtnRef}
                                className={`icon-btn ${showSettings ? 'active' : ''}`} 
                                onClick={() => setShowSettings(!showSettings)} 
                                title="Settings"
                            >
                                <Icons.Settings />
                            </button>

                            {showSettings && (
                                <div className="settings-popup" ref={settingsRef}>
                                    <div className="settings-header">Reading Settings</div>
                                    
                                    {/* AI CONFIGURATION SECTION */}
                                    <div className="setting-item" style={{flexDirection: 'column', alignItems: 'stretch', gap: 5, paddingBottom: 10, borderBottom: '1px solid #eee'}}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                            <label style={{fontWeight:'bold', color: '#6200ea'}}>AI Fix Mode</label>
                                            <input type="checkbox" checked={aiConfig.enabled} onChange={e => setAiConfig({...aiConfig, enabled: e.target.checked})} />
                                        </div>
                                        {aiConfig.enabled && (
                                            <>
                                                <input 
                                                    type="text" 
                                                    placeholder="API Key (OpenAI / Gemini)" 
                                                    value={aiConfig.apiKey} 
                                                    onChange={e => setAiConfig({...aiConfig, apiKey: e.target.value})}
                                                    style={{ fontSize: '12px', fontFamily: 'monospace', width: '100%', padding: 4 }}
                                                />
                                                <select 
                                                    value={aiConfig.model} 
                                                    onChange={e => setAiConfig({...aiConfig, model: e.target.value})}
                                                    style={{ width: '100%', padding: 4, fontSize: '12px' }}
                                                >
                                                    <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Fastest)</option>
                                                    <option value="gemini-3-flash-preview">Gemini 3 Flash (High Quality)</option>
                                                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                                                    <option value="gpt-4o">GPT-4o</option>
                                                </select>
                                                <textarea
                                                    placeholder="Custom instructions (e.g. Skip equations...)"
                                                    value={aiConfig.instructions}
                                                    onChange={e => setAiConfig({...aiConfig, instructions: e.target.value})}
                                                    rows={2}
                                                    style={{ width: '100%', fontSize: '11px', resize:'none' }}
                                                />
                                                <div style={{display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#666', marginTop: 5}}>
                                                    <span>Cost: ${totalCost.toFixed(6)}</span>
                                                    <button onClick={handleResetCost} style={{background:'none', border:'none', color:'#d32f2f', cursor:'pointer', padding:0}}>Reset</button>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div className="setting-item">
                                        <label><Icons.Voice /> Voice</label>
                                        <select 
                                            ref={voiceSelectRef}
                                            value={selectedVoiceURI} 
                                            onChange={e => setSelectedVoiceURI(e.target.value)} 
                                            className="voice-select"
                                        >
                                            {voices.map(v => (
                                                <option key={v.voiceURI} value={v.voiceURI}>{v.name.slice(0, 24)}...</option>
                                            ))}
                                        </select>
                                    </div>


                                    <div className="setting-item">
                                        <label style={{flex: 1}}>Reading Mode (R)</label>
                                        <div className="toggle-group">
                                            <button 
                                                className={`toggle-btn ${readingMode === 'word' ? 'active' : ''}`}
                                                onClick={() => setReadingMode('word')}
                                            >
                                                Word
                                            </button>
                                            <button 
                                                className={`toggle-btn ${readingMode === 'sentence' ? 'active' : ''}`}
                                                onClick={() => setReadingMode('sentence')}
                                            >
                                                Sentence
                                            </button>
                                        </div>
                                    </div>

                                    <div className="setting-item">
                                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'}}>
                                            <label>Focus Mode (Auto-Hide) (Z)</label>
                                            <input 
                                                type="checkbox" 
                                                checked={autoHide} 
                                                onChange={(e) => setAutoHide(e.target.checked)} 
                                                style={{ width: 'auto' }}
                                            />
                                        </div>
                                    </div>

                                    {/* Auto-Scroll Setting */}
                                    <div className="setting-item">
                                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'}}>
                                            <label>Auto-Scroll (N)</label>
                                            <input 
                                                type="checkbox" 
                                                checked={autoScroll} 
                                                onChange={(e) => setAutoScroll(e.target.checked)} 
                                                style={{ width: 'auto' }}
                                            />
                                        </div>
                                    </div>

                                    <div className="setting-item">
                                        <div className="label-row">
                                            <label>Speed</label>
                                            <span className="value-badge">{rate.toFixed(1)}x</span>
                                        </div>
                                        <input 
                                            type="range" 
                                            className="styled-slider"
                                            min="0.5" max="3.0" step="0.1" 
                                            value={rate} 
                                            onChange={e => setRate(Number(e.target.value))} 
                                        />
                                        <div className="slider-labels">
                                            <span>0.5x</span>
                                            <span>3.0x</span>
                                        </div>
                                    </div>

                                    <div className="setting-divider"></div>

                                    {/* HIGHLIGHT SETTINGS */}
                                    <div className="setting-item">
                                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                                            <label>Highlighting</label>
                                            <input 
                                                type="checkbox" 
                                                checked={highlightEnabled} 
                                                onChange={e => setHighlightEnabled(e.target.checked)} 
                                                style={{ width: 'auto' }}
                                            />
                                        </div>
                                        
                                        {highlightEnabled && (
                                            <>
                                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px'}}>
                                                    <label style={{fontSize: '13px', color: '#555'}}>Color</label>
                                                    <input 
                                                        type="color" 
                                                        value={highlightColor} 
                                                        onChange={e => setHighlightColor(e.target.value)}
                                                        style={{ width: '40px', height: '25px', padding: 0, border: 'none' }}
                                                    />
                                                </div>
                                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                                                    <label style={{fontSize: '13px', color: '#555'}}>Opacity</label>
                                                    <input 
                                                        type="range" 
                                                        min="0.1" max="1.0" step="0.1" 
                                                        value={highlightOpacity}
                                                        onChange={e => setHighlightOpacity(Number(e.target.value))}
                                                        style={{ width: '80px' }}
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    
                                    <div className="setting-divider"></div>
                                    
                                    <button onClick={handleDebugExtract} className="menu-btn" title="Generate Sentence Images">
                                        Sentence Segmentation Preview
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}
      </main>
      <style>{`
          .modal-overlay {
              position: fixed; top: 0; left: 0; right: 0; bottom: 0;
              background: rgba(0,0,0,0.5); z-index: 10000;
              display: flex; align-items: center; justify-content: center;
          }
          .modal-content {
              background: white; width: 500px; max-width: 90%;
              border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
              overflow: hidden;
              color: #333;
          }
          .modal-header {
              padding: 15px 20px; border-bottom: 1px solid #eee;
              display: flex; justify-content: space-between; align-items: center;
          }
          .modal-body { padding: 20px; }
          .shortcuts-table { width: 100%; border-collapse: collapse; }
          .shortcuts-table td { padding: 8px 0; border-bottom: 1px solid #f5f5f5; }
          .shortcuts-table tr:last-child td { border-bottom: none; }
          kbd {
              background-color: #f7f7f7; border: 1px solid #ccc;
              border-radius: 3px; box-shadow: 0 1px 0 rgba(0,0,0,0.2);
              color: #333; display: inline-block; font-size: 11px;
              line-height: 1.4; margin: 0 2px; padding: 0 5px;
              white-space: nowrap; font-family: monospace;
          }
      `}</style>
    </div>
  );
};

export default App;