import boto3
import os
from dotenv import load_dotenv
from pathlib import Path

# Load .env
env_path = Path("backend/.env")
load_dotenv(dotenv_path=env_path)


def diag_bedrock():
    region = os.getenv("AWS_REGION", "ap-northeast-2")
    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    model_id = os.getenv(
        "BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20240620-v1:0"
    )

    print(f"--- Bedrock Diagnostics ---")
    print(f"Region: {region}")
    print(f"Model ID: {model_id}")
    print(f"Access Key: {access_key[:5]}...{access_key[-5:] if access_key else 'None'}")
    print(f"Secret Key: {'Set' if secret_key else 'None'}")

    if not access_key or not secret_key:
        print("❌ AWS Keys are missing in .env!")
        return

    try:
        client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        print("✅ Bedrock Runtime Client Initialized.")

        # Try a simple validation (listing models or dummy invoke)
        # Note: listing models requires different client ('bedrock' not 'bedrock-runtime')
        print("Testing model availability...")
        control_client = boto3.client(
            "bedrock",
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        models = control_client.list_foundation_models(byOutputModality="TEXT")
        found = False
        for m in models.get("modelSummaries", []):
            if "claude" in m.get("modelId", "").lower():
                print(f"Found Claude Model: {m.get('modelId')}")
                found = True

        if not found:
            print(
                "❌ No Claude models found in this region. Check if you have granted access in the AWS Console."
            )
        else:
            print("✅ Claude models are available.")

    except Exception as e:
        print(f"❌ Connection Failed: {e}")


if __name__ == "__main__":
    diag_bedrock()
