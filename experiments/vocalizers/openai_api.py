from openai import OpenAI
import pathlib

# Initialize client (ensure your OPENAI_API_KEY is set in environment)

# Define text and output file
text = """
For testing: PDF_get_text_content()

Challenging for PDF-to-json:

runtime of O(n2)

for all e ∈ 𝒳 which cannot be negative 

NO3 pollution  

The speed of light is c = 3 ⋅ 108 m/s

Prof. Hamid is awesome [6] and Prof. Wang too [7]

This is a sentence with 中文 characters. 

This emoji 👍 means good 

This is a VERY ANGRY text.

This is italics

This is a link 


Challenging for processing / vocalizer 
What is TCACHE in glibc system programming? 
5th gen. iPad
Einstein et al. 1951 

"""
output_file = pathlib.Path("speech.mp3")

# Generate speech
with client.audio.speech.with_streaming_response.create(
    model="gpt-4o-mini-tts",
    voice="alloy",  # you can try "verse", "soft", etc.
    input=text
) as response:
    response.stream_to_file(output_file)

print(f"✅ Speech saved to {output_file}") 

# took 8 seconds