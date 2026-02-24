#!/bin/bash
# Docker 이미지 빌드 → Harbor Push 스크립트 (latest 로컬 유지)
# Node1에서 실행하여 Harbor에 이미지 배포 (빠른 재배포를 위해 latest는 로컬 유지)

set -e

# 설정
HARBOR_REGISTRY="192.168.56.12:8080"
PROJECT="tutum"
TAG="${1:-latest}"  # 첫 번째 인자로 태그 지정, 기본값 latest

# 색상 코드
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "========================================="
echo "Docker 이미지 빌드 & Harbor Push"
echo "========================================="
echo "Registry: $HARBOR_REGISTRY"
echo "Project: $PROJECT"
echo "Tag: $TAG"
echo "========================================="
echo ""

# Git 최신 상태 확인
echo -e "${YELLOW}📥 Git 최신 상태 확인 중...${NC}"
git fetch origin
CURRENT_BRANCH=$(git branch --show-current)
echo "현재 브랜치: $CURRENT_BRANCH"

# 변경사항이 있는지 확인
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}⚠️  경고: 커밋되지 않은 변경사항이 있습니다!${NC}"
    git status --short
    read -p "계속 진행하시겠습니까? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "빌드를 취소합니다."
        exit 1
    fi
fi

echo ""

# 함수: 빌드 → Push → latest 유지
build_push_keep() {
    local SERVICE=$1
    local DOCKERFILE_PATH=$2
    local IMAGE_NAME="$HARBOR_REGISTRY/$PROJECT/$SERVICE:$TAG"

    echo "========================================="
    echo -e "${GREEN}🔨 [$SERVICE] 빌드 시작${NC}"
    echo "========================================="

    # 빌드
    docker build -t "$IMAGE_NAME" "$DOCKERFILE_PATH"

    echo ""
    echo -e "${GREEN}📤 [$SERVICE] Harbor에 Push 중...${NC}"

    # Push
    docker push "$IMAGE_NAME"

    echo ""
    echo -e "${GREEN}💾 [$SERVICE] latest 이미지 로컬 유지 (빠른 재배포용)${NC}"
    echo -e "   로컬 이미지: $IMAGE_NAME"

    echo -e "${GREEN}✅ [$SERVICE] 완료 (빌드 → Push → 로컬 유지)${NC}"
    echo ""
}

# 디스크 상태 확인
echo "📊 [빌드 전] 디스크 사용량:"
df -h / | tail -1
echo ""

# Frontend 빌드
build_push_keep "frontend" "./frontend"

# Backend 빌드
build_push_keep "backend" "./backend"

# Workers 빌드
build_push_keep "workers" "./backend/workers"

# 오래된 이미지 및 빌드 캐시 정리 (latest는 유지)
echo "========================================="
echo -e "${YELLOW}🧹 오래된 이미지 & 빌드 캐시 정리 중...${NC}"
echo "========================================="
echo "💡 latest 태그 이미지는 유지됩니다 (빠른 재배포용)"
echo ""

# dangling/untagged 이미지만 삭제
docker image prune -f

# 빌드 캐시 정리
docker builder prune -f

echo ""
echo "📊 [빌드 후] 디스크 사용량:"
df -h / | tail -1
echo ""

echo "========================================="
echo -e "${GREEN}✅ 모든 이미지 빌드 & Harbor Push 완료!${NC}"
echo "========================================="
echo ""
echo "📦 Harbor 이미지 (백업):"
echo "  - $HARBOR_REGISTRY/$PROJECT/frontend:$TAG"
echo "  - $HARBOR_REGISTRY/$PROJECT/backend:$TAG"
echo "  - $HARBOR_REGISTRY/$PROJECT/workers:$TAG"
echo ""
echo "💾 로컬 이미지 (빠른 재배포용):"
docker images | grep "$HARBOR_REGISTRY/$PROJECT" | grep "$TAG"
echo ""
echo "💡 빠른 재배포 (로컬 이미지 사용):"
echo "   docker compose up -d"
echo ""
echo "💡 다른 노드에서 배포 (Harbor Pull):"
echo "   docker pull $HARBOR_REGISTRY/$PROJECT/{service}:$TAG"
echo "   docker compose up -d"
