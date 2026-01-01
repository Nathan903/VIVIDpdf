import os
from openai import OpenAI
import sounddevice as sd

# --- Configuration ---

# 1. Set your API Key
# Best practice: Set this as an environment variable (e.g., export OPENAI_API_KEY='your_key_here')
# Or, for testing, you can uncomment and hardcode it (not recommended for production):
# os.environ["OPENAI_API_KEY"] = "sk-..." 

# 2. Audio settings for OpenAI's 'pcm' format
# 'tts-1' models default to a 24000Hz sample rate
SAMPLE_RATE = 24000
# The 'pcm' format from OpenAI is 16-bit signed integer, little-endian. 'int16' is the numpy/sounddevice dtype.
DTYPE = 'int16'
# The TTS models output mono audio
CHANNELS = 1
# Use a reasonable chunk size for streaming
CHUNK_SIZE = 1024

# 3. Text to speak
TEXT_TO_SPEAK = (
    "Hello, this is a real-time text-to-speech test using OpenAI's API. "
    "By streaming PCM data directly to the audio device, "
    "we can start playback almost immediately."
)

# --- Main Execution ---

def main():
    """
    Streams TTS audio from OpenAI to the default speaker in real-time.
    """
    try:
        if not api_key:
            print("Error: OPENAI_API_KEY environment variable not set.")
            print("Please set the variable, e.g.:")
            print("export OPENAI_API_KEY='your_sk_..._key'")
            return
        
        client = OpenAI(api_key=api_key)

        # 1. Create a raw output stream with sounddevice
        # This stream will accept raw audio bytes (in 'int16' format)
        stream = sd.RawOutputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            blocksize=CHUNK_SIZE
        )
        
        # 2. Use a try/finally block to ensure the stream is always closed
        try:
            # 3. Start the audio stream
            stream.start()
            print(f"Streaming audio for: '{TEXT_TO_SPEAK}'")

            # 4. Use context manager for streaming response
            with client.audio.speech.with_streaming_response.create(
                model="tts-1",         # 'tts-1' is faster, 'tts-1-hd' is higher quality
                voice="alloy",         # Choose from: alloy, echo, fable, onyx, nova, shimmer
                input=TEXT_TO_SPEAK,
                response_format="pcm"  # Corrected: Use 'pcm' instead of 'pcm_s16le'
            ) as response:
                # 5. Read the audio in chunks and write to the stream
                for chunk in response.iter_bytes(chunk_size=CHUNK_SIZE):
                    if chunk:
                        stream.write(chunk)
            
            print("Streaming complete.")

        finally:
            # 6. Stop and close the stream
            stream.stop()
            stream.close()
            print("Audio stream closed.")

    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    main()

