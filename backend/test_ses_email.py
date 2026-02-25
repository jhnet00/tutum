"""
AWS SES Email Test Script
Tests basic email sending functionality using boto3
"""

import os
import boto3
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Get AWS credentials from environment
aws_access_key = os.getenv("AWS_ACCESS_KEY_ID")
aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
aws_region = os.getenv("AWS_REGION", "ap-northeast-2")

if not aws_access_key or not aws_secret_key:
    print("❌ Error: AWS credentials not found in .env file")
    print("Please add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to backend/.env")
    exit(1)

# Initialize SES client
ses = boto3.client(
    "ses",
    region_name=aws_region,
    aws_access_key_id=aws_access_key,
    aws_secret_access_key=aws_secret_key,
)

# Send test email
response = ses.send_email(
    Source="clouddx.krb@gmail.com",  # SES에서 검증한 이메일
    Destination={
        "ToAddresses": ["clouddx.krb@gmail.com"]  # 테스트용 동일 주소
    },
    Message={
        "Subject": {"Data": "TUTUM Email Verification Test"},
        "Body": {"Text": {"Data": "This is a test email from TUTUM."}},
    },
)

print("✅ Email sent successfully!")
print(f"Message ID: {response['MessageId']}")
print(f"Response Metadata: {response['ResponseMetadata']}")
