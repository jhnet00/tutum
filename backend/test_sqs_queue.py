"""
AWS SQS Queue Test Script
Tests message enqueue to tutum-email-verify-queue
"""

import boto3
import os
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# AWS Configuration
REGION = os.getenv("AWS_REGION", "ap-northeast-2")
AWS_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")

# SQS Queue URL (전체 URL 직접 지정)
QUEUE_URL = (
    "https://sqs.ap-northeast-2.amazonaws.com/903913341620/tutum-email-verify-queue"
)

# Initialize SQS client
sqs = boto3.client(
    "sqs",
    region_name=REGION,
    aws_access_key_id=AWS_ACCESS_KEY,
    aws_secret_access_key=AWS_SECRET_KEY,
)

# Send test message
try:
    response = sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps(
            {
                "task_type": "email_verification",
                "user_email": "clouddx.krb@gmail.com",
                "verification_token": "test-token-12345",
            }
        ),
    )

    print("✅ Message sent successfully!")
    print(f"📧 Message ID: {response['MessageId']}")
    print(f"🔗 Queue URL: {QUEUE_URL}")

    # Check queue attributes
    attrs = sqs.get_queue_attributes(
        QueueUrl=QUEUE_URL, AttributeNames=["ApproximateNumberOfMessages"]
    )

    print(f"📊 Messages in queue: {attrs['Attributes']['ApproximateNumberOfMessages']}")

except Exception as e:
    print(f"❌ Error sending message: {e}")
