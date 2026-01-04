import os
import json
import sys
import re
import base64
from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

MODEL = "gemini-2.5-flash"

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    sys.exit("❌ Error: GEMINI_API_KEY not found!")

client = genai.Client(api_key=api_key)

def is_suspicious_token(text):
    if re.search(r'\d', text): return True
    if re.search(r'[^a-zA-Z0-9.,;:\'"!?\s-]', text): return True
    if '.' in text and len(text) < 4 and text.lower() not in ["the.", "end."]: return True
    return False

@app.route('/refine-script', methods=['POST'])
def refine_script():
    try:
        data = request.json
        all_tokens = data.get('tokens', [])
        image_b64 = data.get('image', None)
        
        if not all_tokens:
            return jsonify({"error": "No tokens"}), 400

        with open("debug_1_raw.json", "w", encoding="utf-8") as f:
            debug_payload = {
                "tokens_count": len(all_tokens),
                "has_image": bool(image_b64),
                "tokens": all_tokens
            }
            json.dump(debug_payload, f, indent=4, ensure_ascii=False)
        print("💾 Saved: debug_1_raw.json")


        # ==========================================
        # 1: samrt filtering
        # ==========================================
        sentences_groups = []
        current_group = []
        for token in all_tokens:
            current_group.append(token)
            text = token['text']
            if text.endswith('.') or text.endswith('?') or text.endswith('!'):
                sentences_groups.append(current_group)
                current_group = []
        if current_group: sentences_groups.append(current_group)

        filtered_payload = []
        for group in sentences_groups:
            has_suspicious = any(is_suspicious_token(t['text']) for t in group)
            if has_suspicious:
                filtered_payload.extend(group)

        if len(filtered_payload) == 0:
            return jsonify({"refinedTokens": []})

        # ==========================================
        # [DEBUG 2] save filtered data for AI use 
        # ==========================================
        with open("debug_2_filtered.json", "w", encoding="utf-8") as f:
            json.dump(filtered_payload, f, indent=4, ensure_ascii=False)
        print(f"💾 Saved: debug_2_filtered.json (Reduced {len(all_tokens)} -> {len(filtered_payload)})")


        # ==========================================
        #  2: prepare request to AI (Vision + Text)
        # ==========================================
        print(f"⚡ Analyzing {len(filtered_payload)} tokens with Image...")
        contents_parts = []
        
        prompt_text = """
        You are a Multimodal TTS script optimizer.
        I am providing you with:
        1. An IMAGE of a PDF page (visual ground truth).
        2. A subset of EXTRACTED SENTENCES (JSON) that likely contain OCR errors or formulas.
        
        YOUR TASK:
        Look at the IMAGE to interpret formulas like "g1x2" (g of x) or "x3" (x cubed).
        Return a JSON list: { "id": "...", "spokenText": "..." }.
        ONLY return tokens that need changing. Do not return normal words.
        
        Input Tokens:
        """ + json.dumps(filtered_payload)
        
        contents_parts.append(types.Part.from_text(text=prompt_text))

        if image_b64:
            try:
                image_bytes = base64.b64decode(image_b64)
                contents_parts.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
            except Exception as e:
                print(f"⚠️ Image decode failed: {e}")

        # send request
        response = client.models.generate_content(
            model=MODEL,
            contents=[types.Content(role="user", parts=contents_parts)],
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        
        refined_data = json.loads(response.text)
        if isinstance(refined_data, dict) and 'tokens' in refined_data:
            refined_data = refined_data['tokens']

        # ==========================================
        # [DEBUG 3] save AI response
        # ==========================================
        with open("debug_3_response.json", "w", encoding="utf-8") as f:
            json.dump(refined_data, f, indent=4, ensure_ascii=False)
        print("💾 Saved: debug_3_response.json")
            
        return jsonify({"refinedTokens": refined_data})

    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("🚀 Server starting (Vision + Text + Debug Logs)...")
    app.run(port=5000, debug=True)