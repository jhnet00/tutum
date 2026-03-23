import os
import json
from google.cloud import vision
from google.api_core import client_options as client_options_lib
from dotenv import load_dotenv
from pathlib import Path

# Mock parts of the app to test workers directly
import sys

sys.path.append(str(Path("backend/app/ocr-api")))
from app.workers.ocr_parser import parse_portfolio_text
from app.workers.ocr_engine import extract_text_from_image_bytes

# Load env from backend/.env
env_path = Path("backend/.env")
load_dotenv(dotenv_path=env_path)


def test_full_pipeline(image_path):
    print(f"Testing OCR Pipeline with: {image_path}")
    if not os.path.exists(image_path):
        print(f"❌ File not found: {image_path}")
        return

    with open(image_path, "rb") as f:
        content = f.read()

    try:
        print("1. Extracting text via Vision API...")
        text = extract_text_from_image_bytes(content)
        print(f"--- Extracted Text ---\n{text}\n----------------------")

        print("2. Parsing text...")
        items = parse_portfolio_text(text)
        print(
            f"--- Parsed Items ---\n{json.dumps(items, indent=2, ensure_ascii=False)}\n--------------------"
        )

        if not items:
            print("⚠️ No items parsed from the image.")
        else:
            print(f"✅ Success! {len(items)} items found.")

    except Exception as e:
        print(f"❌ Pipeline Failed: {e}")


if __name__ == "__main__":
    test_full_pipeline("frontend/public/images/good.png")
