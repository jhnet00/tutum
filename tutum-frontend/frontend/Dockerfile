# ============================================
# Next.js Frontend Dockerfile (Production)
# ============================================
#
# Multi-stage build로 이미지 크기 최소화
# Next.js Standalone 모드 사용
# 운영 환경: Node1에 배포
# Harbor(Node2)에서 이미지 Pull
# ============================================

# Stage 1: 의존성 설치
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Stage 2: 빌드
FROM node:20-alpine AS builder

WORKDIR /app
ARG NEXT_PUBLIC_ADMIN_COST_TAB=false
ENV NEXT_PUBLIC_ADMIN_COST_TAB="${NEXT_PUBLIC_ADMIN_COST_TAB}"
ENV NEXT_PUBLIC_API_URL="/api/proxy"

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Stage 3: 프로덕션 실행
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
