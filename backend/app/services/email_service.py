"""
============================================
Email Service (AWS SES)
============================================

Email sending service using AWS SES.
Supports HTML templates for verification emails and marketing newsletters.
"""

import boto3
from botocore.exceptions import ClientError
from app.config import get_settings

settings = get_settings()


class EmailService:
    """
    AWS SES email sending service.

    Handles verification emails, marketing newsletters, and transactional emails.
    """

    def __init__(self):
        """Initialize SES client with AWS credentials from settings."""
        self.client = boto3.client(
            "ses",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )
        self.sender_email = settings.SES_SENDER_EMAIL
        self.sender_name = settings.SES_SENDER_NAME

    async def send_verification_email(
        self, recipient_email: str, verification_token: str
    ) -> dict:
        """
        Send email verification link to user.

        Args:
            recipient_email: User's email address
            verification_token: Verification token (URL-safe)

        Returns:
            dict with 'message_id' and 'status'

        Raises:
            Exception: If email sending fails
        """
        verification_url = (
            f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"
        )

        html_body = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }}
                .container {{
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 10px;
                    padding: 40px;
                    text-align: center;
                }}
                .content {{
                    background: white;
                    border-radius: 8px;
                    padding: 30px;
                    margin-top: 20px;
                }}
                .button {{
                    display: inline-block;
                    padding: 15px 40px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 5px;
                    font-weight: bold;
                    margin: 20px 0;
                }}
                .footer {{
                    margin-top: 30px;
                    font-size: 12px;
                    color: #666;
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <h1 style="color: white; margin: 0;">Welcome to TUTUM! 🎉</h1>
            </div>
            <div class="content">
                <h2>Verify Your Email Address</h2>
                <p>Thank you for registering with TUTUM. Please click the button below to verify your email address and activate your account.</p>
                
                <a href="{verification_url}" class="button">Verify Email Address</a>
                
                <p style="margin-top: 30px; font-size: 14px; color: #666;">
                    This link will expire in <strong>1 hour</strong>. If you didn't create an account with TUTUM, please ignore this email.
                </p>
                
                <div class="footer">
                    <p>If the button doesn't work, copy and paste this link into your browser:</p>
                    <p style="word-break: break-all; color: #667eea;">{verification_url}</p>
                </div>
            </div>
        </body>
        </html>
        """

        text_body = f"""
        Welcome to TUTUM!
        
        Please verify your email address by clicking the link below:
        {verification_url}
        
        This link will expire in 1 hour.
        
        If you didn't create an account with TUTUM, please ignore this email.
        """

        try:
            response = self.client.send_email(
                Source=f"{self.sender_name} <{self.sender_email}>",
                Destination={"ToAddresses": [recipient_email]},
                Message={
                    "Subject": {
                        "Data": "Verify Your TUTUM Account",
                        "Charset": "UTF-8",
                    },
                    "Body": {
                        "Text": {"Data": text_body, "Charset": "UTF-8"},
                        "Html": {"Data": html_body, "Charset": "UTF-8"},
                    },
                },
            )

            return {"message_id": response["MessageId"], "status": "sent"}

        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            raise Exception(f"SES Error [{error_code}]: {error_message}")

    async def send_marketing_email(
        self, recipient_email: str, subject: str, content: str
    ) -> dict:
        """
        Send marketing/newsletter email to user.

        Args:
            recipient_email: User's email address
            subject: Email subject
            content: HTML content

        Returns:
            dict with 'message_id' and 'status'
        """
        try:
            response = self.client.send_email(
                Source=f"{self.sender_name} <{self.sender_email}>",
                Destination={"ToAddresses": [recipient_email]},
                Message={
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {"Html": {"Data": content, "Charset": "UTF-8"}},
                },
            )

            return {"message_id": response["MessageId"], "status": "sent"}

        except ClientError as e:
            raise Exception(f"Failed to send marketing email: {e}")


# Singleton instance
_email_service = None


def get_email_service() -> EmailService:
    """Get or create singleton EmailService instance."""
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service
