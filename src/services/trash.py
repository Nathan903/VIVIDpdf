import base64

def prepare_for_atob(input_string):
    # 1. Convert the string to bytes (UTF-8 is standard)
    message_bytes = input_string.encode('utf-8')
    
    # 2. Encode bytes to Base64 bytes
    base64_bytes = base64.b64encode(message_bytes)
    
    # 3. Decode back to a string for transport/output
    base64_message = base64_bytes.decode('utf-8')
    
    return base64_message

# Example Usage
encoded_output = prepare_for_atob(original_text)

print(f"Original: {original_text}")
print(f"For atob(): {encoded_output}")