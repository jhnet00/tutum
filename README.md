# TUTUM

TUTUM is an AI-assisted investment support platform that brings portfolio management, real-time market data, personalized news, OCR-based asset registration, and AI-driven insights into one service.

This repository is a GitHub integration point that groups the project's three main services in one place:

- `tutum-backend`
- `tutum-frontend`
- `auth`

## Overview

TUTUM was built to solve a practical problem: investment data is fragmented across multiple services, while portfolio tracking, market monitoring, and related news consumption are often disconnected.

The project combines:

- portfolio and asset management
- real-time market data handling
- personalized news based on owned assets
- OCR-based asset input
- AI chat and insight workflows
- Kubernetes, CI/CD, monitoring, security, backup, and AWS operations

## Repository Structure

```text
tutum/
├─ tutum-backend/     FastAPI backend, workers, data pipeline, k8s manifests, infra docs
├─ tutum-frontend/    Next.js frontend, BFF proxy routes, user/admin UI
└─ auth/              FastAPI auth service, JWT/OAuth/email verification
```

## Main Features

- Asset and portfolio registration and management
- Real-time price lookup and chart-oriented data flow
- Personalized news tied to user holdings
- OCR-based asset upload flow
- AI chat for investment-related questions
- Admin pages for monitoring and operations
- CI/CD, Kubernetes, and AWS-based production operations

## Architecture

### Frontend

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- BFF-style proxy routes such as `/api/proxy` and `/api/public/*`

### Backend

- FastAPI
- APIs for assets, portfolio, market, news, notifications, chat, and admin
- Kafka-based asynchronous processing for news and market data
- OCR and AI integration paths

### Auth

- FastAPI
- JWT / refresh token / CSRF cookie handling
- Google / Kakao / Naver OAuth
- email verification and account-related auth flows

### Data Layer

- MariaDB for users, portfolios, and transaction-oriented relational data
- MongoDB for news source documents and document-style data
- Redis for cache and real-time price lookup
- Kafka for asynchronous event streaming
- Elasticsearch for search, indexing, and RAG-oriented retrieval

## Infra, DevOps, and Operations

This project was not only about application development. A major part of the work focused on infrastructure and operations:

- Docker and Docker Compose-based development environments
- Kubernetes-based service separation and orchestration
- AWS migration and EKS-based deployment
- GitLab CI/CD pipeline design and stabilization
- ArgoCD-based GitOps delivery
- KEDA-based event-driven scaling
- Karpenter and Spot-based cost optimization
- WAF, GuardDuty, CloudTrail, KMS, and Secrets Manager-based security setup
- S3 and RDS-centered backup strategy

## Observability

The project used an LGTM-style observability stack centered around:

- Grafana
- Loki
- Tempo
- Mimir

Operational visibility focused on indicators such as:

- API latency
- error rate
- Kafka lag
- worker health
- data-layer availability

## Data Flow Highlights

### News Pipeline

- Python workers collect news from external sources
- producer sends raw data to Kafka
- MongoDB consumer stores source documents
- Elasticsearch consumer indexes searchable / RAG-usable documents

### Market Data Pipeline

- price producer gathers market data from external feeds
- Kafka topics separate current price and candle-oriented tick flow
- Redis stores fast current-price cache
- candle aggregation logic prepares chart-oriented time series data

## Why This Repository Exists

The original project work was split across multiple repositories and services. This GitHub repository was organized so the full project can be reviewed from one place while still preserving the service boundaries between frontend, backend, and auth.

## Getting Started

Each service should be explored and run from its own directory:

- [tutum-backend](./tutum-backend)
- [tutum-frontend](./tutum-frontend)
- [auth](./auth)

Please refer to the README and environment examples inside each directory for service-specific setup steps.

## Notes

- Running only the frontend is enough for UI shell verification, but interactive features such as login, personalized news, and real-time data require backend and related dependencies.
- The backend depends on external services such as MariaDB, MongoDB, Redis, and in some flows Kafka and Elasticsearch.
- This repository reflects both application code and the operational thinking behind deployment, monitoring, backup, security, and cost optimization.
