#!/bin/bash
# Docker 디스크 정리 스크립트
# Node1에서 실행하여 불필요한 Docker 리소스 제거

set -e

echo "========================================="
echo "Docker 디스크 정리 시작"
echo "========================================="
echo ""

# 현재 디스크 상태 확인
echo "📊 [정리 전] 디스크 사용량:"
df -h / | tail -1
echo ""

echo "📦 [정리 전] Docker 디스크 사용량:"
docker system df
echo ""

# 1. 중지된 컨테이너 삭제
echo "🗑️  중지된 컨테이너 삭제 중..."
docker container prune -f

# 2. 사용하지 않는 이미지 삭제
echo "🗑️  사용하지 않는 이미지 삭제 중..."
docker image prune -af

# 3. 사용하지 않는 볼륨 삭제
echo "🗑️  사용하지 않는 볼륨 삭제 중..."
docker volume prune -f

# 4. 사용하지 않는 네트워크 삭제
echo "🗑️  사용하지 않는 네트워크 삭제 중..."
docker network prune -f

# 5. 빌드 캐시 삭제
echo "🗑️  빌드 캐시 삭제 중..."
docker builder prune -af

echo ""
echo "========================================="
echo "✅ 정리 완료!"
echo "========================================="
echo ""

# 정리 후 디스크 상태 확인
echo "📊 [정리 후] 디스크 사용량:"
df -h / | tail -1
echo ""

echo "📦 [정리 후] Docker 디스크 사용량:"
docker system df
echo ""

echo "💡 정리 완료! 이제 빌드를 진행하세요."
