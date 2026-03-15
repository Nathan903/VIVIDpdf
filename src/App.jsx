import { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';
import PDFPage from './PDFPage';
import { Icons } from './Icons';
import { saveFileRecord, getRecentFiles, updateFileMeta, getFileId, deleteFileRecord, getFileRecord, getStorageInfo, deleteBlobs } from './db';
import { fixTranscriptWithAI, getStoredCost, resetCostUsage, verifyGeminiAPIKey, verifyOpenAIApiKey } from './aiService'; // IMPORT AI SERVICE
import { applySkippingRules, applyCustomPronunciations } from './speechUtils';
import { groupTokensIntoSentences } from './parsing';
import SpeechCustomizationPanel from './SpeechCustomizationPanel';
import { getVoiceSettings, calculateActualRate } from './voiceSpeedConfig'; // IMPORT VOICE CONFIG
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// --- Local Storage Keys ---
const LS_GLOBALS = 'pdf_reader_globals';
const LS_AI_CONFIG = 'pdf_reader_ai_config'; // New Key
const LS_STORAGE_SETTINGS = 'pdf_reader_storage_config';

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
        skipEmails: false,
        skipSquare: false,
        skipParens: false,
        skipCurly: false,
        visualIndicator: false
    },
    customPronunciations: [],
    languageVoiceCache: {}, // Store per-language preferences
    textSelectionEnabled: false,
    offlineFallbackConfig: { language: 'en', voiceURI: '', rate: 1.0 }
};

const DEFAULT_AI_CONFIG = {
    geminiApiKey: "",
    openAIApiKey: "",
    model: "gemini-2.5-flash-lite", // Default to cheap model
    instructions: "Read equations, symbols out loud, according to context, like a human reading it out loud.",
    enabled: false
};

const DEFAULT_STORAGE_SETTINGS = {
    limitGB: 2,
    retentionDays: -1, // -1 means indefinitely
    autoMetadataOnly: false
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

    const [geminiKeyStatus, setGeminiKeyStatus] = useState('idle'); // idle | loading | valid | invalid
    const [openAIKeyStatus, setOpenAIKeyStatus] = useState('idle');

    const [storageSettings, setStorageSettings] = useState(() => {
        try {
            const saved = localStorage.getItem(LS_STORAGE_SETTINGS);
            if (saved) {
                let parsed = JSON.parse(saved);
                if (parsed.limitGB < 0 || parsed.limitGB > 500) parsed.limitGB = 2; // validate limits
                return { ...DEFAULT_STORAGE_SETTINGS, ...parsed };
            }
            return DEFAULT_STORAGE_SETTINGS;
        } catch (e) {
            return DEFAULT_STORAGE_SETTINGS;
        }
    });

    const [storageUsed, setStorageUsed] = useState({ usedBytes: 0, records: [] });
    const [showHomeSettings, setShowHomeSettings] = useState(false);
    const [rememberMetadataOnly, setRememberMetadataOnly] = useState(false);

    const [totalCost, setTotalCost] = useState(getStoredCost());
    const [ocrLoading, setOcrLoading] = useState(false); // Spinner for AI processing
    const [aiWarning, setAiWarning] = useState(null); // Warning for AI failure

    // Save AI Config on change
    useEffect(() => {
        localStorage.setItem(LS_AI_CONFIG, JSON.stringify(aiConfig));
        aiConfigRef.current = aiConfig;
    }, [aiConfig]);

    const aiConfigRef = useRef(aiConfig);

    // Live Validation for Gemini Key
    useEffect(() => {
        const key = aiConfig.geminiApiKey;
        if (!key || !key.trim()) {
            setGeminiKeyStatus('idle');
            return;
        }
        setGeminiKeyStatus('loading');
        const timer = setTimeout(async () => {
            const isValid = await verifyGeminiAPIKey(key.trim());
            setGeminiKeyStatus(isValid ? 'valid' : 'invalid');
        }, 800);
        return () => clearTimeout(timer);
    }, [aiConfig.geminiApiKey]);

    // Live Validation for OpenAI Key
    useEffect(() => {
        const key = aiConfig.openAIApiKey;
        if (!key || !key.trim()) {
            setOpenAIKeyStatus('idle');
            return;
        }
        setOpenAIKeyStatus('loading');
        const timer = setTimeout(async () => {
            const isValid = await verifyOpenAIApiKey(key.trim());
            setOpenAIKeyStatus(isValid ? 'valid' : 'invalid');
        }, 800);
        return () => clearTimeout(timer);
    }, [aiConfig.openAIApiKey]);

    // Save Storage Settings on change
    useEffect(() => {
        localStorage.setItem(LS_STORAGE_SETTINGS, JSON.stringify(storageSettings));
    }, [storageSettings]);


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
    const [numPages, setNumPages] = useState(-999);
    const [activePage, setActivePage] = useState(1);
    const [jumpInput, setJumpInput] = useState("1");
    const [isInputFocused, setIsInputFocused] = useState(false);

    // Storage states
    const [limitPrompt, setLimitPrompt] = useState(null);
    const [expectingReupload, setExpectingReupload] = useState(null);

    // Zoom / View
    const [scale, setScale] = useState(1.5);
    const [rotation, setRotation] = useState(0);
    const [zoomInput, setZoomInput] = useState("150");
    const [fitMode, setFitMode] = useState('custom');

    // TTS State
    const [voices, setVoices] = useState([]);
    const [selectedLanguage, setSelectedLanguage] = useState("");
    const [selectedVoiceURI, setSelectedVoiceURI] = useState(globalSettings.voiceURI);
    const [languageVoiceCache, setLanguageVoiceCache] = useState(globalSettings.languageVoiceCache || {});
    const [textSelectionEnabled, setTextSelectionEnabled] = useState(globalSettings.textSelectionEnabled ?? false);
    const [offlineFallbackConfig, setOfflineFallbackConfig] = useState(globalSettings.offlineFallbackConfig || { language: 'en', voiceURI: '', rate: 1.0 });
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [activeTokenId, setActiveTokenId] = useState(null);
    const [isVoiceLoading, setIsVoiceLoading] = useState(false);

    // Skip / Zones
    const [isMarkingMode, setIsMarkingMode] = useState(false);
    const isMarkingModeRef = useRef(isMarkingMode);
    useEffect(() => {
        isMarkingModeRef.current = isMarkingMode;
    }, [isMarkingMode]);
    const [skipZones, setSkipZones] = useState([]);

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
    const ttsGenerationRef = useRef(0);
    const pageRefs = useRef({});
    const pageRefCallbacks = useRef({});
    const viewportRef = useRef(null);

    const settingsRef = useRef(null);
    const settingsBtnRef = useRef(null);

    // DOM Refs for Shortcuts
    const fileInputRef = useRef(null);
    const jumpInputRef = useRef(null);
    const voiceSelectRef = useRef(null);

    const pageTokensMap = useRef(new Map());
    const waitingForPageRef = useRef(null);
    const activeTokenIdRef = useRef(null);
    const aiTranscriptCache = useRef(new Map()); // key: "pageNum:firstTokenId"
    const prefetchInProgress = useRef(new Set()); // keys currently being fetched
    const activePageRef = useRef(1);
    const numPagesRef = useRef(numPages);

    // Visual
    const [isLoading, setIsLoading] = useState(false);
    const [darkMode, setDarkMode] = useState(false);
    const [toast, setToast] = useState(null);

    const showToast = (message) => {
        setToast(message);
        setTimeout(() => setToast(null), 5000);
    };

    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { numPagesRef.current = numPages; }, [numPages]);
    useEffect(() => { rateRef.current = rate; }, [rate]);
    useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);
    useEffect(() => { customPronunciationsRef.current = customPronunciations; }, [customPronunciations]);
    useEffect(() => { speechCustomizationRef.current = speechCustomization; }, [speechCustomization]);
    useEffect(() => { activeTokenIdRef.current = activeTokenId; }, [activeTokenId]);
    useEffect(() => { activePageRef.current = activePage; }, [activePage]);

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
            customPronunciations,
            languageVoiceCache,
            textSelectionEnabled,
            offlineFallbackConfig
        };
        localStorage.setItem(LS_GLOBALS, JSON.stringify(settings));
    }, [selectedVoiceURI, readingMode, rate, highlightEnabled,
        highlightColor, highlightOpacity, autoHide, autoScroll,
        globalSettings.layoutMode, speechCustomization, customPronunciations, languageVoiceCache,
        textSelectionEnabled, offlineFallbackConfig
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
            const info = await getStorageInfo();
            setStorageUsed(info);

            // Handle retention auto-delete
            if (storageSettings.retentionDays > 0) {
                const now = Date.now();
                const cutoff = now - (storageSettings.retentionDays * 24 * 60 * 60 * 1000);
                const toDeleteIds = info.records
                    .filter(r => r.hasBlob && r.lastOpened < cutoff)
                    .map(r => r.id);

                if (toDeleteIds.length > 0) {
                    await deleteBlobs(toDeleteIds);
                    // Refresh storage info after deletion
                    const updatedInfo = await getStorageInfo();
                    setStorageUsed(updatedInfo);
                }
            }
        } catch (e) { console.error("Failed to load recents", e); }
    };

    // Run auto-delete checks when settings change
    useEffect(() => {
        if (recentFiles.length > 0) {
            loadRecentFilesList();
        }
    }, [storageSettings.retentionDays]);

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

            if (available.length > 0) {
                // Deduce language of current saved voice (if any exists)
                let currentLang = "";
                let validatedVoiceURI = "";

                if (selectedVoiceURI && available.some(v => v.voiceURI === selectedVoiceURI)) {
                    // Saved voice is valid
                    const v = available.find(vx => vx.voiceURI === selectedVoiceURI);
                    currentLang = v.lang.split('-')[0]; // generic fallback, e.g. "en" from "en-US"
                    validatedVoiceURI = selectedVoiceURI;
                } else {
                    // Fallback to default
                    const browserLang = (navigator.language || 'en').split('-')[0];
                    const defaultVoice = available.find(v => v.default && v.lang.startsWith(browserLang)) ||
                        available.find(v => v.lang.startsWith(browserLang)) ||
                        available.find(v => v.lang.startsWith('en')) ||
                        available.find(v => v.default) ||
                        available[0];
                    if (defaultVoice) {
                        currentLang = defaultVoice.lang.split('-')[0];
                        validatedVoiceURI = defaultVoice.voiceURI;
                        setSelectedVoiceURI(validatedVoiceURI);
                    }
                }

                if (currentLang && !selectedLanguage) {
                    setSelectedLanguage(currentLang);
                }
            }
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
        return () => { window.speechSynthesis.onvoiceschanged = null; };
    }, [selectedVoiceURI, selectedLanguage]);

    // Ensure reading mode is valid for the current voice
    useEffect(() => {
        if (!selectedVoiceURI) return;
        const vSettings = getVoiceSettings(selectedVoiceURI);
        const targetVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
        const voiceName = targetVoice ? targetVoice.name : 'This voice';

        if (!vSettings.supportWordMode && readingMode === 'word') {
            setReadingMode('sentence');
            showToast(`Word Mode is not supported for ${voiceName}. Switched to Sentence Mode.`);
        }
    }, [selectedVoiceURI, readingMode, voices]);

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
            if (aiConfigRef.current.enabled) {
                const tokens = pageTokensMap.current.get(pageNum);
                if (tokens && tokens.length > 0) {
                    playNextSentenceAIRef.current(pageNum, tokens[0].id);
                }
            } else {
                scheduleNextBatchRef.current(pageNum, []);
            }
        }
    }, []); // Removed dependency since we use refs

    // --- References for functions ---
    const playNextSentenceAIRef = useRef(null);
    const scheduleNextBatchRef = useRef(null);
    const queueCachedAISentenceRef = useRef(null);

    // --- Smart Jump Logic ---
    const performJump = async (pageNumber, doc = pdf) => {
        if (!doc || pageNumber < 1 || pageNumber > (doc.numPages || numPagesRef.current)) return;

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
        // Yield to let React render the spinner before heavy synchronous ArrayBuffer operations
        await new Promise(r => setTimeout(r, 10));
        try {
            if (blob.name) { document.title = blob.name; }
            const data = await blob.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data });
            const pdfDoc = await loadingTask.promise;

            // Generate or Use ID
            const fid = existingMeta ? existingMeta.id : getFileId(blob);
            setFileId(fid);

            // Always update the full record with blob because we might be upgrading from metadata-only
            await saveFileRecord({
                id: fid,
                name: blob.name,
                blob: blob,
                lastOpened: Date.now(),
                lastPage: existingMeta ? existingMeta.lastPage : 1,
                scale: existingMeta ? existingMeta.scale : 1.5,
                rotation: existingMeta ? existingMeta.rotation : 0,
                darkMode: existingMeta ? !!existingMeta.darkMode : false,
                skipZones: existingMeta ? existingMeta.skipZones : [],
                ...(existingMeta || {})
            });

            // Refresh recent files + storage info
            loadRecentFilesList();

            setPdf(pdfDoc);
            console.log("[debug] PDF loaded, number of pages:", pdfDoc.numPages);
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
            setIsVoiceLoading(false);
            pageTokensMap.current.clear();
            waitingForPageRef.current = null;
            aiTranscriptCache.current.clear();
            prefetchInProgress.current.clear();
            console.log(`[TTS DEBUG] cancel called from loadFile`);
            ttsGenerationRef.current += 1;
            synth.cancel();

            // Scroll to saved page (delayed to allow render)
            setTimeout(() => {
                // USE NEW JUMP LOGIC HERE
                performJump(meta.lastPage || 1, pdfDoc);
            }, 300);

            // Perform a quick check for text on the first few pages to warn about scanned PDFs
            try {
                let hasAnyText = false;
                const pagesToCheck = Math.min(pdfDoc.numPages, 5);
                for (let i = 1; i <= pagesToCheck; i++) {
                    const page = await pdfDoc.getPage(i);
                    const textContent = await page.getTextContent();
                    if (textContent.items.some(item => item.str && item.str.trim().length > 0)) {
                        hasAnyText = true;
                        break;
                    }
                }
                if (!hasAnyText) {
                    showToast("The opened PDF does not contain text, and VIVIDpdf does not support recognizing words inside images.");
                }
            } catch (e) {
                console.error("Failed to check PDF text content", e);
            }

        } catch (error) {
            console.error("Error loading PDF:", error);
            alert("Failed to load PDF. Please ensure it is a valid file.");
        } finally {
            setIsLoading(false);
        }
    };

    const loadMetadataOnly = (file, existingMeta = null) => {
        setLimitPrompt(null);
        const fid = existingMeta ? existingMeta.id : getFileId(file);

        saveFileRecord({
            id: fid,
            name: file.name,
            lastOpened: Date.now(),
            lastPage: 1, scale: 1.5, rotation: 0, darkMode: false, skipZones: [],
            ...(existingMeta || {})
        }).then(() => {
            const noBlobLoader = async () => {
                setFileId(fid);
                setIsLoading(true);
                // Yield to let React render the spinner before heavy synchronous ArrayBuffer operations
                await new Promise(r => setTimeout(r, 10));
                try {
                    const data = await file.arrayBuffer();
                    const loadingTask = pdfjsLib.getDocument({ data });
                    const pdfDoc = await loadingTask.promise;
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
                    setIsVoiceLoading(false);
                    setIsPlaying(false);
                    pageTokensMap.current.clear();
                    waitingForPageRef.current = null;
                    console.log(`[TTS DEBUG] cancel called from loadMetadataOnly`);
                    ttsGenerationRef.current += 1;
                    synth.cancel();
                    // Perform a quick check for text on the first few pages to warn about scanned PDFs
                    try {
                        let hasAnyText = false;
                        const pagesToCheck = Math.min(pdfDoc.numPages, 5);
                        for (let i = 1; i <= pagesToCheck; i++) {
                            const page = await pdfDoc.getPage(i);
                            const textContent = await page.getTextContent();
                            if (textContent.items.some(item => item.str && item.str.trim().length > 0)) {
                                hasAnyText = true;
                                break;
                            }
                        }
                        if (!hasAnyText) {
                            showToast("The opened PDF does not contain text, and VIVIDpdf does not support recognizing words inside images.");
                        }
                    } catch (e) {
                        console.error("Failed to check PDF text content", e);
                    }

                    setTimeout(() => performJump(meta.lastPage || 1, pdfDoc), 300);
                } finally {
                    setIsLoading(false);
                }
            };
            noBlobLoader();
        });
    };

    const handleUploadAttempt = async (file, existingMeta = null) => {
        const info = await getStorageInfo();
        const limitBytes = storageSettings.limitGB * 1024 * 1024 * 1024;

        const fid = existingMeta ? existingMeta.id : getFileId(file);
        const isReplacing = info.records.find(r => r.id === fid)?.hasBlob;

        const alreadySavedBytes = isReplacing ? file.size : 0; // approximation since file.size is same for same id

        if (info.usedBytes + file.size - alreadySavedBytes > limitBytes) {
            if (storageSettings.autoMetadataOnly) {
                loadMetadataOnly(file, existingMeta);
                return;
            }

            const requiredSpace = (info.usedBytes + file.size - alreadySavedBytes) - limitBytes;
            let availableToClear = 0;
            for (let i = info.records.length - 1; i >= 0; i--) {
                let r = info.records[i];
                if (r.hasBlob && r.id !== fid) {
                    availableToClear += r.blobSize || 0;
                }
            }

            setLimitPrompt({
                file: file,
                existingMeta: existingMeta,
                requiredSpace: requiredSpace,
                info: info,
                canAutoDelete: availableToClear >= requiredSpace
            });
            return;
        }

        loadFromBlob(file, existingMeta);
    };

    const handleRecentClick = async (fileRecord) => {
        // Check if we have the blob
        setIsLoading(true);
        let fullRecord;
        try {
            fullRecord = await getFileRecord(fileRecord.id);
        } catch (e) { console.error("Failed to read full record", e); }
        setIsLoading(false);

        if (fullRecord && fullRecord.blob) {
            loadFromBlob(fullRecord.blob, fileRecord);
        } else {
            // Prompt to reupload directly
            setExpectingReupload(fileRecord);
            if (fileInputRef.current) fileInputRef.current.click();
        }
    };

    const handleDeleteRecent = async (e, fileId) => {
        e.stopPropagation();
        try {
            await deleteFileRecord(fileId);
            setRecentFiles(prev => prev.filter(f => f.id !== fileId));
            const updatedInfo = await getStorageInfo();
            setStorageUsed(updatedInfo);
        } catch (err) {
            console.error("Failed to delete record", err);
        }
    };

    const onFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (expectingReupload) {
            if (file.name !== expectingReupload.name) {
                alert(`Warning: Expected to re-upload "${expectingReupload.name}", but selected "${file.name}".`);
                setExpectingReupload(null);
                // proceed as new file
                handleUploadAttempt(file, null);
                return;
            } else {
                // Match! Load it with old meta.
                const meta = expectingReupload;
                setExpectingReupload(null);
                handleUploadAttempt(file, meta);
                return;
            }
        }
        handleUploadAttempt(file, null);
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
            handleUploadAttempt(files[0], expectingReupload ? expectingReupload : null);
            setExpectingReupload(null);
        } else {
            alert("Please drop a valid PDF file.");
        }
    };

    const registerPageRef = useCallback((num, ref) => { pageRefs.current[num] = ref; }, []);

    const getPageRefCallback = useCallback((pageNum) => {
        if (!pageRefCallbacks.current[pageNum]) {
            pageRefCallbacks.current[pageNum] = (r) => registerPageRef(pageNum, r);
        }
        return pageRefCallbacks.current[pageNum];
    }, [registerPageRef]);

    const notifyPageVisible = useCallback((pageNum) => { setActivePage(pageNum); }, []);

    const handleJumpKey = (e) => {
        if (e.key === 'Enter') {
            const page = parseInt(jumpInput);
            if (page >= 1 && page <= numPagesRef.current) {
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
        console.log(`[TTS DEBUG] cancel called from handleTokenClick`);
        ttsGenerationRef.current += 1;
        synth.cancel();
        setIsPlaying(true);
        isPlayingRef.current = true;
        waitingForPageRef.current = null;

        // Determine Start logic
        if (aiConfigRef.current.enabled) {
            playNextSentenceAIRef.current(pageNum, clickedTokenId);
        } else {
            let startIndex = 0;
            if (clickedTokenId) {
                startIndex = pageTokens.findIndex(t => t.id === clickedTokenId);
                if (startIndex === -1) startIndex = 0;
            }
            const tokens = pageTokens.slice(startIndex);
            scheduleNextBatchRef.current(pageNum, tokens, true);
        }

        // Reset the jump flag after a short delay (enough for async cancel events to fire)
        setTimeout(() => { isJumpingRef.current = false; }, 50);
    }, [voices, selectedVoiceURI, rate]);

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

    // --- Helper for AI Flow: Sentence Parsing ---
    const getNextSentenceInfo = (startPageNum, startTokenId) => {
        let tokens = pageTokensMap.current.get(startPageNum) || [];
        if (tokens.length === 0) return { nextPage: true, pageNum: startPageNum };

        const sentences = groupTokensIntoSentences(tokens);
        let sentenceIndex = 0;

        if (startTokenId) {
            sentenceIndex = sentences.findIndex(s => s.some(t => t.id === startTokenId || t.linkedTo === startTokenId));
            if (sentenceIndex === -1) sentenceIndex = 0;
        }

        if (sentenceIndex >= sentences.length) return { nextPage: true, pageNum: startPageNum };

        const sentenceTokens = sentences[sentenceIndex];
        const nextSentence = sentences[sentenceIndex + 1];
        const nextTokenId = nextSentence && nextSentence.length > 0 ? nextSentence[0].id : null;

        return {
            tokens: sentenceTokens,
            pageNum: startPageNum,
            nextTokenId: nextTokenId,
            nextPageNum: nextTokenId ? startPageNum : startPageNum + 1
        };
    };

    // --- AI Transcript Prefetch Helpers ---
    const prefetchAISentence = async (pageNum, tokenId) => {
        if (!aiConfigRef.current.enabled) return;
        if (!pageRefs.current[pageNum]) return;

        const info = getNextSentenceInfo(pageNum, tokenId);
        if (!info.tokens || info.tokens.length === 0) return;

        const firstTokenId = info.tokens[0].id;
        const cacheKey = `${pageNum}:${firstTokenId}`;

        // Skip if already cached or fetch is in-flight
        if (aiTranscriptCache.current.has(cacheKey)) return;
        if (prefetchInProgress.current.has(cacheKey)) return;

        let textToSpeak = info.tokens.map(t => t.spokenText).join(' ');
        textToSpeak = applySkippingRules(textToSpeak, speechCustomizationRef.current);
        if (!textToSpeak.trim()) return;

        const ids = info.tokens.map(t => t.id);
        const imgBase64 = pageRefs.current[pageNum].getWrappedImageForTokens(ids);
        if (!imgBase64) return;

        const isGemini = aiConfigRef.current.model.startsWith('gemini');
        const apiKeyToUse = isGemini ? aiConfigRef.current.geminiApiKey : aiConfigRef.current.openAIApiKey;
        if (!apiKeyToUse || !apiKeyToUse.trim()) return;

        prefetchInProgress.current.add(cacheKey);
        try {
            const aiResult = await fixTranscriptWithAI(
                imgBase64,
                textToSpeak,
                apiKeyToUse,
                aiConfigRef.current.instructions,
                aiConfigRef.current.model
            );
            if (aiResult.transcript && !aiResult.error) {
                aiTranscriptCache.current.set(cacheKey, { transcript: aiResult.transcript });
            } else {
                // Cache the original text so we don't retry on error
                aiTranscriptCache.current.set(cacheKey, { transcript: textToSpeak, error: true });
            }
            setTotalCost(getStoredCost());
        } catch (e) {
            // Swallow prefetch errors silently
        } finally {
            prefetchInProgress.current.delete(cacheKey);
        }
    };

    // Sequentially prefetch up to `count` sentences starting AT (pageNum, tokenId)
    const prefetchNextSentences = async (pageNum, tokenId, count = 3) => {
        if (!aiConfigRef.current.enabled) return;
        let curPageNum = pageNum;
        let curTokenId = tokenId;
        for (let i = 0; i < count; i++) {
            if (!isPlayingRef.current) return; // Stop prefetching if user paused
            const info = getNextSentenceInfo(curPageNum, curTokenId);
            if (!info.tokens || info.tokens.length === 0) {
                // Try next page
                if (info.nextPage && curPageNum < numPagesRef.current) {
                    curPageNum = curPageNum + 1;
                    curTokenId = null;
                    continue;
                }
                return;
            }
            // Prefetch the sentence AT (curPageNum, curTokenId) — sequential: await each
            await prefetchAISentence(curPageNum, curTokenId);
            // Advance to the next sentence
            curPageNum = info.nextTokenId ? curPageNum : curPageNum + 1;
            curTokenId = info.nextTokenId || null;
        }
    };

    // --- NEW: AI-Enhanced Playback Loop ---

    // Queue a pre-cached AI sentence into synth immediately (no API call, synchronous).
    // Returns true if successfully queued. After queuing, immediately tries to cascade
    // and queue the NEXT cached sentence too — this ensures all available cached
    // sentences are queued into synth at once, giving online voices maximum lead time.
    const queueCachedAISentence = (pageNum, tokenId) => {
        if (!isPlayingRef.current) return false;
        if (!aiConfigRef.current.enabled) return false;

        const info = getNextSentenceInfo(pageNum, tokenId);
        if (!info.tokens || info.tokens.length === 0) return false;

        const firstTokenId = info.tokens[0].id;
        const cacheKey = `${pageNum}:${firstTokenId}`;
        const cached = aiTranscriptCache.current.get(cacheKey);
        if (!cached || !cached.transcript) return false; // Not cached yet, can't pre-queue

        let textToSpeak = cached.transcript;
        textToSpeak = applyCustomPronunciations(textToSpeak, customPronunciationsRef.current);

        if (!textToSpeak.trim()) {
            // Empty sentence — skip it, try the next one
            const skipToPageNum = info.nextTokenId ? pageNum : pageNum + 1;
            const skipToTokenId = info.nextTokenId || null;
            return queueCachedAISentenceRef.current(skipToPageNum, skipToTokenId);
        }

        const vSettings = getVoiceSettings(selectedVoiceURI);
        const utter = new SpeechSynthesisUtterance(textToSpeak);
        utter.generation = ttsGenerationRef.current;
        utter.rate = calculateActualRate(rateRef.current, vSettings.sensitivity);
        const targetVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
        if (targetVoice) { utter.voice = targetVoice; utter.lang = targetVoice.lang; }
        utter.hasQueuedNext = false;

        utter.onstart = (event) => {
            if (event.target.generation !== ttsGenerationRef.current) return;
            // Update highlight and scroll to this sentence
            setActiveTokenId(firstTokenId);
            if (pageNum !== activePageRef.current) setActivePage(pageNum);
            handleSmartScroll(pageNum, firstTokenId);
        };

        utter.onend = (event) => {
            if (event.target.generation !== ttsGenerationRef.current) return;
            if (isJumpingRef.current) return;
            if (!isPlayingRef.current) return;
            if (!event.target.hasQueuedNext) {
                // Nothing was pre-queued — fall back to full AI fetch path
                const nextPageNum = info.nextTokenId ? pageNum : pageNum + 1;
                const nextTokenId = info.nextTokenId || null;
                playNextSentenceAIRef.current(nextPageNum, nextTokenId);
            }
        };

        utter.onerror = (e) => {
            if (e.target.generation !== ttsGenerationRef.current) return;
            if (isJumpingRef.current) return;
            if (e.error !== 'interrupted' && e.error !== 'canceled') {
                console.error('Speech Error in pre-queued AI sentence', e);
                setIsPlaying(false);
            }
        };

        synth.speak(utter);

        // Cascade: immediately try to queue the sentence AFTER this one too.
        // This keeps the synth queue full, giving the browser maximum time to
        // pre-synthesize audio for online voices. Stops at first cache miss.
        const cascadePageNum = info.nextTokenId ? pageNum : pageNum + 1;
        const cascadeTokenId = info.nextTokenId || null;
        if (cascadePageNum <= numPagesRef.current) {
            const cascaded = queueCachedAISentenceRef.current(cascadePageNum, cascadeTokenId);
            if (cascaded) utter.hasQueuedNext = true;
        }

        return true;
    };
    const playNextSentenceAI = async (pageNum, tokenId) => {
        console.log(`[TTS DEBUG] playNextSentenceAI called. pageNum: ${pageNum}, tokenId: ${tokenId}, isPlaying: ${isPlayingRef.current}`);
        if (!isPlayingRef.current) return;

        const info = getNextSentenceInfo(pageNum, tokenId);

        // Handle Page Transitions
        if (info.nextPage && !info.tokens) {
            console.log(`[TTS DEBUG] playNextSentenceAI - Page transition needed. targetPage: ${info.pageNum < numPagesRef.current ? info.pageNum + 1 : 'End of Document'}`);
            if (info.pageNum < numPagesRef.current) {
                const nextPage = info.pageNum + 1;
                if (pageTokensMap.current.has(nextPage)) {
                    console.log(`[TTS DEBUG] playNextSentenceAI - Next page tokens found, playing next page.`);
                    const nextTokens = pageTokensMap.current.get(nextPage);
                    playNextSentenceAI(nextPage, nextTokens[0]?.id);
                } else {
                    console.log(`[TTS DEBUG] playNextSentenceAI - Waiting for page ${nextPage} to load.`);
                    waitingForPageRef.current = nextPage;
                    if (pageRefs.current[nextPage]) {
                        pageRefs.current[nextPage].scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            } else {
                console.log(`[TTS DEBUG] playNextSentenceAI - Reached end of document. Stopping playback.`);
                setIsVoiceLoading(false);
                setIsPlaying(false);
            }
            return;
        }

        const sentenceTokens = info.tokens;
        if (!sentenceTokens || sentenceTokens.length === 0) {
            console.log(`[TTS DEBUG] playNextSentenceAI - No sentence tokens found.`);
            return;
        }

        const firstTokenId = sentenceTokens[0].id;
        setActiveTokenId(firstTokenId);
        if (pageNum !== activePage) setActivePage(pageNum);

        // Scroll to current sentence
        handleSmartScroll(pageNum, firstTokenId);

        let textToSpeak = sentenceTokens.map(t => t.spokenText).join(' ');
        textToSpeak = applySkippingRules(textToSpeak, speechCustomizationRef.current);

        // Fire-and-forget: start prefetching the next 3 sentences in parallel with
        // the live AI fetch below — so N+1 is likely cached by the time N finishes playing
        if (info.nextTokenId || info.nextPageNum <= numPagesRef.current) {
            prefetchNextSentences(
                info.nextTokenId ? info.pageNum : info.nextPageNum,
                info.nextTokenId || null
            );
        }

        // --- AI VISUAL FIX STEP (with cache + prefetch) ---
        const cacheKey = `${pageNum}:${firstTokenId}`;
        const cached = aiTranscriptCache.current.get(cacheKey);

        if (cached) {
            // Cache hit: use stored transcript immediately, no API call needed
            console.log(`[TTS DEBUG] playNextSentenceAI - Cache hit for key: ${cacheKey}`);
            if (cached.transcript) textToSpeak = cached.transcript;
        } else if (textToSpeak.trim() && pageRefs.current[pageNum]) {
            const ids = sentenceTokens.map(t => t.id);
            const imgBase64 = pageRefs.current[pageNum].getWrappedImageForTokens(ids);

            if (imgBase64) {
                const isGemini = aiConfigRef.current.model.startsWith('gemini');
                const apiKeyToUse = isGemini ? aiConfigRef.current.geminiApiKey : aiConfigRef.current.openAIApiKey;

                if (apiKeyToUse && apiKeyToUse.trim()) {
                    setOcrLoading(true); // Show Spinner

                    const aiResult = await fixTranscriptWithAI(
                        imgBase64,
                        textToSpeak,
                        apiKeyToUse,
                        aiConfigRef.current.instructions,
                        aiConfigRef.current.model
                    );

                    setOcrLoading(false); // Hide Spinner
                    setTotalCost(getStoredCost()); // Update Cost UI

                    if (!isPlayingRef.current) return; // Check if paused during fetch

                    if (aiResult.transcript && !aiResult.error) {
                        textToSpeak = aiResult.transcript;
                        aiTranscriptCache.current.set(cacheKey, { transcript: textToSpeak });
                    } else if (aiResult.error) {
                        const reason = aiResult.reason || "Unknown error";
                        setAiWarning(`AI Failed: ${reason}`);
                        setTimeout(() => setAiWarning(null), 4000);
                        // Cache original so we don't retry on every replay
                        aiTranscriptCache.current.set(cacheKey, { transcript: textToSpeak, error: true });
                    }
                }
            }
        }
        // ---------------------------

        textToSpeak = applyCustomPronunciations(textToSpeak, customPronunciationsRef.current);

        console.log(`[TTS DEBUG] playNextSentenceAI - Final textToSpeak: "${textToSpeak}"`);

        if (!textToSpeak.trim()) {
            console.log(`[TTS DEBUG] playNextSentenceAI - Empty text to speak. Skipping to next.`);
            if (info.nextTokenId) {
                playNextSentenceAI(info.pageNum, info.nextTokenId);
            } else {
                playNextSentenceAI(info.nextPageNum, null);
            }
            return;
        }

        const vSettings = getVoiceSettings(selectedVoiceURI);
        const utter = new SpeechSynthesisUtterance(textToSpeak);
        utter.generation = ttsGenerationRef.current;
        utter.rate = calculateActualRate(rateRef.current, vSettings.sensitivity);
        const targetVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
        if (targetVoice) { utter.voice = targetVoice; utter.lang = targetVoice.lang; }

        utter.hasQueuedNext = false;

        utter.onstart = (event) => {
            if (event.target.generation !== ttsGenerationRef.current) return;
            console.log(`[TTS DEBUG] playNextSentenceAI - utterance start`);
            // Pre-queue all available cached sentences right now to eliminate
            // gaps with online voices (gives browser max time to pre-synthesize)
            if (!event.target.hasQueuedNext) {
                const nextPageNum = info.nextTokenId ? info.pageNum : info.nextPageNum;
                const nextTokenId = info.nextTokenId || null;
                const queued = queueCachedAISentenceRef.current(nextPageNum, nextTokenId);
                if (queued) event.target.hasQueuedNext = true;
            }
        };

        utter.onend = (event) => {
            if (event.target.generation !== ttsGenerationRef.current) return;
            console.log(`[TTS DEBUG] playNextSentenceAI - utterance end. isJumping: ${isJumpingRef.current}, isPlaying: ${isPlayingRef.current}`);
            if (isJumpingRef.current) return;
            if (isPlayingRef.current && !event.target.hasQueuedNext) {
                // Nothing pre-queued — fall back to full AI path for next sentence
                if (info.nextTokenId) {
                    playNextSentenceAI(info.pageNum, info.nextTokenId);
                } else {
                    playNextSentenceAI(info.nextPageNum, null);
                }
            }
        };

        utter.onerror = (e) => {
            if (e.target.generation !== ttsGenerationRef.current) return;
            console.log(`[TTS DEBUG] playNextSentenceAI - utterance error: ${e.error}. isJumping: ${isJumpingRef.current}`);
            if (isJumpingRef.current) return;
            if (e.error !== 'interrupted' && e.error !== 'canceled') {
                console.error("Speech Error", e);
                setIsPlaying(false);
            }
        };

        console.log(`[TTS DEBUG] calling synth.speak() in playNextSentenceAI`);
        synth.speak(utter);
    };

    // --- TTS Engine (Standard Batch Mode) ---

    const scheduleNextBatch = (startPageNum, carryOverTokens, isFirstBatch = false, allowWait = true) => {
        console.log(`[TTS DEBUG] scheduleNextBatch called. startPage: ${startPageNum}, isFirstBatch: ${isFirstBatch}, allowWait: ${allowWait}, isPlaying: ${isPlayingRef.current}`);
        console.log('[TTS DEBUG] scheduleNextBatch - carryOverTokens:', carryOverTokens);
        if (numPagesRef.current <= 0) {
            console.log(`[ERROR] scheduleNextBatch - numPages is 0 or less. Cannot schedule batch.`, numPagesRef.current);
            return false;
        }

        if (!isPlayingRef.current) return false;

        const vSettings = getVoiceSettings(selectedVoiceURI);
        const forceSentenceMode = !vSettings.supportWordMode;

        let pool = [...carryOverTokens];

        if (pool.length === 0) {
            console.log(`[TTS DEBUG] scheduleNextBatch - No carry over tokens.`);
            const pageTokens = pageTokensMap.current.get(startPageNum);
            if (!pageTokens) {
                console.log(`[TTS DEBUG] scheduleNextBatch - Tokens for page ${startPageNum} not found.`);
                if (allowWait) {
                    console.log(`[TTS DEBUG] scheduleNextBatch - Waiting for page ${startPageNum} to load.`);
                    waitingForPageRef.current = startPageNum;
                    // Scroll into view if waiting for page
                    if (pageRefs.current[startPageNum]) {
                        pageRefs.current[startPageNum].scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
                return false;
            }
            pool = [...pageTokens];
            console.log(`[TTS DEBUG] scheduleNextBatch - loaded ${pool.length} tokens from page ${startPageNum}.`);
        }

        const nextPageNum = startPageNum + 1;
        const nextPageTokens = pageTokensMap.current.get(nextPageNum);
        let hasNextPage = false;

        const hasNextPageTokens = pool.some(t => t.pageNum === nextPageNum);

        if (!hasNextPageTokens && nextPageTokens && nextPageTokens.length > 0) {
            pool = [...pool, ...nextPageTokens];
            hasNextPage = true;
        } else if (hasNextPageTokens) {
            hasNextPage = true;
        }

        let endIndex = pool.length;
        let nextLeftovers = [];

        if (forceSentenceMode) {
            // ONLY Take ONE sentence!
            console.log(`[TTS DEBUG] scheduleNextBatch - forceSentenceMode is ON.`);
            const sentences = groupTokensIntoSentences(pool);
            if (sentences.length > 0) {
                const firstSentence = sentences[0];
                endIndex = firstSentence.length;
                if (endIndex < pool.length) {
                    nextLeftovers = pool.slice(endIndex);
                    pool = pool.slice(0, endIndex);
                }
            }
        } else if (hasNextPage) {
            console.log(`[TTS DEBUG] scheduleNextBatch - hasNextPage is true.`);
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
        if (speechCustomizationRef.current.skipEmails) skippingPatterns.push(/[\w.-]+@[\w.-]+\.\w+/gi);
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

        console.log(`[TTS DEBUG] scheduleNextBatch - Final script generated. Length: ${script.length}. Empty? ${!script.trim()}`);

        if (!script.trim()) {
            const nextBatchPageNum = nextLeftovers.length > 0
                ? nextLeftovers[0].pageNum
                : (hasNextPage ? nextPageNum + 1 : startPageNum + 1);

            console.log('[TTS DEBUG] scheduleNextBatch - script is empty. nextBatchPageNum:', nextBatchPageNum, 'nextLeftovers:', nextLeftovers, 'hasNextPage:', hasNextPage);

            if (nextBatchPageNum <= numPagesRef.current) {
                console.log(`[TTS DEBUG] scheduleNextBatch - script is empty, moving to next page/leftovers: ${nextBatchPageNum}.`);
                return scheduleNextBatch(nextBatchPageNum, nextLeftovers, false, allowWait);
            } else {
                console.log(`[TTS DEBUG] scheduleNextBatch - script is empty and end of document reached, stopping playback.`);
                setIsVoiceLoading(false);
                setIsPlaying(false);
                return false;
            }
        }

        const utter = new SpeechSynthesisUtterance(script);
        utter.generation = ttsGenerationRef.current;
        utter.rate = calculateActualRate(rateRef.current, vSettings.sensitivity);
        const targetVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
        if (targetVoice) { utter.voice = targetVoice; utter.lang = targetVoice.lang; }

        utter.audioMap = map;
        utter.nextBatchInfo = {
            pageNum: nextLeftovers.length > 0 ? nextLeftovers[0].pageNum : (hasNextPage ? nextPageNum + 1 : startPageNum + 1),
            leftovers: nextLeftovers
        };
        utter.hasQueuedNext = false;

        console.log(`[TTS DEBUG] scheduleNextBatch - Created utterance. nextBatchInfo:`, utter.nextBatchInfo);

        utter.onboundary = (event) => {
            if (event.target.generation !== ttsGenerationRef.current) return;
            if (!isPlayingRef.current) {
                console.log(`[TTS DEBUG] utterance.onboundary - Cancelled synth because not playing.`);
                ttsGenerationRef.current += 1;
                synth.cancel();
                return;
            }

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
            if (event.target.generation !== ttsGenerationRef.current) return;
            console.log(`[TTS DEBUG] utterance.onstart - Started utterance.`);
            setIsVoiceLoading(false);
            if (!isPlayingRef.current) return;

            // If word mode is not supported, we must set active token here for the whole sentence highlight
            if (forceSentenceMode) {
                const currentMap = event.target.audioMap;
                if (currentMap && currentMap.length > 0) {
                    const firstEntry = currentMap[0];
                    const tokenId = firstEntry.token.id;
                    const pageNum = firstEntry.token.pageNum;

                    setActiveTokenId(tokenId);
                    if (pageNum !== activePage) {
                        setActivePage(pageNum);
                    }
                    handleSmartScroll(pageNum, tokenId);
                }
            }

            if (!forceSentenceMode) {
                const info = event.target.nextBatchInfo;

                if (info && !event.target.hasQueuedNext && info.pageNum <= numPagesRef.current) {
                    console.log(`[TTS DEBUG] utterance.onstart - queuing next batch.`);
                    const queued = scheduleNextBatch(info.pageNum, info.leftovers, false, false);
                    if (queued) {
                        event.target.hasQueuedNext = true;
                    }
                }
            }
        };

        utter.onend = (event) => {
            if (event.target.generation !== ttsGenerationRef.current) return;
            console.log(`[TTS DEBUG] utterance.onend - Ended utterance. isJumping: ${isJumpingRef.current}`);
            // If we are currently jumping (manual click), ignore the 'end' event 
            // from the canceled utterance so we don't stop playback.
            if (isJumpingRef.current) return;

            setIsVoiceLoading(false);

            if (!isPlayingRef.current) {
                console.log('[TTS DEBUG] utterance.onend - isPlayingRef.current is FALSE, returning early.');
                return;
            }
            if (!event.target.hasQueuedNext) {
                const info = event.target.nextBatchInfo;
                console.log('[TTS DEBUG] utterance.onend - nextBatchInfo:', info);
                if (info && info.pageNum <= numPagesRef.current) {
                    console.log(`[TTS DEBUG] utterance.onend - scheduling next batch from onend. target page: ${info.pageNum}, leftovers:`, info.leftovers);
                    scheduleNextBatch(info.pageNum, info.leftovers, false, true);
                } else {
                    if (info) {
                        console.log(`[TTS DEBUG] utterance.onend - nextBatchInfo pageNum ${info.pageNum} exceeds numPages ${numPagesRef.current}. Stopping playback.`);
                    }
                    console.log(`[TTS DEBUG] utterance.onend - Reached end of document or nextBatchInfo missing/invalid. Calling setIsPlaying(false).`);
                    setIsPlaying(false);
                    setActiveTokenId(null);
                }
            } else {
                console.log('[TTS DEBUG] utterance.onend - hasQueuedNext is TRUE, not scheduling next batch.');
            }
        };

        utter.onerror = (event) => {
            if (event.target.generation !== ttsGenerationRef.current) return;
            console.log(`[TTS DEBUG] utterance.onerror - Error: ${event.error}. isJumping: ${isJumpingRef.current}`);
            // Ignore errors caused by manual cancellation or during a jump
            if (isJumpingRef.current) return;
            if (event.error === 'interrupted' || event.error === 'canceled') return;

            setIsVoiceLoading(false);

            if (isPlayingRef.current) {
                console.log(`[TTS DEBUG] utterance.onerror - Stopping playback due to error.`);
                setIsPlaying(false);
            }
        };

        console.log(`[TTS DEBUG] scheduleNextBatch - calling synth.speak()`);
        if (!synth.speaking) {
            setIsVoiceLoading(true);
        }
        synth.speak(utter);
        return true;
    };

    const togglePlay = () => {
        if (isMarkingModeRef.current) return;
        if (isPlaying) {
            console.log(`[TTS DEBUG] togglePlay - Stopping playback. cancelling synth.`);
            setIsVoiceLoading(false);
            setIsPlaying(false);
            isPlayingRef.current = false;
            waitingForPageRef.current = null;
            ttsGenerationRef.current += 1;
            synth.cancel();
        } else {
            console.log(`[TTS DEBUG] togglePlay - Starting playback. activePage: ${activePage}, activeTokenId: ${activeTokenId}`);
            setIsPlaying(true);
            isPlayingRef.current = true;
            const tokens = pageTokensMap.current.get(activePage) || [];

            // Determine Start Token
            let startTokenId = activeTokenId;
            if (!startTokenId && tokens.length > 0) startTokenId = tokens[0].id;

            // Route based on AI Config
            if (aiConfigRef.current.enabled) {
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
    useEffect(() => {
        playNextSentenceAIRef.current = playNextSentenceAI;
        scheduleNextBatchRef.current = scheduleNextBatch;
        queueCachedAISentenceRef.current = queueCachedAISentence;
    });

    const handleSmartNavigation = useCallback((direction) => {
        // direction: -1 (prev) or 1 (next)
        const currentPageInfo = activePageRef.current !== null ? activePageRef.current : activePage;
        const tokens = pageTokensMap.current.get(currentPageInfo) || [];
        if (tokens.length === 0) return;

        // Use activeTokenIdRef to track current position synchronously for rapid keypresses
        const currentTokenId = activeTokenIdRef.current !== null ? activeTokenIdRef.current : activeTokenId;
        let currentIndex = -1;
        if (currentTokenId) {
            currentIndex = tokens.findIndex(t => t.id === currentTokenId);
        }

        // Default to start if not found
        if (currentIndex === -1) currentIndex = 0;

        let newIndex = currentIndex;

        // Group tokens into sentences using the same logic as highlighting
        const sentences = groupTokensIntoSentences(tokens);
        let currentSentenceIndex = -1;

        // Find which sentence the current token belongs to
        for (let i = 0; i < sentences.length; i++) {
            const sent = sentences[i];
            if (sent.some(t => t.id === tokens[currentIndex].id)) {
                currentSentenceIndex = i;
                break;
            }
        }

        if (currentSentenceIndex === -1) currentSentenceIndex = 0;

        // Both "A" (direction = -1) and "D" (direction = 1) always jump by sentence, regardless of word or sentence mode.
        if (direction === 1) {
            // Find next sentence start
            if (currentSentenceIndex + 1 < sentences.length) {
                const nextSentenceStartToken = sentences[currentSentenceIndex + 1][0];
                newIndex = tokens.findIndex(t => t.id === nextSentenceStartToken.id);
            } else {
                newIndex = tokens.length; // Trigger next page
            }
        } else {
            // direction === -1 (Previous sentence branch)
            if (currentSentenceIndex - 1 >= 0) {
                const prevSentenceStartToken = sentences[currentSentenceIndex - 1][0];
                newIndex = tokens.findIndex(t => t.id === prevSentenceStartToken.id);
            } else {
                newIndex = -1; // Trigger prev page
            }
        }

        if (newIndex < 0) {
            // Go to previous page
            if (currentPageInfo > 1) {
                const prevPage = currentPageInfo - 1;
                activePageRef.current = prevPage;
                const prevTokens = pageTokensMap.current.get(prevPage);
                // Start reading from the last sentence of the previous page
                setActivePage(prevPage);
                performJump(prevPage);
                // Wait for state update is hard in callback. 
                // We manually call click with new data
                if (prevTokens && prevTokens.length > 0) {
                    const prevSentences = groupTokensIntoSentences(prevTokens);
                    const lastSentenceStartToken = prevSentences[prevSentences.length - 1][0];
                    activeTokenIdRef.current = lastSentenceStartToken.id;
                    handleTokenClick(prevTokens, lastSentenceStartToken.id, prevPage);
                }
            }
        } else if (newIndex >= tokens.length) {
            // Go to next page
            if (currentPageInfo < numPagesRef.current) {
                const nextPage = currentPageInfo + 1;
                activePageRef.current = nextPage;
                const nextTokens = pageTokensMap.current.get(nextPage);
                setActivePage(nextPage);
                performJump(nextPage);
                if (nextTokens && nextTokens.length > 0) {
                    activeTokenIdRef.current = nextTokens[0].id;
                    handleTokenClick(nextTokens, nextTokens[0].id, nextPage);
                }
            }
        } else {
            // Same page jump
            activeTokenIdRef.current = tokens[newIndex].id;
            handleTokenClick(tokens, tokens[newIndex].id, currentPageInfo);
        }

    }, [activePage, activeTokenId, readingMode, handleTokenClick, performJump]);

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
                    if (activePage > 1) {
                        const targetPage = activePage - 1;
                        performJump(targetPage);
                        const prevTokens = pageTokensMap.current.get(targetPage);
                        if (prevTokens && prevTokens.length > 0) {
                            activeTokenIdRef.current = prevTokens[0].id;
                            handleTokenClick(prevTokens, prevTokens[0].id, targetPage);
                        }
                    }
                    break;
                case 's':
                    e.preventDefault();
                    if (activePage < numPages) {
                        const targetPage = activePage + 1;
                        performJump(targetPage);
                        const nextTokens = pageTokensMap.current.get(targetPage);
                        if (nextTokens && nextTokens.length > 0) {
                            activeTokenIdRef.current = nextTokens[0].id;
                            handleTokenClick(nextTokens, nextTokens[0].id, targetPage);
                        }
                    }
                    break;
                case 'a':
                    e.preventDefault();
                    handleSmartNavigation(-1);
                    break;
                case 'd':
                    e.preventDefault();
                    handleSmartNavigation(1);
                    break;
                case 'z':
                    e.preventDefault();
                    toggleFitMode();
                    break;
                case 'r': // Reading Mode (Mapped from "M switch reading mode" conflict)
                    e.preventDefault();
                    if (readingMode === 'sentence') {
                        const vSettings = getVoiceSettings(selectedVoiceURI);
                        const targetVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
                        const voiceName = targetVoice ? targetVoice.name : 'this voice';

                        if (aiConfigRef.current.enabled) {
                            showToast("Word Mode is unavailable when AI Fix Mode is enabled.");
                        } else if (!vSettings.supportWordMode) {
                            showToast(`Word Mode is not supported by ${voiceName}.`);
                        } else {
                            setReadingMode('word');
                        }
                    } else {
                        setReadingMode('sentence');
                    }
                    break;
                case 'n':
                    e.preventDefault();
                    setAutoScroll(prev => !prev);
                    break;
                case 'f': // Focus Mode (Mapped from "H" conflict)
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
                    setIsMarkingMode(prev => {
                        const next = !prev;
                        isMarkingModeRef.current = next;
                        return next;
                    });
                    break;
                case 'i': { // AI Fix Mode
                    e.preventDefault();
                    const nextEnabled = !aiConfigRef.current.enabled;
                    setAiConfig({ ...aiConfigRef.current, enabled: nextEnabled });
                    if (nextEnabled) setReadingMode('sentence');
                    break;
                }
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
    }, [activePage, activeTokenId, readingMode, isPlaying, handleSmartNavigation, performJump, toggleFitMode, handleTokenClick, numPages, selectedVoiceURI, togglePlay, voices]);

    const handleResetCost = () => {
        if (confirm("Reset accumulated cost tracker to $0.00?")) {
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
                style={{ display: 'none' }}
                ref={fileInputRef}
            />

            {isDragging && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '24px', pointerEvents: 'none' }}>
                    <div><Icons.Upload style={{ width: 64, height: 64, marginBottom: 20 }} /><p>Drop PDF to Open</p></div>
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
                                    <tr><td><kbd>A</kbd> / <kbd>D</kbd></td><td>Prev / Next Sentence</td></tr>
                                    <tr><td><kbd>Z</kbd></td><td>Toggle Fit Mode</td></tr>
                                    <tr><td><kbd>R</kbd></td><td>Switch Reading Mode (Sentence/Word)</td></tr>
                                    <tr><td><kbd>C</kbd></td><td>Open Customize Speech Menu</td></tr>
                                    <tr><td><kbd>M</kbd></td><td>Open Mark Skip Mode</td></tr>
                                    <tr><td><kbd>N</kbd></td><td>Toggle Auto-Scroll</td></tr>
                                    <tr><td><kbd>F</kbd></td><td>Toggle Focus Mode (Auto-Hide)</td></tr>
                                    <tr><td><kbd>P</kbd></td><td>Enter Page Number Input</td></tr>
                                    <tr><td><kbd>V</kbd></td><td>Open Voice Selection</td></tr>
                                    <tr><td><kbd>I</kbd></td><td>Toggle AI Fix Mode</td></tr>
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

            {/* STORAGE SETTINGS MODAL */}
            {showHomeSettings && (
                <div className="modal-overlay" onClick={() => setShowHomeSettings(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Storage Settings</h3>
                            <button className="icon-btn" onClick={() => setShowHomeSettings(false)}><Icons.Close /></button>
                        </div>
                        <div className="modal-body">
                            <div className="setting-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label>Storage Limit (GB)</label>
                                    <span className="value-badge">{(storageUsed.usedBytes / (1024 * 1024 * 1024)).toFixed(2)} GB / {storageSettings.limitGB} GB used</span>
                                </div>
                                <div style={{ width: '100%', height: '8px', background: '#3f3f46', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%',
                                        background: (storageUsed.usedBytes / (storageSettings.limitGB * 1024 * 1024 * 1024)) > 0.9 ? '#ef4444' : '#3b82f6',
                                        width: `${Math.min(100, (storageUsed.usedBytes / (storageSettings.limitGB * 1024 * 1024 * 1024)) * 100)}%`,
                                        transition: 'width 0.3s ease'
                                    }} />
                                </div>
                                <input
                                    type="number"
                                    min="0" max="500" step="0.5"
                                    value={storageSettings.limitGB}
                                    onChange={e => {
                                        let valStr = e.target.value;
                                        if (valStr === '') {
                                            setStorageSettings({ ...storageSettings, limitGB: '' });
                                            return;
                                        }
                                        let val = parseFloat(valStr);
                                        if (isNaN(val)) return;
                                        if (val < 0) val = 0;
                                        if (val > 500) { alert("Max limit is 500 GB"); val = 500; }
                                        setStorageSettings({ ...storageSettings, limitGB: val });
                                    }}
                                    style={{ padding: '8px', borderRadius: '4px', border: '1px solid #3f3f46', background: '#27272a', color: '#e4e4e7', fontSize: '14px', width: '100px' }}
                                />
                            </div>
                            <div className="setting-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '10px', marginTop: '15px' }}>
                                <label>Auto-delete PDF files after:</label>
                                <select
                                    value={storageSettings.retentionDays}
                                    onChange={e => setStorageSettings({ ...storageSettings, retentionDays: parseInt(e.target.value) })}
                                    style={{ padding: '8px', borderRadius: '4px', border: '1px solid #3f3f46', background: '#27272a', color: '#e4e4e7', fontSize: '14px' }}
                                >
                                    <option value="-1">Keep indefinitely</option>
                                    <option value="7">7 Days</option>
                                    <option value="30">30 Days</option>
                                    <option value="90">90 Days</option>
                                    <option value="365">1 Year</option>
                                </select>
                            </div>

                            <div className="setting-item" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: '15px' }}>
                                <label>Auto-Proceed with Metadata-Only when full</label>
                                <input
                                    type="checkbox"
                                    checked={storageSettings.autoMetadataOnly}
                                    onChange={e => setStorageSettings({ ...storageSettings, autoMetadataOnly: e.target.checked })}
                                />
                            </div>

                            {storageSettings.limitGB * 1024 * 1024 * 1024 < storageUsed.usedBytes && (
                                <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(234, 179, 8, 0.1)', color: '#fcd34d', borderRadius: '6px', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                                    <strong>Warning:</strong> Current limit ({storageSettings.limitGB} GB) is lower than used storage.
                                    <div style={{ marginTop: '10px' }}>
                                        <button onClick={async () => {
                                            let requiredSpace = storageUsed.usedBytes - (storageSettings.limitGB * 1024 * 1024 * 1024);
                                            let toDeleteIds = [];
                                            let clearedSpace = 0;
                                            for (let i = storageUsed.records.length - 1; i >= 0; i--) {
                                                let r = storageUsed.records[i];
                                                if (r.hasBlob) {
                                                    let rFull = await getFileRecord(r.id);
                                                    if (rFull && rFull.blob) {
                                                        clearedSpace += rFull.blob.size;
                                                        toDeleteIds.push(r.id);
                                                    }
                                                }
                                                if (clearedSpace >= requiredSpace) break;
                                            }
                                            if (toDeleteIds.length > 0) {
                                                await deleteBlobs(toDeleteIds);
                                                const info = await getStorageInfo();
                                                setStorageUsed(info);
                                                alert(`Deleted blobs for ${toDeleteIds.length} oldest PDFs. History retained.`);
                                            } else {
                                                alert("No blobs left to delete.");
                                            }
                                        }} className="menu-btn" style={{ background: '#f59e0b', color: '#111', fontWeight: 'bold', border: 'none', marginTop: '10px' }}>
                                            Clear Oldest Blobs Now
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="setting-item" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #3f3f46' }}>
                                <button onClick={async () => {
                                    if (window.confirm("Are you sure you want to clear ALL PDF file contents? This will leave your history metadata intact, but you will need to re-upload PDFs to read them again.")) {
                                        const allIds = storageUsed.records.filter(r => r.hasBlob).map(r => r.id);
                                        if (allIds.length > 0) {
                                            await deleteBlobs(allIds);
                                            const info = await getStorageInfo();
                                            setStorageUsed(info);
                                            alert(`Cleared ${allIds.length} PDF contents successfully.`);
                                        } else {
                                            alert("No PDF contents to clear.");
                                        }
                                    }
                                }} className="menu-btn" style={{ background: '#ef4444', color: '#fff', border: 'none', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Icons.Trash style={{ marginRight: '8px', width: '16px', height: '16px' }} />
                                    Clear All PDF Contents
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* LIMIT EXCEEDED PROMPT */}
            {limitPrompt && (
                <div className="modal-overlay" style={{ zIndex: 10001 }}>
                    <div className="modal-content">
                        <div className="modal-header">
                            <h3 style={{ color: '#ef4444', margin: 0 }}>Storage Limit Exceeded</h3>
                            <button className="icon-btn" onClick={() => setLimitPrompt(null)}><Icons.Close /></button>
                        </div>
                        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <p>Your PDF storage exceeds the local {storageSettings.limitGB} GB limit.</p>

                            <button onClick={() => {
                                setShowHomeSettings(true);
                                setLimitPrompt(null);
                            }} className="menu-btn">
                                a) Increase Storage Limit
                            </button>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                <button onClick={() => {
                                    if (rememberMetadataOnly) {
                                        setStorageSettings({ ...storageSettings, autoMetadataOnly: true });
                                    }
                                    loadMetadataOnly(limitPrompt.file, limitPrompt.existingMeta);
                                }} className="menu-btn" style={{ flex: 1, margin: 0 }}>
                                    b) Proceed (Metadata Only)
                                </button>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                    <input
                                        type="checkbox"
                                        id="rememberChoice"
                                        checked={rememberMetadataOnly}
                                        onChange={e => setRememberMetadataOnly(e.target.checked)}
                                    />
                                    <label htmlFor="rememberChoice" style={{ fontSize: '13px', color: '#e4e4e7', cursor: 'pointer', userSelect: 'none' }}>Remember my choice</label>
                                </div>
                            </div>

                            <div style={{ fontSize: '12px', color: '#a1a1aa', textAlign: 'center', marginTop: '-5px', padding: '0 10px' }}>
                                File will only be available this session. You will have to re-upload when reading in the future.
                            </div>

                            {limitPrompt.canAutoDelete && (
                                <button onClick={async () => {
                                    let requiredSpace = limitPrompt.requiredSpace;
                                    let toDeleteIds = [];
                                    let clearedSpace = 0;
                                    for (let i = limitPrompt.info.records.length - 1; i >= 0; i--) {
                                        let r = limitPrompt.info.records[i];
                                        if (r.hasBlob) {
                                            let rFull = await getFileRecord(r.id);
                                            if (rFull && rFull.blob) {
                                                clearedSpace += rFull.blob.size;
                                                toDeleteIds.push(r.id);
                                            }
                                        }
                                        if (clearedSpace >= requiredSpace) break;
                                    }

                                    if (clearedSpace >= requiredSpace) {
                                        await deleteBlobs(toDeleteIds);
                                        alert(`Deleted blobs for ${toDeleteIds.length} oldest PDFs to clear ${Math.ceil(clearedSpace / 1024 / 1024)} MB. History retained.`);
                                        setLimitPrompt(null);
                                        // Now we have space, proceed with upload
                                        loadFromBlob(limitPrompt.file, limitPrompt.existingMeta);
                                    } else {
                                        alert("Even after deleting all eligible older blobs, there is still not enough space. Please increase the limit or choose 'Metadata Only'.");
                                    }
                                }} className="menu-btn" style={{ background: '#f59e0b', color: '#111', fontWeight: 'bold', border: 'none' }}>
                                    c) Auto-Delete Oldest Blobs & Proceed
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <main className="main-content" style={{ userSelect: textSelectionEnabled ? 'text' : 'none' }}>
                <div className="scroll-viewport" ref={viewportRef}>
                    {isLoading && (
                        <div className="loading-overlay">
                            <div className="spinner"></div>
                            <p>Processing Document...</p>
                        </div>
                    )}
                    {!pdf ? (
                        <div className="dashboard-container" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ flex: 1, minHeight: '100vh', position: 'relative' }}>
                                {/* Settings Icon in Dashboard */}
                                <div style={{ position: 'absolute', top: 0, right: 20, display: 'flex', gap: '10px' }}>
                                    <button
                                        className="upload-btn"
                                        onClick={() => setShowHelp(true)}
                                        style={{ border: '1px solid #3f3f46', display: 'flex', alignItems: 'center', gap: '8px' }}
                                    >
                                        <span style={{ fontSize: '18px' }}>?</span>
                                        Keyboard Shortcuts
                                    </button>
                                    <button
                                        className="upload-btn"
                                        onClick={() => setShowHomeSettings(true)}
                                        title="History Storage Settings"
                                        style={{ border: '1px solid #3f3f46', display: 'flex', alignItems: 'center', gap: '8px' }}
                                    >
                                        <Icons.Settings />
                                    </button>

                                </div>

                                <div className="empty-placeholder">
                                    <label className="upload-btn main-upload" onClick={() => fileInputRef.current.click()}>
                                        <Icons.Upload /> Open PDF File
                                    </label>
                                    <p style={{ marginTop: '20px', color: '#9e9e9e', fontSize: '14px' }}>or drag and drop a file here</p>


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
                                                        {!file.hasBlob && (
                                                            <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(0,0,0,0.7)', padding: '6px', borderRadius: '50%', color: '#f87171', display: 'flex' }} title="Content cleared to save space. Click to re-upload.">
                                                                <Icons.CloudOff style={{ width: '18px', height: '18px' }} />
                                                            </div>
                                                        )}
                                                        <div className="page-badge">Pg {file.lastPage}</div>
                                                    </div>
                                                    <div className="recent-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div className="recent-name" title={file.name}>{file.name}</div>
                                                            <div className="recent-date">
                                                                {new Date(file.lastOpened).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                            </div>
                                                        </div>
                                                        <button
                                                            className="icon-btn delete-recent-btn"
                                                            onClick={(e) => handleDeleteRecent(e, file.id)}
                                                            title="Remove Record"
                                                            style={{ flexShrink: 0, padding: '4px', width: 'auto', height: 'auto', marginLeft: '8px' }}
                                                        >
                                                            <Icons.Trash style={{ width: '16px', height: '16px' }} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div style={{ marginTop: '50px', paddingBottom: '20px', textAlign: 'center', color: '#9e9e9e', fontSize: '13px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                <span>VIVIDpdf is a free and opensource software. <em><a href="https://www.gnu.org/philosophy/free-sw.en.html" target="_blank">Free as in freedom</a></em>.</span>
                                <a href="https://github.com/Nathan903/VIVIDpdf" target="_blank" rel="noopener noreferrer" style={{ color: '#a1a1aa', textDecoration: 'none', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }} onMouseOver={e => e.currentTarget.style.color = '#6366f1'} onMouseOut={e => e.currentTarget.style.color = '#a1a1aa'} title="View on GitHub">
                                    <Icons.Github style={{ width: '20px', height: '20px' }} />
                                </a>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className={`pdf-stream ${darkMode ? 'dark-mode' : ''}`}>
                                {Array.from(new Array(numPages), (_, i) => i + 1).map(pageNum => (
                                    <PDFPage
                                        key={pageNum}
                                        ref={getPageRefCallback(pageNum)}
                                        pdfDoc={pdf}
                                        pageNum={pageNum}
                                        scale={scale}
                                        rotation={rotation}
                                        activeTokenId={activePage === pageNum ? activeTokenId : null}
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
                        </>
                    )}
                </div>

                {/* OCR LOADING INDICATOR */}
                {ocrLoading && (
                    <div style={{ position: 'absolute', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: '#333', color: 'white', padding: '8px 16px', borderRadius: '20px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', zIndex: 2000 }}>
                        <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, marginBottom: 0 }}></div> AI Improving Text...
                    </div>
                )}

                {/* AI WARNING INDICATOR */}
                {aiWarning && (
                    <div style={{ position: 'absolute', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(50, 50, 50, 0.95)', color: '#e4e4e7', padding: '6px 14px', borderRadius: '20px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 10px rgba(0,0,0,0.2)', zIndex: 2000 }}>
                        <span style={{ fontSize: '14px' }}>⚠️</span> {aiWarning}
                    </div>
                )}

                {/* VOICE LOADING INDICATOR */}
                {isVoiceLoading && (
                    <div style={{ position: 'absolute', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: '#333', color: 'white', padding: '8px 16px', borderRadius: '20px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', zIndex: 2000 }}>
                        <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, marginBottom: 0 }}></div> Loading Voice...
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

                                <button className="text-btn" onClick={toggleFitMode} title="Toggle Fit (Z)">
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

                                {/* 
                                <button
                                    className={`icon-btn ${showHelp ? 'active' : ''}`}
                                    onClick={() => setShowHelp(!showHelp)}
                                    title="Shortcuts (H)"
                                >
                                    <span style={{ fontSize: '18px', fontWeight: 'bold' }}>?</span>
                                </button> */}

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
                                            <div className="setting-item">
                                                <label><Icons.Language /> Language</label>
                                                <select
                                                    value={selectedLanguage}
                                                    onChange={e => {
                                                        const newLang = e.target.value;
                                                        setSelectedLanguage(newLang);
                                                        // Check if we have a saved voice for this language
                                                        if (languageVoiceCache[newLang]) {
                                                            setSelectedVoiceURI(languageVoiceCache[newLang]);
                                                        } else {
                                                            // Pick first voice of this language
                                                            const firstNewVoice = voices.find(v => v.lang.startsWith(newLang));
                                                            if (firstNewVoice) setSelectedVoiceURI(firstNewVoice.voiceURI);
                                                        }
                                                    }}
                                                    className="voice-select"
                                                >
                                                    {Array.from(new Set(voices.map(v => v.lang ? v.lang.split('-')[0] : ''))).filter(Boolean).sort().map(lang => {
                                                        let displayName = lang;
                                                        try {
                                                            displayName = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
                                                        } catch (e) {
                                                            // fallback to lang code
                                                        }
                                                        return (
                                                            <option key={lang} value={lang}>
                                                                {displayName}
                                                            </option>
                                                        )
                                                    })}
                                                </select>
                                            </div>

                                            <div className="setting-item">
                                                <label><Icons.Voice /> Voice</label>
                                                <select
                                                    ref={voiceSelectRef}
                                                    value={selectedVoiceURI}
                                                    onChange={e => {
                                                        const uri = e.target.value;
                                                        setSelectedVoiceURI(uri);
                                                        // Update cache for this language
                                                        if (selectedLanguage) {
                                                            setLanguageVoiceCache(prev => ({ ...prev, [selectedLanguage]: uri }));
                                                        }
                                                    }}
                                                    className="voice-select"
                                                >
                                                    {voices.filter(v => v.lang.startsWith(selectedLanguage)).map(v => (
                                                        <option key={v.voiceURI} value={v.voiceURI}>{v.name} {v.localService ? '(Offline)' : '(Requires Internet)'}</option>
                                                    ))}
                                                </select>
                                            </div>


                                            <div className="setting-item">
                                                <label style={{ flex: 1 }}>Reading Mode (R)</label>
                                                <div className="toggle-group">
                                                    <button
                                                        className={`toggle-btn ${readingMode === 'word' ? 'active' : ''}`}
                                                        onClick={() => {
                                                            const vSettings = getVoiceSettings(selectedVoiceURI);
                                                            const targetVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
                                                            const voiceName = targetVoice ? targetVoice.name : 'this voice';

                                                            if (aiConfig.enabled && readingMode !== 'word') {
                                                                showToast("Word Mode is unavailable when AI Fix Mode is enabled.");
                                                            } else if (!vSettings.supportWordMode && readingMode !== 'word') {
                                                                showToast(`Word Mode is not supported by ${voiceName}.`);
                                                            } else {
                                                                setReadingMode('word');
                                                            }
                                                        }}
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
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                                    <label>Focus Mode (auto-hide menu) (F)</label>
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
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                                    <label>Auto-Scroll (N)</label>
                                                    <input
                                                        type="checkbox"
                                                        checked={autoScroll}
                                                        onChange={(e) => setAutoScroll(e.target.checked)}
                                                        style={{ width: 'auto' }}
                                                    />
                                                </div>
                                            </div>

                                            {/* AI CONFIGURATION SECTION */}
                                            <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 5, paddingBottom: 10 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <label><Icons.Sparkles /> AI Fix Mode</label>
                                                    <input type="checkbox" checked={aiConfig.enabled} onChange={e => {
                                                        const isChecked = e.target.checked;
                                                        setAiConfig({ ...aiConfig, enabled: isChecked });
                                                        if (isChecked) setReadingMode('sentence');
                                                    }} />
                                                </div>
                                                {aiConfig.enabled && (
                                                    <>
                                                        <select
                                                            value={aiConfig.model}
                                                            onChange={e => setAiConfig({ ...aiConfig, model: e.target.value })}
                                                            style={{ width: '100%', padding: 4, fontSize: '12px', marginBottom: '8px' }}
                                                        >
                                                            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Fastest)</option>
                                                            <option value="gemini-3-flash-preview">Gemini 3 Flash (High Quality)</option>
                                                            <option value="gpt-4o-mini">GPT-4o Mini</option>
                                                            <option value="gpt-4o">GPT-4o</option>
                                                        </select>

                                                        {aiConfig.model.startsWith('gemini') ? (
                                                            <>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Gemini API Key Required*"
                                                                    value={aiConfig.geminiApiKey || ''}
                                                                    onChange={e => setAiConfig({ ...aiConfig, geminiApiKey: e.target.value })}
                                                                    style={{
                                                                        fontSize: '12px',
                                                                        fontFamily: 'monospace',
                                                                        width: '100%',
                                                                        padding: '6px 4px',
                                                                        border: !(aiConfig.geminiApiKey || '').trim() ? '1px solid #f44336' : '1px solid #ccc',
                                                                        backgroundColor: !(aiConfig.geminiApiKey || '').trim() ? 'rgba(244, 67, 54, 0.1)' : undefined
                                                                    }}
                                                                />
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '-2px', marginBottom: '4px' }}>
                                                                    {!(aiConfig.geminiApiKey || '').trim() ? (
                                                                        <span style={{ color: '#f44336', fontSize: '11px', fontWeight: 'bold' }}>
                                                                            Please enter a Gemini API Key.
                                                                        </span>
                                                                    ) : (
                                                                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: geminiKeyStatus === 'valid' ? '#4caf50' : geminiKeyStatus === 'invalid' ? '#f44336' : '#888' }}>
                                                                            {geminiKeyStatus === 'loading' && 'Verifying...'}
                                                                            {geminiKeyStatus === 'valid' && '✓ Key Verified'}
                                                                            {geminiKeyStatus === 'invalid' && '✗ Invalid API Key'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <input
                                                                    type="text"
                                                                    placeholder="OpenAI API Key Required*"
                                                                    value={aiConfig.openAIApiKey || ''}
                                                                    onChange={e => setAiConfig({ ...aiConfig, openAIApiKey: e.target.value })}
                                                                    style={{
                                                                        fontSize: '12px',
                                                                        fontFamily: 'monospace',
                                                                        width: '100%',
                                                                        padding: '6px 4px',
                                                                        border: !(aiConfig.openAIApiKey || '').trim() ? '1px solid #f44336' : '1px solid #ccc',
                                                                        backgroundColor: !(aiConfig.openAIApiKey || '').trim() ? 'rgba(244, 67, 54, 0.1)' : undefined
                                                                    }}
                                                                />
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '-2px', marginBottom: '4px' }}>
                                                                    {!(aiConfig.openAIApiKey || '').trim() ? (
                                                                        <span style={{ color: '#f44336', fontSize: '11px', fontWeight: 'bold' }}>
                                                                            Please enter an OpenAI API Key.
                                                                        </span>
                                                                    ) : (
                                                                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: openAIKeyStatus === 'valid' ? '#4caf50' : openAIKeyStatus === 'invalid' ? '#f44336' : '#888' }}>
                                                                            {openAIKeyStatus === 'loading' && 'Verifying...'}
                                                                            {openAIKeyStatus === 'valid' && '✓ Key Verified'}
                                                                            {openAIKeyStatus === 'invalid' && '✗ Invalid API Key'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </>
                                                        )}
                                                        <textarea
                                                            placeholder="Custom instructions (e.g. Skip equations...)"
                                                            value={aiConfig.instructions}
                                                            onChange={e => setAiConfig({ ...aiConfig, instructions: e.target.value })}
                                                            rows={2}
                                                            style={{ width: '100%', fontSize: '11px', resize: 'none' }}
                                                        />
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginTop: 5 }}>
                                                            <span>Cost Tracker: ${totalCost.toFixed(6)} used</span>
                                                            <button onClick={handleResetCost} style={{ background: 'none', border: 'none', color: '#d32f2f', cursor: 'pointer', padding: 0 }}>Reset</button>
                                                        </div>
                                                    </>
                                                )}
                                            </div>                                            {/* ADVANCED OPTIONS */}
                                            <button
                                                className="advanced-toggle"
                                                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                                                style={{ background: 'none', border: 'none', color: '#a1a1aa', width: '100%', textAlign: 'left', cursor: 'pointer', padding: '10px 0', fontSize: '13px', fontWeight: 'bold' }}
                                            >
                                                Advanced Options {showAdvancedSettings ? '▲' : '▼'}
                                            </button>

                                            {showAdvancedSettings && (
                                                <div className="advanced-options-panel" style={{ marginTop: '5px', display: 'flex', flexDirection: 'column', gap: '5px' }}>

                                                    {/* TEXT SELECTION SETTING */}
                                                    <div className="setting-item" style={{ marginBottom: 0 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                                            <label>Enable text selection</label>
                                                            <input
                                                                type="checkbox"
                                                                checked={textSelectionEnabled}
                                                                onChange={(e) => setTextSelectionEnabled(e.target.checked)}
                                                                style={{ width: 'auto' }}
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="setting-divider" style={{ margin: '5px 0' }}></div>

                                                    {/* HIGHLIGHT SETTINGS */}
                                                    <div className="setting-item" style={{ marginBottom: 0 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', width: '100%' }}>
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
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', width: '100%' }}>
                                                                    <label style={{ fontSize: '13px', color: '#555' }}>Color</label>
                                                                    <input
                                                                        type="color"
                                                                        value={highlightColor}
                                                                        onChange={e => setHighlightColor(e.target.value)}
                                                                        style={{ width: '40px', height: '25px', padding: 0, border: 'none' }}
                                                                    />
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                                                    <label style={{ fontSize: '13px', color: '#555' }}>Opacity</label>
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

                                                    <div className="setting-divider" style={{ margin: '5px 0' }}></div>

                                                    {/* OFFLINE FALLBACK VOICES */}
                                                    <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: 0 }}>
                                                        <label style={{ marginBottom: '8px' }}>Offline Fallback Voice</label>
                                                        <p style={{ fontSize: '11px', color: '#888', marginTop: 0, marginBottom: '10px', lineHeight: '1.4' }}>
                                                            Select a local voice to use as a fallback if the online speech engine fails to respond.
                                                        </p>

                                                        {(!voices.find(v => v.voiceURI === selectedVoiceURI) || voices.find(v => v.voiceURI === selectedVoiceURI).localService) ? (
                                                            <div style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', fontSize: '12px', color: '#a1a1aa', width: '100%', textAlign: 'center' }}>
                                                                Fallback not needed. Current voice is already offline.
                                                            </div>
                                                        ) : (
                                                            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                                <select
                                                                    value={offlineFallbackConfig.language}
                                                                    onChange={e => {
                                                                        const newLang = e.target.value;
                                                                        const firstVoice = voices.find(v => v.localService && v.lang.startsWith(newLang));
                                                                        setOfflineFallbackConfig({ ...offlineFallbackConfig, language: newLang, voiceURI: firstVoice ? firstVoice.voiceURI : '' });
                                                                    }}
                                                                    className="voice-select"
                                                                    style={{ width: '100%', padding: '6px' }}
                                                                >
                                                                    {Array.from(new Set(voices.filter(v => v.localService).map(v => v.lang ? v.lang.split('-')[0] : ''))).filter(Boolean).sort().map(lang => {
                                                                        let displayName = lang;
                                                                        try {
                                                                            displayName = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
                                                                        } catch (e) {
                                                                            // fallback to lang code
                                                                        }
                                                                        return (
                                                                            <option key={lang} value={lang}>
                                                                                {displayName}
                                                                            </option>
                                                                        )
                                                                    })}
                                                                </select>

                                                                <select
                                                                    value={offlineFallbackConfig.voiceURI}
                                                                    onChange={e => setOfflineFallbackConfig({ ...offlineFallbackConfig, voiceURI: e.target.value })}
                                                                    className="voice-select"
                                                                    style={{ width: '100%', padding: '6px' }}
                                                                >
                                                                    {voices.filter(v => v.localService && v.lang.startsWith(offlineFallbackConfig.language)).map(v => (
                                                                        <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                                                                    ))}
                                                                </select>

                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                                                    <label style={{ fontSize: '12px', color: '#aaa' }}>Fallback Speed</label>
                                                                    <span className="value-badge" style={{ fontSize: '11px', padding: '2px 6px' }}>{offlineFallbackConfig.rate.toFixed(1)}x</span>
                                                                </div>
                                                                <input
                                                                    type="range"
                                                                    className="styled-slider"
                                                                    min="0.5" max="3.0" step="0.1"
                                                                    value={offlineFallbackConfig.rate}
                                                                    onChange={e => setOfflineFallbackConfig({ ...offlineFallbackConfig, rate: Number(e.target.value) })}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}


                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* TOAST SYSTEM */}
            {toast && (
                <div className="toast-notification">
                    {toast}
                </div>
            )}


        </div>
    );
};

export default App;