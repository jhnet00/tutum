# ============================================
# FastAPI Backend Dockerfile
# ============================================
# 
# 운영 환경: Node1에 배포
# Harbor(Node2)에서 이미지 Pull
# ============================================

FROM python:3.11-alpine

WORKDIR /app

# 시스템 의존성 설치
RUN apk add --no-cache gcc musl-dev python3-dev libffi-dev zlib-dev

# Python 의존성 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY . .

# 포트 노출
EXPOSE 8000

# 서버 시작 (운영 환경)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]

