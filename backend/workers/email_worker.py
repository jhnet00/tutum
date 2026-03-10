"""
============================================
Email Worker (SQS Consumer)
============================================

Background worker that processes email verification tasks from SQS queue.
Runs as a separate process/service.

Usage:
    python workers/email_worker.py
"""

import asyncio
import json
import signal
import sys
import os
import boto3
from botocore.exceptions import ClientError

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.config import get_settings  # noqa: E402
from app.services.email_service import get_email_service  # noqa: E402

settings = get_settings()
email_service = get_email_service()

# Graceful shutdown flag
shutdown_requested = False


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    global shutdown_requested
    print(f"\n⚠️  Received signal {signum}. Shutting down gracefully...")
    shutdown_requested = True


# Register signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


async def process_message(message: dict) -> bool:
    """
    Process a single SQS message.

    Args:
        message: SQS message dict

    Returns:
        True if processed successfully, False otherwise
    """
    try:
        # Parse message body
        body = json.loads(message["Body"])
        task_type = body.get("task_type")

        if task_type == "email_verification":
            user_email = body["user_email"]
            verification_token = body["verification_token"]

            print(f"📧 Sending verification email to {user_email}...")

            # Send email via SES
            result = await email_service.send_verification_email(
                recipient_email=user_email, verification_token=verification_token
            )

            print(f"✅ Email sent successfully! Message ID: {result['message_id']}")
            return True

        else:
            print(f"⚠️  Unknown task type: {task_type}")
            return False

    except Exception as e:
        error_str = str(e)
        if (
            "MessageRejected" in error_str
            and "Email address is not verified" in error_str
        ):
            print(
                f"⚠️  SES Sandbox Restriction: Identity {user_email} is not verified in AWS SES. "
                "Please verify the email address in AWS Console to send emails in Sandbox mode."
            )
            # In Sandbox mode, we'll treat this as 'processed' so it doesn't stay in the queue
            # but we show a clear warning.
            return True

        print(f"❌ Error processing message: {e}")
        return False


async def poll_queue():
    """
    Main worker loop - polls SQS queue and processes messages.
    """
    # Initialize SQS client
    sqs = boto3.client(
        "sqs",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )

    # Get queue URL
    try:
        queue_response = sqs.get_queue_url(QueueName=settings.SQS_QUEUE_NAME)
        queue_url = queue_response["QueueUrl"]
        print(f"✅ Connected to SQS queue: {settings.SQS_QUEUE_NAME}")
    except ClientError as e:
        print(f"❌ Failed to get queue URL: {e}")
        return

    print("🔄 Starting email worker... (Press Ctrl+C to stop)")

    while not shutdown_requested:
        try:
            # Long polling (wait up to 20 seconds for messages)
            response = sqs.receive_message(
                QueueUrl=queue_url,
                MaxNumberOfMessages=1,  # Process one at a time
                WaitTimeSeconds=20,  # Long polling
                MessageAttributeNames=["All"],
            )

            messages = response.get("Messages", [])

            if not messages:
                # No messages, continue polling
                continue

            for message in messages:
                # Process message
                success = await process_message(message)

                if success:
                    # Delete message from queue (acknowledge)
                    sqs.delete_message(
                        QueueUrl=queue_url, ReceiptHandle=message["ReceiptHandle"]
                    )
                    print("🗑️  Message deleted from queue")
                else:
                    # Message will be retried or moved to DLQ
                    print("⚠️  Message processing failed, will retry or move to DLQ")

        except ClientError as e:
            print(f"❌ SQS error: {e}")
            await asyncio.sleep(5)  # Wait before retrying

        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            await asyncio.sleep(5)

    print("👋 Email worker stopped.")


if __name__ == "__main__":
    print("=" * 50)
    print("TUTUM Email Worker")
    print("=" * 50)

    # Run async event loop
    asyncio.run(poll_queue())
