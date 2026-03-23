"""
OCR Engine 인증 테스트 스크립트

목적: Google Vision API 인증이 올바르게 설정되었는지 확인
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# 프로젝트 루트를 Python path에 추가
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# .env 파일 로드
env_path = project_root.parent.parent / ".env"
load_dotenv(env_path)

print("=" * 60)
print("Google Vision API 인증 설정 확인")
print("=" * 60)

# 환경변수 확인
api_key = os.getenv("GOOGLE_API_KEY")
sa_credentials = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

print("\n📋 환경변수 상태:")
print(f"  - GOOGLE_API_KEY: {'[OK] 설정됨' if api_key else '[FAIL] 없음'}")
if api_key:
    print(f"    값: {api_key[:20]}...{api_key[-4:]}")

print(
    f"  - GOOGLE_APPLICATION_CREDENTIALS: {'[OK] 설정됨' if sa_credentials else '[FAIL] 없음'}"
)
if sa_credentials:
    print(f"    경로: {sa_credentials}")

print("\n" + "=" * 60)

# 실제 Vision API 클라이언트 생성 테스트
try:
    from app.workers.ocr_engine import _get_vision_client

    print("\n[CONFIG] Vision API 클라이언트 생성 시도...")
    client = _get_vision_client()
    print("[OK] 성공! Vision API 클라이언트가 정상적으로 생성되었습니다.")

    # 인증 방식 확인
    if api_key:
        print("📌 사용된 인증 방식: API Key (권장)")
    elif sa_credentials:
        print("📌 사용된 인증 방식: Service Account JSON")

except Exception as e:
    print(f"[FAIL] 실패: {e}")
    sys.exit(1)

print("\n" + "=" * 60)
print("[OK] 모든 인증 설정이 올바르게 구성되었습니다!")
print("=" * 60)
