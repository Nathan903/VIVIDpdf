import { useState, useEffect, useRef, useCallback } from 'react';

export const useTTS = ({ 
  activePage, 
  setActivePage, 
  numPages, 
  rate: initialRate, 
  voiceURI: initialVoiceURI, 
  readingMode: initialReadingMode,
  onTokenActive, // Callback for scrolling/UI updates (pageNum, tokenId)
  onScrollToPage // Callback to scroll page into view if waiting
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTokenId, setActiveTokenId] = useState(null);
  
  // Settings State
  const [rate, setRate] = useState(initialRate);
  const [readingMode, setReadingMode] = useState(initialReadingMode);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(initialVoiceURI);

  // Refs
  const isPlayingRef = useRef(false);
  const isJumpingRef = useRef(false);
  const rateRef = useRef(rate);
  const pageTokensMap = useRef(new Map());
  const waitingForPageRef = useRef(null);
  const synth = window.speechSynthesis;

  // Sync Refs
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { rateRef.current = rate; }, [rate]);

  // Load Voices
  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      if (available.length > 0) {
        if (selectedVoiceURI && available.some(v => v.voiceURI === selectedVoiceURI)) {
             // Saved voice is valid
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

  // --- Logic: Token Registration & Merging ---
  const registerPageTokens = useCallback((pageNum, tokens) => {
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
        scheduleNextBatch(pageNum, []);
    }
  }, []);

  // --- Logic: Core TTS Loop ---
  const scheduleNextBatch = (startPageNum, carryOverTokens, isFirstBatch = false, allowWait = true) => {
    if (!isPlayingRef.current) return false;

    let pool = [...carryOverTokens];
    
    if (pool.length === 0) {
        const pageTokens = pageTokensMap.current.get(startPageNum);
        if (!pageTokens) {
            if (allowWait) {
                waitingForPageRef.current = startPageNum;
                if (onScrollToPage) onScrollToPage(startPageNum);
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

    let script = "";
    const map = [];
    pool.forEach(token => {
        const text = token.spokenText;
        if (!text) return; 

        const start = script.length;
        script += text + " ";
        const end = start + text.length;
        map.push({ start, end, token });
    });

    if (!script.trim()) {
        if (startPageNum < numPages) {
            return scheduleNextBatch(nextPageNum, [], false, allowWait);
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
            
            if (onTokenActive) onTokenActive(pageNum, tokenId);
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
        if (isJumpingRef.current) return;
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        
        if (isPlayingRef.current) setIsPlaying(false);
    };

    synth.speak(utter);
    return true;
  };

  // --- Logic: Controls ---
  const handleTokenClick = useCallback((pageTokens, clickedTokenId, pageNum) => {
      isJumpingRef.current = true;
      synth.cancel();
      setIsPlaying(true);
      isPlayingRef.current = true;
      waitingForPageRef.current = null;
      
      let startIndex = 0;
      if (clickedTokenId) {
          startIndex = pageTokens.findIndex(t => t.id === clickedTokenId);
          if (startIndex === -1) startIndex = 0;
      }
      const tokens = pageTokens.slice(startIndex);
      
      scheduleNextBatch(pageNum, tokens, true);

      setTimeout(() => { isJumpingRef.current = false; }, 50);
  }, [voices, selectedVoiceURI, rate]);

  const togglePlay = () => {
    if (isPlaying) {
        setIsPlaying(false);
        isPlayingRef.current = false;
        waitingForPageRef.current = null;
        synth.cancel();
    } else {
        setIsPlaying(true);
        isPlayingRef.current = true;
        const tokens = pageTokensMap.current.get(activePage) || [];
        let startTokens = [];
        if (activeTokenId && tokens.length > 0) {
            const idx = tokens.findIndex(t => t.id === activeTokenId);
            startTokens = idx >= 0 ? tokens.slice(idx) : tokens;
        } else {
            startTokens = tokens;
        }
        
        scheduleNextBatch(activePage, startTokens, true); 
    }
  };

  const handleSmartNavigation = useCallback((direction, performJump) => {
    const tokens = pageTokensMap.current.get(activePage) || [];
    if (tokens.length === 0) return;

    let currentIndex = -1;
    if (activeTokenId) {
        currentIndex = tokens.findIndex(t => t.id === activeTokenId);
    }
    
    if (currentIndex === -1) currentIndex = 0;

    let newIndex = currentIndex;
    
    if (readingMode === 'word') {
        newIndex = currentIndex + direction;
    } else {
        if (direction === 1) {
            for (let i = currentIndex; i < tokens.length; i++) {
                 if (/[.!?]["']?$/.test(tokens[i].spokenText)) {
                     newIndex = i + 1;
                     break;
                 }
                 if (i === tokens.length - 1) newIndex = tokens.length;
            }
        } else {
            let found = false;
            for (let i = currentIndex - 2; i >= 0; i--) {
                if (/[.!?]["']?$/.test(tokens[i].spokenText)) {
                    newIndex = i + 1;
                    found = true;
                    break;
                }
            }
            if (!found) newIndex = -1; 
        }
    }

    if (newIndex < 0) {
        if (activePage > 1) {
             const prevPage = activePage - 1;
             const prevTokens = pageTokensMap.current.get(prevPage);
             setActivePage(prevPage);
             if (performJump) performJump(prevPage);
             if (prevTokens && prevTokens.length > 0) {
                 handleTokenClick(prevTokens, prevTokens[0].id, prevPage);
             }
        }
    } else if (newIndex >= tokens.length) {
        if (activePage < numPages) {
            const nextPage = activePage + 1;
            const nextTokens = pageTokensMap.current.get(nextPage);
            setActivePage(nextPage);
            if (performJump) performJump(nextPage);
            if (nextTokens && nextTokens.length > 0) {
                handleTokenClick(nextTokens, nextTokens[0].id, nextPage);
            }
        }
    } else {
        handleTokenClick(tokens, tokens[newIndex].id, activePage);
    }

  }, [activePage, activeTokenId, readingMode, numPages, handleTokenClick]);

  const cancelAudio = () => {
    setIsPlaying(false);
    synth.cancel();
    pageTokensMap.current.clear();
    waitingForPageRef.current = null;
    setActiveTokenId(null);
  };

  return {
    isPlaying,
    activeTokenId,
    voices,
    selectedVoiceURI,
    setSelectedVoiceURI,
    rate,
    setRate,
    readingMode,
    setReadingMode,
    togglePlay,
    handleTokenClick,
    handleSmartNavigation,
    registerPageTokens,
    cancelAudio
  };
};