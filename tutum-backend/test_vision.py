import os
from google.cloud import vision
from google.api_core import client_options as client_options_lib
from dotenv import load_dotenv
from pathlib import Path

# Load env
env_path = Path("backend/.env")
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("GOOGLE_API_KEY")
print(f"Testing API Key: {api_key[:5]}...{api_key[-5:] if api_key else 'None'}")

try:
    opts = client_options_lib.ClientOptions(api_key=api_key)
    client = vision.ImageAnnotatorClient(client_options=opts)

    # Empty image to test auth (should return a valid response or specific auth error)
    image = vision.Image(content=b"")
    print("Sending request to Vision API...")
    response = client.text_detection(image=image)

    if response.error.message:
        print(f"❌ Vision API Error: {response.error.message}")
    else:
        print("✅ Auth test successful (Empty image handled)")

except Exception as e:
    print(f"❌ Exception occurred: {e}")
