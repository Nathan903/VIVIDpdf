from openai import OpenAI


def translate(text, target_lang="chinese", model="gpt-4o-mini"):
    prompt = text#f"Translate this text to {target_lang}:\n{text}"
    response = client.chat.completions.create(
        model=model,  # or "gpt-4o-mini" for cheaper/faster
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content.strip()
import time 
print(translate("format this english properly using subscript and superscript: for June 21st"))
exit()
translation_models = [
    # GPT-5 series (latest, most capable for translation)
    "gpt-5", "gpt-5-pro", "gpt-5-mini", "gpt-5-nano",
    "gpt-5-chat-latest", "gpt-5-pro-2025-10-06", "gpt-5-2025-08-07",
    "gpt-5-mini-2025-08-07", "gpt-5-nano-2025-08-07",
    "gpt-5-codex", "gpt-5-search-api", "gpt-5-search-api-2025-10-14",
    
    # GPT-4.1 and 4o families
    "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
    "gpt-4.1-2025-04-14", "gpt-4.1-mini-2025-04-14", "gpt-4.1-nano-2025-04-14",
    "gpt-4o", "gpt-4o-mini", "gpt-4o-2024-05-13", "gpt-4o-2024-08-06",
    "gpt-4o-2024-11-20", "gpt-4o-mini-2024-07-18",
    "chatgpt-4o-latest", "gpt-4o-turbo", "gpt-4-turbo-preview",
    "gpt-4-turbo", "gpt-4-turbo-2024-04-09",
    "gpt-4-0125-preview", "gpt-4-1106-preview",
    "gpt-4", "gpt-4-0613",
    
    # O-series (reasoning models, still chat-capable)
    # "o1", "o1-mini", "o1-pro", "o3", "o3-mini", "o4-mini",
    # "o1-2024-12-17", "o1-mini-2024-09-12", "o1-pro-2025-03-19",
    # "o3-2025-04-16", "o3-mini-2025-01-31",
    # "o4-mini-2025-04-16", "o4-mini-deep-research", "o4-mini-deep-research-2025-06-26",
    
    # GPT-3.5 family (legacy but usable)
    "gpt-3.5-turbo", "gpt-3.5-turbo-0125",
    "gpt-3.5-turbo-1106", "gpt-3.5-turbo-16k",
    "gpt-3.5-turbo-instruct", "gpt-3.5-turbo-instruct-0914",
    
    # Legacy Codex and Davinci models (can still do translation)
    "davinci-002", "babbage-002", "codex-mini-latest",
]

print(translate("hello","chinese","gpt-3.5-turbo-16k"))
"""
[gpt-5]  time=4.32  你好，你好吗？
[gpt-5-mini]     time=2.46  你好，你好吗？
[gpt-5-nano]     time=4.40  你好，你好吗？ 

（也可说：您好，您怎么样？/ 你好，你最近怎么样？）
[gpt-5-chat-latest]  time=0.51  你好，你好吗？
[gpt-5-2025-08-07]   time=4.38  你好，你好吗？
[gpt-5-mini-2025-08-07]  time=3.28  你好，你好吗？
[gpt-5-nano-2025-08-07]  time=4.62  简体中文：你好，你怎么样？
繁體中文：你好，你怎麼樣？

如果想更口语一点，可以说：你好，最近怎么样？
[gpt-4.1]    time=0.66  你好，你好吗？
[gpt-4.1-mini]   time=0.46  你好，你好吗？
[gpt-4.1-nano]   time=0.47  你好，你好吗？
[gpt-4.1-2025-04-14]     time=0.61  你好，你好吗？
[gpt-4.1-mini-2025-04-14]    time=0.59  你好，你好吗？
[gpt-4.1-nano-2025-04-14]    time=0.46  你好，你好吗？
[gpt-4o]     time=0.58  你好，你好吗？
[gpt-4o-mini]    time=0.45  你好，你好吗？
[gpt-4o-2024-05-13]  time=0.40  你好，你怎么样？
[gpt-4o-2024-08-06]  time=0.58  你好，你怎么样？
[gpt-4o-2024-11-20]  time=0.49  你好，你怎么样？
[gpt-4o-mini-2024-07-18]     time=0.45  你好，你好吗？
[chatgpt-4o-latest]  time=0.47  你好，你怎么样？
[gpt-4-turbo-preview]    time=0.77  你好，你好吗？
[gpt-4-turbo]    time=0.90  你好，你好吗？
[gpt-4-turbo-2024-04-09]     time=0.86  你好，你好吗？
[gpt-4-0125-preview]     time=0.77  你好，你好吗？
[gpt-4-1106-preview]     time=0.80  你好，你好吗？
[gpt-4]  time=0.68  你好，你好吗？
[gpt-4-0613]     time=0.88  你好，你好吗？
[gpt-3.5-turbo]  time=0.47  你好，你好吗？
[gpt-3.5-turbo-0125]     time=0.45  你好，你好吗？
[gpt-3.5-turbo-1106]     time=0.61  你好，你好吗？ (Nǐ hǎo, nǐ hǎo ma?)
[gpt-3.5-turbo-16k]  time=0.39  你好，你好吗？
"""
# for model in translation_models:
#     times = []
#     translations = []
#     for _ in range(10):
#         start_time = time.time()
#         try:
#             translation = translate("Hello, how are you?", "chinese", model=model)
#             translations.append(translation)
#         except Exception as e:
#             translation = f"Error: {e}"
#             translations.append(translation)
#         elapsed_time = time.time() - start_time
#         times.append(elapsed_time)

#     # Remove outliers (e.g., top and bottom 10% of times)
#     times.sort()
#     trimmed_times = times[1:-1]  # Remove the fastest and slowest times
#     average_time = sum(trimmed_times) / len(trimmed_times)

#     if all("Error" not in t for t in translations):
#         print(f"[{model}]\t time={average_time:.2f} \t{translations[0]}")
