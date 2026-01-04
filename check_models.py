import os
import sys
from dotenv import load_dotenv
from google import genai

# 加载 .env
load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    print("❌ Error: 没有找到 API Key")
    sys.exit(1)

print(f"🔑 Key loaded... Connecting to Google...")

try:
    client = genai.Client(api_key=api_key)
    
    print("\n👇 请从下面的列表中复制一个以 'gemini' 开头的名称 👇")
    print("=" * 50)
    
    # 直接遍历并打印 name，不加任何过滤条件，防止报错
    for m in client.models.list():
        # 有些 SDK 版本属性是 .name，有些是字典，这里做个容错
        model_name = getattr(m, 'name', None)
        if not model_name:
            model_name = str(m) # 实在不行直接转字符串
            
        # 只打印 gemini 系列，减少干扰
        if "gemini" in str(model_name).lower():
            # 去掉 'models/' 前缀（如果存在），只保留纯名称
            clean_name = str(model_name).replace("models/", "")
            print(f"✅ {clean_name}")

    print("=" * 50)
    print("👆 选一个上面列出的名称（推荐带 flash 的），填入 server.py 的 MODEL 变量中")

except Exception as e:
    print(f"\n❌ 依然报错: {e}")