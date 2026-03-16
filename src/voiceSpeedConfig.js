// Configuration for different voice engines

export const PRIORITY_VOICES = [
    "Aria",
    "Zoe",
    "Samantha",
    "Zira",
    "Heather",
];

export const VOICE_CONFIGS = {
    // Google voices (Online, high sensitivity, don't support word boundary)
    "Google US English": {
        sensitivity: 2.0,      // e.g. 2x slider = 4x real
        supportWordMode: false
    },
    // Add other known google voices here
    "Google UK English Female": {
        sensitivity: 2.0,
        supportWordMode: false
    },
    "Google UK English Male": {
        sensitivity: 2.0,
        supportWordMode: false
    },
    
    // Default / Fallback (Microsoft, Apple, local voices)
    "default": {
        sensitivity: 1.0,      // 1:1 mapping
        supportWordMode: true
    }
};

/**
 * Get settings for a specific voice URI
 * @param {string} voiceURI - The URI of the selected voice
 * @returns {Object} Config object { sensitivity, supportWordMode }
 */
export const getVoiceSettings = (voiceURI) => {
    if (!voiceURI) return VOICE_CONFIGS["default"];
    
    // Check for exact matches
    if (VOICE_CONFIGS[voiceURI]) {
        return VOICE_CONFIGS[voiceURI];
    }
    
    // Check for partial matches (e.g., all voices starting with "Google")
    if (voiceURI.startsWith("Google")) {
        return VOICE_CONFIGS["Google US English"]; // Use as base for Google voices
    }
    
    // Fallback for unknown voices (assume they behave like standard local voices)
    return VOICE_CONFIGS["default"];
};

/**
 * Calculate the actual playback rate to send to the SpeechSynthesisUtterance
 * @param {number} userRate - The rate selected on the UI slider (e.g., 0.5 to 2.0)
 * @param {number} sensitivity - The sensitivity multiplier for the voice
 * @returns {number} The actual rate to use
 */
export const calculateActualRate = (userRate, sensitivity) => {
    // Use a power function to map the user's linear slider to the engine's curve.
    // E.g., if Google sensitivity is 2.0:
    // userRate = 0.5 -> 0.5^(1/2) = 0.707
    // userRate = 2.0 -> 2.0^(1/2) = 1.414 
    // Wait, the prompt said:
    // "Google at 0.5x is about the same as microsoft 0.25x"
    // "Google at 2x is about the same as microsoft 4x"
    // This implies Google = Microsoft^2.  So if user selects 2x, they want the *effect* of 2x Microsoft.
    // So we need: EngineRate = UserRate ^ (1 / sensitivity)  where sensitivity = 0.5 ? 
    // Let's re-read: "Google at 2x is about 4x Microsoft". So EngineRate 2.0 = PerceivedRate 4.0.
    // PerceivedRate = EngineRate ^ 2.
    // If user selects 2.0 on the slider (PerceivedRate), we need EngineRate = sqrt(2.0) = 1.414.
    // EngineRate = UserRate ^ (1 / 2) -> Math.pow(userRate, 1 / 2.0). 
    // Yes, this matches.
    
    return Math.pow(userRate, 1 / sensitivity);
};
