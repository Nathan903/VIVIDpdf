import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';
import PDFPage from './PDFPage';
import { Icons } from './Icons';
import { initDB, saveFileRecord, getRecentFiles, updateFileMeta, getFileId } from './db';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// --- Local Storage Keys ---
const LS_GLOBALS = 'pdf_reader_globals';
const LS_API_KEY = 'pdf_reader_api_key'; // NEW: Dedicated key for storage

// --- CONFIG ---
// We no longer hardcode the key here.
// We will load it from Import Meta (Vite) as a default fallback.
const ENV_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

const DEFAULT_GLOBALS = {
  voiceURI: "",
  readingMode: 'sentence',
  rate: 1.0,
  highlightEnabled: true,
  highlightColor: '#ffeb3b',
  highlightOpacity: 0.4,
  autoHide: false,
  autoScroll: true
};

const App = () => {
  const [globalSettings, setGlobalSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_GLOBALS);
      return saved ? { ...DEFAULT_GLOBALS, ...JSON.parse(saved) } : DEFAULT_GLOBALS;
    } catch (e) {
      return DEFAULT_GLOBALS;
    }
  });

  // --- API KEY STATE ---
  const [apiKey, setApiKey] = useState(() => {
      // 1. Try LocalStorage
      const stored = localStorage.getItem(LS_API_KEY);
      if (stored) return stored;
      // 2. Try Environment Variable (Vite)
      return ENV_API_KEY;
  });

  // Save API Key when it changes
  useEffect(() => {
      if (apiKey) localStorage.setItem(LS_API_KEY, apiKey);
  }, [apiKey]);

  const [autoHide, setAutoHide] = useState(globalSettings.autoHide);
  const [autoScroll, setAutoScroll] = useState(globalSettings.autoScroll);
  const [pdf, setPdf] = useState(null);
  const [fileId, setFileId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const [rate, setRate] = useState(globalSettings.rate);
  const [isDragging, setIsDragging] = useState(false);
  const [readingMode, setReadingMode] = useState(globalSettings.readingMode);
  const [highlightEnabled, setHighlightEnabled] = useState(globalSettings.highlightEnabled);
  const [highlightColor, setHighlightColor] = useState(globalSettings.highlightColor);
  const [highlightOpacity, setHighlightOpacity] = useState(globalSettings.highlightOpacity);
  const [numPages, setNumPages] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [jumpInput, setJumpInput] = useState("1");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [scale, setScale] = useState(1.5);
  const [rotation, setRotation] = useState(0);
  const [zoomInput, setZoomInput] = useState("150");
  const [fitMode, setFitMode] = useState('custom');
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(globalSettings.voiceURI);
  const [activeTokenId, setActiveTokenId] = useState(null);
  const [isMarkingMode, setIsMarkingMode] = useState(false);
  const [skipZones, setSkipZones] = useState([]);
  const [debugImages, setDebugImages] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [recentFiles, setRecentFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // --- DEBUG STATES ---
  const [ocrLoading, setOcrLoading] = useState(false);
  const [debugOcrImage, setDebugOcrImage] = useState(null);
  const [debugOcrText, setDebugOcrText] = useState("");

  const isPlayingRef = useRef(false);
  const isJumpingRef = useRef(false);
  const rateRef = useRef(rate);
  const autoScrollRef = useRef(autoScroll);
  const synth = window.speechSynthesis;
  const pageRefs = useRef({});
  const viewportRef = useRef(null);
  const settingsRef = useRef(null);
  const settingsBtnRef = useRef(null);
  const fileInputRef = useRef(null);
  const jumpInputRef = useRef(null);
  const voiceSelectRef = useRef(null);
  const pageTokensMap = useRef(new Map());
  const waitingForPageRef = useRef(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);

  // --- Persistence & Init ---
  useEffect(() => {
    const settings = {
      voiceURI: selectedVoiceURI,
      readingMode,
      rate,
      highlightEnabled,
      highlightColor,
      highlightOpacity,
      autoHide,
      autoScroll
    };
    localStorage.setItem(LS_GLOBALS, JSON.stringify(settings));
  }, [selectedVoiceURI, readingMode, rate, highlightEnabled, highlightColor, highlightOpacity, autoHide, autoScroll]);

  useEffect(() => { loadRecentFilesList(); }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
        if (showSettings && settingsRef.current && !settingsRef.current.contains(event.target) &&
            settingsBtnRef.current && !settingsBtnRef.current.contains(event.target)) {
            setShowSettings(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, [showSettings]);

  const loadRecentFilesList = async () => {
    try {
      const files = await getRecentFiles();
      setRecentFiles(files);
    } catch (e) { console.error("Failed to load recents", e); }
  };

  useEffect(() => {
    if (!fileId || !pdf) return;
    const timer = setTimeout(() => {
      updateFileMeta(fileId, {
        lastPage: activePage, scale, rotation, darkMode, skipZones, lastOpened: Date.now()
      });
      captureThumbnail();
    }, 1000);
    return () => clearTimeout(timer);
  }, [fileId, activePage, scale, rotation, darkMode, skipZones]);

  const captureThumbnail = async () => {
    if (!fileId || !pageRefs.current[activePage]) return;
    try {
      const thumbDataUrl = await pageRefs.current[activePage].getThumbnail();
      if (thumbDataUrl) updateFileMeta(fileId, { thumbnail: thumbDataUrl });
    } catch (e) {}
  };

  useEffect(() => { setZoomInput(Math.round(scale * 100).toString()); }, [scale]);
  useEffect(() => { if (!isInputFocused) setJumpInput(String(activePage)); }, [activePage, isInputFocused]);

  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      if (available.length > 0) {
        if (selectedVoiceURI && available.some(v => v.voiceURI === selectedVoiceURI)) {
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
  const handleZoomInputKeyDown = (e) => { if (e.key === 'Enter') e.target.blur(); };
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

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
    } catch (err) { console.error("Error calculating fit:", err); }
  };

  const handleAddSkipZone = useCallback((zone) => { setSkipZones(prev => [...prev, zone]); }, []);
  const handleRemoveSkipZone = useCallback((id) => { setSkipZones(prev => prev.filter(z => z.id !== id)); }, []);

  const handlePageTokensRegistered = useCallback((pageNum, tokens) => {
    pageTokensMap.current.set(pageNum, tokens);
    const tryMergeNeighbors = (p1, p2) => {
        const t1 = pageTokensMap.current.get(p1);
        const t2 = pageTokensMap.current.get(p2);
        if (!t1 || !t2 || t1.length === 0 || t2.length === 0) return;
        const last = t1[t1.length - 1];
        const first = t2[0];
        if (first.linkedTo === last.id) return;
        if (/[-\u2010\u2011\u00AD]$/.test(last.text)) {
            const cleanPrefix = last.text.replace(/[-\u2010\u2011\u00AD]$/, '');
            last.spokenText = cleanPrefix + first.text;
            first.spokenText = "";
            first.linkedTo = last.id;
        }
    };
    tryMergeNeighbors(pageNum - 1, pageNum);
    tryMergeNeighbors(pageNum, pageNum + 1);

    if (waitingForPageRef.current === pageNum && isPlayingRef.current) {
        waitingForPageRef.current = null;
        playNextSentence(pageNum, tokens[0].id);
    }
  }, []);

  const performJump = async (pageNumber, doc = pdf) => {
    if (!doc || pageNumber < 1 || pageNumber > (doc.numPages || numPages)) return;
    const isFarJump = Math.abs(pageNumber - activePage) > 5;
    if (isFarJump) setIsLoading(true);
    try {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: scale, rotation: (page.rotate + rotation) % 360 });
      if (pageRefs.current[pageNumber]) {
        pageRefs.current[pageNumber].resizeImmediately(viewport.width, viewport.height);
        await new Promise(r => setTimeout(r, 20));
        pageRefs.current[pageNumber].scrollIntoView({ behavior: 'auto', block: 'start' });
      }
      setActivePage(pageNumber);
      if (!isInputFocused) setJumpInput(String(pageNumber));
    } catch (e) { console.error("Smart jump failed:", e);
    } finally { if (isFarJump) setIsLoading(false); }
  };

  const loadFromBlob = async (blob, existingMeta = null) => {
    setIsLoading(true);
    try {
        if (blob.name) { document.title = blob.name;}
        const data = await blob.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdfDoc = await loadingTask.promise;
        const fid = existingMeta ? existingMeta.id : getFileId(blob);
        setFileId(fid);
        if (!existingMeta) {
          await saveFileRecord({
            id: fid, name: blob.name, blob: blob, lastOpened: Date.now(),
            lastPage: 1, scale: 1.5, rotation: 0, darkMode: false, skipZones: []
          });
        }
        setPdf(pdfDoc);
        setNumPages(pdfDoc.numPages);
        const meta = existingMeta || { lastPage: 1, scale: 1.5, rotation: 0, darkMode: false, skipZones: [] };
        setActivePage(meta.lastPage || 1);
        setJumpInput(String(meta.lastPage || 1));
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
        setDebugOcrImage(null);
        setDebugOcrText("");
        synth.cancel();
        setTimeout(() => { performJump(meta.lastPage || 1, pdfDoc); }, 300);
    } catch (error) {
        console.error("Error loading PDF:", error);
        alert("Failed to load PDF.");
    } finally { setIsLoading(false); }
  };

  const handleRecentClick = (fileRecord) => loadFromBlob(fileRecord.blob, fileRecord);
  const onFileChange = (e) => { if (e.target.files[0]) loadFromBlob(e.target.files[0]); };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget.contains(e.relatedTarget)) return; setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (e.dataTransfer.files[0] && e.dataTransfer.files[0].type === "application/pdf") loadFromBlob(e.dataTransfer.files[0]);
    else alert("Please drop a valid PDF file.");
  };

  const registerPageRef = (num, ref) => { pageRefs.current[num] = ref; };
  const notifyPageVisible = useCallback((pageNum) => { setActivePage(pageNum); }, []);
  const handleJumpKey = (e) => { if (e.key === 'Enter') { const page = parseInt(jumpInput); if (page >= 1 && page <= numPages) { performJump(page); e.target.blur(); } } };

  // --- API Helper with Safety & Logs ---
  const fetchGeminiText = async (base64Image) => {
    // Check the State Variable 'apiKey'
    if (!apiKey) {
        setDebugOcrText("Error: No API Key provided in Settings.");
        return null;
    }
    const cleanBase64 = base64Image.split(',')[1];

    // UPDATED: Use Gemini 2.5 Flash
    // We append the key from state here
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [
          { text: "Transcribe the text in this image into plain spoken English. This is read by TTS, so add punctuation to let it read more naturally. Do not use LaTeX or Markdown. Read equations as words (e.g., 'x squared'). Ensure variables are distinct from articles (e.g., ensure 'A' is read as the letter 'Ay', not the article 'uh')." },
          { inline_data: { mime_type: "image/jpeg", data: cleanBase64 } }
        ]
      }],
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("Gemini Response:", data);

        if (data.error) {
            setDebugOcrText(`API Error: ${data.error.message}`);
            return null;
        }

        if (data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];
            if (candidate.finishReason !== "STOP") {
                 setDebugOcrText(`Blocked: ${candidate.finishReason}`);
                 return null;
            }
            if (candidate.content && candidate.content.parts) {
                const text = candidate.content.parts[0].text;
                setDebugOcrText(text); // Success
                return text;
            }
        }
        setDebugOcrText("Error: No text in response.");
    } catch (error) {
        console.error("Gemini Fetch Error:", error);
        setDebugOcrText(`Net Error: ${error.message}`);
    }
    return null;
  };

  // --- Playback Logic ---

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

  const playNextSentence = async (pageNum, tokenId) => {
      if (!isPlayingRef.current) return;

      const info = getNextSentenceInfo(pageNum, tokenId);

      if (info.nextPage && !info.tokens) {
          if (info.pageNum < numPages) {
              const nextPage = info.pageNum + 1;
              if (pageTokensMap.current.has(nextPage)) {
                  const nextTokens = pageTokensMap.current.get(nextPage);
                  playNextSentence(nextPage, nextTokens[0]?.id);
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

      handleSmartScroll(pageNum, firstTokenId);

      let textToSpeak = sentenceTokens.map(t => t.spokenText).join(' ');
      setDebugOcrText("Loading...");

      if (pageRefs.current[pageNum]) {
          const ids = sentenceTokens.map(t => t.id);
          const imgBase64 = pageRefs.current[pageNum].getWrappedImageForTokens(ids);

          if (imgBase64) {
              setDebugOcrImage(imgBase64);
              setOcrLoading(true);
              const ocrText = await fetchGeminiText(imgBase64);
              setOcrLoading(false);

              if (!isPlayingRef.current) return;
              if (ocrText) {
                  textToSpeak = ocrText;
              }
          }
      }

      const utter = new SpeechSynthesisUtterance(textToSpeak);
      utter.rate = rateRef.current;
      const targetVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
      if (targetVoice) { utter.voice = targetVoice; utter.lang = targetVoice.lang; }

      utter.onend = () => {
          if (isJumpingRef.current) return;
          if (isPlayingRef.current) {
              if (info.nextTokenId) {
                  playNextSentence(info.pageNum, info.nextTokenId);
              } else {
                  playNextSentence(info.nextPageNum, null);
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

  const handleTokenClick = useCallback((pageTokens, clickedTokenId, pageNum) => {
      isJumpingRef.current = true;
      synth.cancel();
      setIsPlaying(true);
      isPlayingRef.current = true;
      waitingForPageRef.current = null;

      playNextSentence(pageNum, clickedTokenId);

      setTimeout(() => { isJumpingRef.current = false; }, 50);
  }, [voices, selectedVoiceURI, rate]);

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
        const startId = activeTokenId || (tokens[0] ? tokens[0].id : null);
        playNextSentence(activePage, startId);
    }
  };

  const handleSmartScroll = (pageNum, tokenId) => {
    if (!autoScrollRef.current || !viewportRef.current) return;
    const pageRef = pageRefs.current[pageNum];
    if (!pageRef || !pageRef.getTokenRect) return;
    const tokenRect = pageRef.getTokenRect(tokenId);
    if (!tokenRect) return;
    const viewport = viewportRef.current;
    const containerRect = viewport.getBoundingClientRect();
    const relativeTop = tokenRect.top - containerRect.top;
    const vHeight = containerRect.height;
    const safeTop = vHeight * 0.1;
    const safeBottom = vHeight * 0.8;
    const targetOffset = vHeight * 0.2;
    let shiftAmount = 0;
    if (relativeTop < safeTop) shiftAmount = relativeTop - targetOffset;
    else if (relativeTop > safeBottom) shiftAmount = relativeTop - targetOffset;
    if (Math.abs(shiftAmount) > 5) {
        viewport.scrollTo({ top: viewport.scrollTop + shiftAmount, behavior: 'smooth' });
    }
  };

  const handleSmartNavigation = useCallback((direction) => {
    const tokens = pageTokensMap.current.get(activePage) || [];
    if (tokens.length === 0) return;
    let currentIndex = -1;
    if (activeTokenId) currentIndex = tokens.findIndex(t => t.id === activeTokenId);
    if (currentIndex === -1) currentIndex = 0;
    let newIndex = currentIndex;
    if (readingMode === 'word') {
        newIndex = currentIndex + direction;
    } else {
        if (direction === 1) {
            for (let i = currentIndex; i < tokens.length; i++) {
                 if (/[.!?]["']?$/.test(tokens[i].spokenText)) { newIndex = i + 1; break; }
                 if (i === tokens.length - 1) newIndex = tokens.length;
            }
        } else {
            let found = false;
            for (let i = currentIndex - 2; i >= 0; i--) {
                if (/[.!?]["']?$/.test(tokens[i].spokenText)) { newIndex = i + 1; found = true; break; }
            }
            if (!found) newIndex = -1;
        }
    }
    if (newIndex < 0) {
        if (activePage > 1) {
             const prevPage = activePage - 1;
             setActivePage(prevPage);
             performJump(prevPage);
             const prevTokens = pageTokensMap.current.get(prevPage);
             if (prevTokens && prevTokens.length > 0) handleTokenClick(prevTokens, prevTokens[0].id, prevPage);
        }
    } else if (newIndex >= tokens.length) {
        if (activePage < numPages) {
            const nextPage = activePage + 1;
            setActivePage(nextPage);
            performJump(nextPage);
            const nextTokens = pageTokensMap.current.get(nextPage);
            if (nextTokens && nextTokens.length > 0) handleTokenClick(nextTokens, nextTokens[0].id, nextPage);
        }
    } else {
        handleTokenClick(tokens, tokens[newIndex].id, activePage);
    }
  }, [activePage, activeTokenId, readingMode, numPages, handleTokenClick]);

  const handleDebugExtract = async () => {
      const pageRef = pageRefs.current[activePage];
      if (pageRef && pageRef.generateDebugImages) {
          const images = await pageRef.generateDebugImages();
          setDebugImages(images);
          setShowSettings(false);
      } else { alert("Debug: Page not ready or loaded."); }
  };

  return (
    <div className="app-layout" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <input type="file" accept="application/pdf" onChange={onFileChange} style={{display:'none'}} ref={fileInputRef} />
      {isDragging && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '24px', pointerEvents: 'none' }}>
            <div><Icons.Upload style={{width: 64, height: 64, marginBottom: 20}} /><p>Drop PDF to Open</p></div>
        </div>
      )}
      {showHelp && (
          <div className="modal-overlay" onClick={() => setShowHelp(false)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                  <div className="modal-header"><h3>Keyboard Shortcuts</h3><button className="icon-btn" onClick={() => setShowHelp(false)}><Icons.Close /></button></div>
                  <div className="modal-body">
                      <table className="shortcuts-table"><tbody>
                          <tr><td><kbd>O</kbd></td><td>Open File</td></tr><tr><td><kbd>Space</kbd></td><td>Play / Pause</td></tr>
                          <tr><td><kbd>W</kbd> / <kbd>S</kbd></td><td>Prev / Next Page</td></tr><tr><td><kbd>A</kbd> / <kbd>D</kbd></td><td>Prev / Next Sentence</td></tr>
                          <tr><td><kbd>F</kbd></td><td>Toggle Fit Mode</td></tr><tr><td><kbd>R</kbd></td><td>Switch Reading Mode</td></tr>
                          <tr><td><kbd>M</kbd></td><td>Toggle Mark Skip Mode</td></tr><tr><td><kbd>N</kbd></td><td>Toggle Auto-Scroll</td></tr>
                          <tr><td><kbd>Z</kbd></td><td>Toggle Focus Mode</td></tr><tr><td><kbd>P</kbd></td><td>Focus Page Input</td></tr>
                          <tr><td><kbd>V</kbd></td><td>Focus Voice Selection</td></tr><tr><td><kbd>H</kbd></td><td>Toggle this Help</td></tr>
                      </tbody></table>
                  </div>
              </div>
          </div>
      )}

      {/* DEBUG IMAGE OVERLAY with TEXT result */}
      {debugOcrImage && (
          <div style={{ position: 'fixed', bottom: '150px', right: '20px', width: '300px', background: '#fff', border: '2px solid red', padding: '10px', zIndex: 10000, boxShadow: '0 0 10px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{fontWeight:'bold', color:'black'}}>OCR Debug:</div>
              <img src={debugOcrImage} style={{width:'100%', display:'block', border: '1px solid #ddd'}} alt="OCR Debug" />
              <div style={{maxHeight: '100px', overflowY: 'auto', background: '#f5f5f5', padding: '5px', fontSize: '11px', color: '#333', border: '1px solid #ddd'}}>
                  {debugOcrText || "Waiting for API..."}
              </div>
              <button onClick={() => { setDebugOcrImage(null); setDebugOcrText(""); }} style={{marginTop:'5px', padding:'5px', cursor: 'pointer', background: '#eee', border: '1px solid #ccc'}}>Close Preview</button>
          </div>
      )}

      <main className="main-content">
        <div className="scroll-viewport" ref={viewportRef}>
            {isLoading && ( <div className="loading-overlay"><div className="spinner"></div><p>Processing Document...</p></div> )}
            {!pdf ? (
                <div className="dashboard-container">
                    <div className="empty-placeholder">
                        <label className="upload-btn main-upload" onClick={() => fileInputRef.current.click()}><Icons.Upload /> Open PDF File</label>
                        <p style={{marginTop: '20px', color: '#666', fontSize: '14px'}}>or drag and drop a file here</p>
                    </div>
                    {recentFiles.length > 0 && (
                        <div className="recent-files-section"><h3>Recently Opened</h3><div className="recent-grid">
                                {recentFiles.map(file => (
                                    <div key={file.id} className="recent-card" onClick={() => handleRecentClick(file)}>
                                        <div className="recent-thumb">{file.thumbnail ? (<img src={file.thumbnail} alt="preview" />) : (<div className="no-thumb">PDF</div>)}<div className="page-badge">Pg {file.lastPage}</div></div>
                                        <div className="recent-info"><div className="recent-name" title={file.name}>{file.name}</div><div className="recent-date">{new Date(file.lastOpened).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</div></div>
                                    </div>
                                ))}
                            </div></div>
                    )}
                </div>
            ) : (
                <>
                    <div className={`pdf-stream ${darkMode ? 'dark-mode' : ''}`}>
                        {Array.from(new Array(numPages), (_, i) => i + 1).map(pageNum => (
                            <PDFPage
                                key={pageNum} ref={(r) => registerPageRef(pageNum, r)}
                                pdfDoc={pdf} pageNum={pageNum} scale={scale} rotation={rotation}
                                activeTokenId={activeTokenId} readingMode={readingMode}
                                onTokensParsed={handleTokenClick} notifyPageVisible={notifyPageVisible}
                                registerPageTokens={handlePageTokensRegistered} isMarkingMode={isMarkingMode}
                                skipZones={skipZones} onAddSkipZone={handleAddSkipZone} onRemoveSkipZone={handleRemoveSkipZone}
                                highlightEnabled={highlightEnabled} highlightColor={highlightColor} highlightOpacity={highlightOpacity}
                            />
                        ))}
                    </div>
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
                    <div className="section-left">
                        <button className="icon-btn" onClick={togglePlay} disabled={isMarkingMode} style={{ opacity: isMarkingMode ? 0.5 : 1 }} title="Play/Pause (Space)">
                            {isPlaying ? <Icons.Pause /> : <Icons.Play />}
                        </button>
                        <div className="divider-vertical"></div>
                        <div className="jump-group">
                            <span className="label">Pg</span>
                            <input ref={jumpInputRef} type="number" min="1" max={numPages} value={jumpInput} onChange={(e) => setJumpInput(e.target.value)} onKeyDown={handleJumpKey} onFocus={() => setIsInputFocused(true)} onBlur={() => setIsInputFocused(false)} className="page-input" title="Page Number (P)" />
                            <span className="label">/ {numPages}</span>
                        </div>
                    </div>
                    <div className="section-center">
                        <div className="zoom-group">
                            <button className="icon-btn-ghost" onClick={handleZoomOut} title="Zoom Out">-</button>
                            <input className="zoom-input" type="text" value={zoomInput} onChange={handleZoomInputChange} onBlur={handleZoomInputBlur} onKeyDown={handleZoomInputKeyDown} />
                            <span className="zoom-unit">%</span>
                            <button className="icon-btn-ghost" onClick={handleZoomIn} title="Zoom In">+</button>
                        </div>
                        <div className="divider-vertical small"></div>
                        <button className="text-btn" onClick={toggleFitMode} title="Toggle Fit (F)">{fitMode === 'width' ? 'Fit W' : fitMode === 'height' ? 'Fit H' : 'Fit'}</button>
                        <div className="divider-vertical small"></div>
                        <button className="icon-btn" onClick={handleRotate} title="Rotate 90°"><Icons.Rotate style={{ width: '20px', height: '20px' }} /></button>
                    </div>
                    <div className="section-right">
                        <button className={`icon-btn ${isMarkingMode ? 'active-danger' : ''}`} onClick={() => { if (!isMarkingMode && isPlaying) togglePlay(); setIsMarkingMode(!isMarkingMode); }} title="Mark Skip Area (M)"><Icons.Crop /></button>
                        <button className={`icon-btn ${darkMode ? 'active' : ''}`} onClick={() => setDarkMode(!darkMode)} title="Toggle Dark Mode"><Icons.Moon /> </button>
                        <button className="icon-btn" onClick={() => fileInputRef.current.click()} title="Open File (O)"><Icons.Upload /></button>
                        <button className={`icon-btn ${showHelp ? 'active' : ''}`} onClick={() => setShowHelp(!showHelp)} title="Shortcuts (H)"><span style={{fontSize: '18px', fontWeight: 'bold'}}>?</span></button>
                        <div style={{ position: 'relative' }}>
                            <button ref={settingsBtnRef} className={`icon-btn ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(!showSettings)} title="Settings"><Icons.Settings /></button>
                            {showSettings && (
                                <div className="settings-popup" ref={settingsRef}>
                                    <div className="settings-header">Reading Settings</div>

                                    {/* NEW: API KEY INPUT */}
                                    <div className="setting-item" style={{flexDirection: 'column', alignItems: 'flex-start'}}>
                                        <label style={{marginBottom: '5px'}}>Gemini API Key</label>
                                        <input
                                          type="password"
                                          placeholder="Enter Key..."
                                          value={apiKey}
                                          onChange={(e) => setApiKey(e.target.value)}
                                          style={{
                                              width: '100%',
                                              padding: '6px',
                                              borderRadius: '4px',
                                              border: '1px solid #ccc',
                                              fontSize: '13px'
                                          }}
                                        />
                                        <small style={{fontSize: '10px', color: '#888', marginTop: '3px'}}>Saved locally to browser</small>
                                    </div>
                                    <div className="setting-divider"></div>

                                    <div className="setting-item"><label><Icons.Voice /> Voice</label><select ref={voiceSelectRef} value={selectedVoiceURI} onChange={e => setSelectedVoiceURI(e.target.value)} className="voice-select">{voices.map(v => (<option key={v.voiceURI} value={v.voiceURI}>{v.name.slice(0, 24)}...</option>))}</select></div>
                                    <div className="setting-item"><label style={{flex: 1}}>Reading Mode (R)</label><div className="toggle-group"><button className={`toggle-btn ${readingMode === 'word' ? 'active' : ''}`} onClick={() => setReadingMode('word')}>Word</button><button className={`toggle-btn ${readingMode === 'sentence' ? 'active' : ''}`} onClick={() => setReadingMode('sentence')}>Sentence</button></div></div>
                                    <div className="setting-item"><div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'}}><label>Focus Mode (Auto-Hide) (Z)</label><input type="checkbox" checked={autoHide} onChange={(e) => setAutoHide(e.target.checked)} style={{ width: 'auto' }} /></div></div>
                                    <div className="setting-item"><div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'}}><label>Auto-Scroll (N)</label><input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} style={{ width: 'auto' }} /></div></div>
                                    <div className="setting-item"><div className="label-row"><label>Speed</label><span className="value-badge">{rate.toFixed(1)}x</span></div><input type="range" className="styled-slider" min="0.5" max="3.0" step="0.1" value={rate} onChange={e => setRate(Number(e.target.value))} /><div className="slider-labels"><span>0.5x</span><span>3.0x</span></div></div>
                                    <div className="setting-divider"></div>
                                    <div className="setting-item"><div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}><label>Highlighting</label><input type="checkbox" checked={highlightEnabled} onChange={e => setHighlightEnabled(e.target.checked)} style={{ width: 'auto' }} /></div>{highlightEnabled && (<><div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px'}}><label style={{fontSize: '13px', color: '#555'}}>Color</label><input type="color" value={highlightColor} onChange={e => setHighlightColor(e.target.value)} style={{ width: '40px', height: '25px', padding: 0, border: 'none' }} /></div><div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}><label style={{fontSize: '13px', color: '#555'}}>Opacity</label><input type="range" min="0.1" max="1.0" step="0.1" value={highlightOpacity} onChange={e => setHighlightOpacity(Number(e.target.value))} style={{ width: '80px' }} /></div></>)}</div>
                                    <div className="setting-divider"></div>
                                    <button onClick={handleDebugExtract} className="menu-btn" title="Generate Sentence Images">Sentence Segmentation Preview</button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}
      </main>
      <style>{`
          .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; }
          .modal-content { background: white; width: 500px; max-width: 90%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); overflow: hidden; color: #333; }
          .modal-header { padding: 15px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
          .modal-body { padding: 20px; }
          .shortcuts-table { width: 100%; border-collapse: collapse; }
          .shortcuts-table td { padding: 8px 0; border-bottom: 1px solid #f5f5f5; }
          .shortcuts-table tr:last-child td { border-bottom: none; }
          kbd { background-color: #f7f7f7; border: 1px solid #ccc; border-radius: 3px; box-shadow: 0 1px 0 rgba(0,0,0,0.2); color: #333; display: inline-block; font-size: 11px; line-height: 1.4; margin: 0 2px; padding: 0 5px; white-space: nowrap; font-family: monospace; }
      `}</style>
    </div>
  );
};

export default App;