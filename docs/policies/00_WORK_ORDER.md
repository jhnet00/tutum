# Work Order (Follow Top → Bottom)

## Phase 0: Project Bootstrap (Day 0~1)

1. Create Jira project, issue types: Epic / Task / Subtask only
2. Create GitHub repos (app + infra)
3. Connect Jira ↔ GitHub (Smart commits optional) + Slack notifications (optional)
4. Apply branch protection rules (main protected, PR required)

## Phase 1: Jira Backlog Register (Day 1)

- Copy from docs/06_JIRA_BACKLOG.md into Jira
- Assign owners per docs/07_TEAM_ROLES.md
- Confirm MVP scope in docs/01_PRODUCT_SCOPE.md

## Phase 2: App Repo Skeleton (Day 1~2)

- Follow docs/05_DEV_WORKFLOW_GITHUB_JIRA.md (branch/commit/PR conventions)
- Setup:
  - Next.js app skeleton + routing placeholders
  - FastAPI skeleton placeholders (no heavy features yet)
  - docker-compose local bootstrap (postgres/redis placeholders)

## Phase 3: UI MVP - Main Page (Day 2~5)

- Implement based on docs/02_UI_SPEC_MAINPAGE.md
- Enforce "Not logged-in" gating:
  - Top menu minimal
  - Quick menu panels open but protected actions redirect to /login
  - Profile dropdown shows login CTA only

## Phase 4: Connected Pages (Day 5~7)

- Create pages with minimal UI based on docs/03_PAGES_SPEC.md:
  - /login
  - /coin/[symbol]
  - /portfolio
- Use reference styling (Toss/Kraken/TradingView) but keep MVP minimal.

## Phase 5: Real-time Data Integration (Day 7~10)

- Follow docs/04_ARCHITECTURE_FINAL.md
- Implement market-data ingestion + redis cache + ws-gateway broadcast
- Main page SSR should read from cached latest (not direct Binance WS per request)
- Client live updates via WebSocket

## Phase 6: Hardening & Demo Readiness (Day 10~14)

- Add basic metrics endpoints + health checks
- Add simple E2E demo script:
  - open main page
  - show real-time ticker updates
  - click coin -> detail page
  - heart -> watchlist
  - try protected menu -> redirect to login

## Phase 7: GitOps/Infra (Parallel track)

- Infra repo: Terraform -> EKS/RDS/Redis/SQS/ECR (can be staged)
- App repo: CI -> ECR build/push
- CD -> Argo CD sync from infra repo
