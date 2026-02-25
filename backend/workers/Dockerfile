# ============================================
# Kafka Workers Dockerfile
# ============================================
# 
# 운영 환경: Node3에 배포
# Producer 2개, Consumer 3개 실행
# ============================================

FROM python:3.11-slim

WORKDIR /app

# 시스템 의존성
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드
COPY . .

# 기본 명령 (컨테이너 실행 시 오버라이드)
CMD ["python", "-u", "price_producer.py"]
