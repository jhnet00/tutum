import boto3
import os
from dotenv import load_dotenv

load_dotenv("backend/.env")

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-2")

print(f"Listing Bedrock Models in {AWS_REGION}...")

try:
    client = boto3.client(
        "bedrock",
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )

    response = client.list_foundation_models(byProvider="anthropic")

    print("\n[Available Anthropic Models]")
    for model in response["modelSummaries"]:
        # Show model ID and Name
        print(f"- {model['modelId']} ({model.get('modelName')})")

except Exception as e:
    print(f"\n[ERROR] {str(e)}")
