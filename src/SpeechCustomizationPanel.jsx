import React, { useMemo } from 'react';
import { Icons } from './Icons';

const SpeechCustomizationPanel = ({ 
    speechCustomization, 
    setSpeechCustomization, 
    customPronunciations, 
    setCustomPronunciations,
    onClose
}) => {
    // Track which indices have duplicate patterns
    // If both rules are case-sensitive, exact match only.
    // If either is case-insensitive, compare case-insensitively (they'd overlap at runtime).
    const duplicateIndices = useMemo(() => {
        const dupes = new Set();
        for (let i = 0; i < customPronunciations.length; i++) {
            const pi = customPronunciations[i].pattern.trim();
            if (!pi) continue;
            for (let j = i + 1; j < customPronunciations.length; j++) {
                const pj = customPronunciations[j].pattern.trim();
                if (!pj) continue;
                const bothCaseSensitive = customPronunciations[i].caseSensitive && customPronunciations[j].caseSensitive;
                const match = bothCaseSensitive
                    ? pi === pj
                    : pi.toLowerCase() === pj.toLowerCase();
                if (match) {
                    dupes.add(i);
                    dupes.add(j);
                }
            }
        }
        return dupes;
    }, [customPronunciations]);

    const handleAddPronunciation = () => {
        setCustomPronunciations([
            ...customPronunciations, 
            { pattern: '', replacement: '', caseSensitive: false, matchType: 'exact' }
        ]);
    };

    const handleUpdatePronunciation = (index, field, value) => {
        const newPronunciations = [...customPronunciations];
        newPronunciations[index][field] = value;
        setCustomPronunciations(newPronunciations);
    };

    const handleRemovePronunciation = (index) => {
        const newPronunciations = [...customPronunciations];
        newPronunciations.splice(index, 1);
        setCustomPronunciations(newPronunciations);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '500px', background: '#27272a', color: '#e4e4e7' }}>
                <div className="modal-header" style={{ borderBottom: '1px solid #3f3f46' }}>
                    <h3 style={{ margin: 0 }}>Speech Customization</h3>
                    <button className="icon-btn" onClick={onClose}><Icons.Close /></button>
                </div>
                
                <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                    <div style={{ marginBottom: '20px' }}>
                        <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#e4e4e7' }}>Custom Pronunciation</h4>
                    
                    {customPronunciations.length === 0 ? (
                        <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '10px' }}>No custom pronunciations yet.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                            {customPronunciations.map((rule, index) => (
                                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', background: '#27272a', padding: '8px', borderRadius: '4px', border: '1px solid #3f3f46' }}>
                                    <input 
                                        type="text" 
                                        placeholder="Original text" 
                                        value={rule.pattern} 
                                        onChange={(e) => handleUpdatePronunciation(index, 'pattern', e.target.value)}
                                        style={{ flex: 1, minWidth: '80px', padding: '4px', fontSize: '12px', border: `1px solid ${duplicateIndices.has(index) ? '#ef4444' : '#3f3f46'}`, borderRadius: '4px', background: '#18181b', color: '#e4e4e7' }}
                                    />
                                    <span style={{ color: '#a1a1aa' }}>→</span>
                                    <input 
                                        type="text" 
                                        placeholder="Spoken as..." 
                                        value={rule.replacement} 
                                        onChange={(e) => handleUpdatePronunciation(index, 'replacement', e.target.value)}
                                        style={{ flex: 1, minWidth: '80px', padding: '4px', fontSize: '12px', border: '1px solid #3f3f46', borderRadius: '4px', background: '#18181b', color: '#e4e4e7' }}
                                    />
                                    {duplicateIndices.has(index) && (
                                        <div style={{ width: '100%', fontSize: '11px', color: '#ef4444', marginTop: '2px' }}>Duplicate word — only the first entry will be used</div>
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between', marginTop: '4px', gap: '6px' }}>
                                        <select
                                            value={rule.matchType || 'exact'}
                                            onChange={(e) => handleUpdatePronunciation(index, 'matchType', e.target.value)}
                                            style={{ padding: '2px 4px', fontSize: '11px', border: '1px solid #3f3f46', borderRadius: '4px', background: '#18181b', color: '#e4e4e7', cursor: 'pointer' }}
                                        >
                                            <option value="exact">Exact word</option>
                                            <option value="contains">Contains</option>
                                            <option value="startsWith">Starts with</option>
                                            <option value="endsWith">Ends with</option>
                                        </select>
                                        <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#a1a1aa' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={rule.caseSensitive} 
                                                onChange={(e) => handleUpdatePronunciation(index, 'caseSensitive', e.target.checked)}
                                            />
                                            Case sensitive
                                        </label>
                                        <button 
                                            onClick={() => handleRemovePronunciation(index)}
                                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
                                            title="Remove"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    <button 
                        onClick={handleAddPronunciation}
                        style={{ background: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                        <span style={{ fontSize: '14px' }}>+</span> Add pronunciation
                    </button>
                    <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '8px' }}>
                        Example: map <code style={{background: '#27272a', padding: '2px 4px', borderRadius: '3px'}}>SQL</code> → <code style={{background: '#27272a', padding: '2px 4px', borderRadius: '3px'}}>sequel</code>, <code style={{background: '#27272a', padding: '2px 4px', borderRadius: '3px'}}>UofT</code> → <code style={{background: '#27272a', padding: '2px 4px', borderRadius: '3px'}}>U of Tears</code>.
                    </div>
                </div>

                <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#e4e4e7' }}>Custom Skipping Rules</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: '#e4e4e7' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={speechCustomization.skipUrls} 
                                onChange={(e) => setSpeechCustomization({...speechCustomization, skipUrls: e.target.checked})}
                            />
                            Skip URLs (http://, https://, www.)
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={speechCustomization.skipSquare} 
                                onChange={(e) => setSpeechCustomization({...speechCustomization, skipSquare: e.target.checked})}
                            />
                            Skip content inside square brackets <code style={{background: '#27272a', padding: '2px 4px', borderRadius: '3px'}}>[ ... ]</code>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={speechCustomization.skipParens} 
                                onChange={(e) => setSpeechCustomization({...speechCustomization, skipParens: e.target.checked})}
                            />
                            Skip content inside parentheses <code style={{background: '#27272a', padding: '2px 4px', borderRadius: '3px'}}>( ... )</code>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={speechCustomization.skipCurly} 
                                onChange={(e) => setSpeechCustomization({...speechCustomization, skipCurly: e.target.checked})}
                            />
                            Skip content inside curly braces <code style={{background: '#27272a', padding: '2px 4px', borderRadius: '3px'}}>{'{ ... }'}</code>
                        </label>
                    </div>
                    <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '8px' }}>
                        These rules apply to all spoken speech.
                    </div>
                </div>

                <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#e4e4e7' }}>Visual Indicator</h4>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: '#e4e4e7' }}>
                        <input 
                            type="checkbox" 
                            checked={speechCustomization.visualIndicator} 
                            onChange={(e) => setSpeechCustomization({...speechCustomization, visualIndicator: e.target.checked})}
                        />
                        Dim affected words in viewer
                    </label>
                    <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '8px' }}>
                        Deemphasizes words that will be skipped or replaced during speech.
                    </div>
                </div>
            </div>
        </div>
        </div>
    );
};

export default SpeechCustomizationPanel;
