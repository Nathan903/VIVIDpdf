import { Vocalize } from "vocalize.ts";

const tts = new Vocalize({
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
});

tts.speak("Hello Joshua, your vocalizer is now working!");
