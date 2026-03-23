"""
============================================
Queue Service (AWS SQS)
============================================

Message queue service using AWS SQS.
Handles email verification tasks with DLQ for failed messages.
"""

import json
import boto3
from botocore.exceptions import ClientError
from app.config import get_settings

settings = get_settings()


class QueueService:
    """
    AWS SQS queue service for async email processing.

    Enqueues email verification tasks to be processed by worker.
    """

    def __init__(self):
        """Initialize SQS client and ensure queues exist."""
        self.client = boto3.client(
            "sqs",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )

        # Queue URLs (will be set by _ensure_queues)
        self.queue_url = None
        self.dlq_url = None

        # Ensure queues exist
        self._ensure_queues()

    def _ensure_queues(self):
        """Create SQS queues if they don't exist."""
        try:
            # Create DLQ first
            try:
                dlq_response = self.client.create_queue(
                    QueueName=settings.SQS_DLQ_NAME,
                    Attributes={
                        "MessageRetentionPeriod": "1209600"  # 14 days
                    },
                )
                self.dlq_url = dlq_response["QueueUrl"]

                # Get DLQ ARN for redrive policy
                dlq_attrs = self.client.get_queue_attributes(
                    QueueUrl=self.dlq_url, AttributeNames=["QueueArn"]
                )
                dlq_arn = dlq_attrs["Attributes"]["QueueArn"]

            except ClientError as e:
                if e.response["Error"]["Code"] == "QueueAlreadyExists":
                    # Get existing DLQ URL
                    dlq_response = self.client.get_queue_url(
                        QueueName=settings.SQS_DLQ_NAME
                    )
                    self.dlq_url = dlq_response["QueueUrl"]

                    dlq_attrs = self.client.get_queue_attributes(
                        QueueUrl=self.dlq_url, AttributeNames=["QueueArn"]
                    )
                    dlq_arn = dlq_attrs["Attributes"]["QueueArn"]
                else:
                    raise

            # Create main queue with DLQ redrive policy
            try:
                queue_response = self.client.create_queue(
                    QueueName=settings.SQS_QUEUE_NAME,
                    Attributes={
                        "VisibilityTimeout": "300",  # 5 minutes
                        "MessageRetentionPeriod": "345600",  # 4 days
                        "RedrivePolicy": json.dumps(
                            {
                                "deadLetterTargetArn": dlq_arn,
                                "maxReceiveCount": "3",  # Retry 3 times before DLQ
                            }
                        ),
                    },
                )
                self.queue_url = queue_response["QueueUrl"]
                print(f"✅ Created SQS queue: {settings.SQS_QUEUE_NAME}")

            except ClientError as e:
                if e.response["Error"]["Code"] == "QueueAlreadyExists":
                    queue_response = self.client.get_queue_url(
                        QueueName=settings.SQS_QUEUE_NAME
                    )
                    self.queue_url = queue_response["QueueUrl"]
                    print(f"✅ Using existing SQS queue: {settings.SQS_QUEUE_NAME}")
                else:
                    raise

        except ClientError as e:
            print(f"❌ Failed to ensure SQS queues: {e}")
            raise

    async def enqueue_verification_email(
        self, user_email: str, verification_token: str
    ) -> dict:
        """
        Enqueue email verification task to SQS.

        Args:
            user_email: User's email address
            verification_token: Verification token

        Returns:
            dict with 'message_id' and 'status'
        """
        message_body = {
            "task_type": "email_verification",
            "user_email": user_email,
            "verification_token": verification_token,
        }

        try:
            response = self.client.send_message(
                QueueUrl=self.queue_url,
                MessageBody=json.dumps(message_body),
                MessageAttributes={
                    "TaskType": {
                        "StringValue": "email_verification",
                        "DataType": "String",
                    }
                },
            )

            return {"message_id": response["MessageId"], "status": "queued"}

        except ClientError as e:
            raise Exception(f"Failed to enqueue message: {e}")


# Singleton instance
_queue_service = None


def get_queue_service() -> QueueService:
    """Get or create singleton QueueService instance."""
    global _queue_service
    if _queue_service is None:
        _queue_service = QueueService()
    return _queue_service
