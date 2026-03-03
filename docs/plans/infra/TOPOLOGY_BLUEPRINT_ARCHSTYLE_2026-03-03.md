# TUTUM Architecture Blueprint (Arch Style)

> Date: 2026-03-03  
> Style: Same intent as `K8S_MIGRATION_PLAN.md` (architecture-first narrative + diagram-friendly blocks)  
> Scope: `1) On-Prem`, `2) K8s`, `3) AWS Sample`

---

## 0. Shared assumptions

1. Source control / CI-CD / Registry are all GitLab.
2. GitHub is not used.
3. Harbor is excluded from current required architecture.
4. Security policy stack (Kyverno/Cosign) is WIP.
5. Data core is MongoDB + MariaDB + Redis + Kafka + Elasticsearch.
6. MinIO remains for hybrid operations.
7. Archive path is `MinIO -> S3 -> Glacier`.
8. AWS sample assumes self-managed Kubernetes on EC2 (not EKS).

---

## 1) ON-PREM Architecture (AS-IS)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                  1) ON-PREM (AS-IS)                                     │
│                                                                                          │
│  User                                                                                    │
│   │                                                                                      │
│   ▼                                                                                      │
│  [Edge/LB] -> [Frontend: Next.js] -> [Backend: FastAPI]                                 │
│                                │                         │                                │
│                                │                         ├-> MongoDB                      │
│                                │                         ├-> MariaDB                      │
│                                │                         ├-> Redis                        │
│                                │                         ├-> Kafka                        │
│                                │                         └-> MinIO                        │
│                                                                                          │
│  Workers                                                                                 │
│   Price Producer -> Kafka -> Price Consumer -> Redis                                    │
│   News Producer  -> Kafka -> News Consumer -> MongoDB -> Elastic Consumer -> ES/Kibana  │
│   OCR Service -> MinIO                                                                    │
│   Email Worker -> SES/SQS                                                                 │
│                                                                                          │
│  Ops                                                                                     │
│   Jira / Slack / Notion                                                                   │
│                                                                                          │
│  Delivery                                                                                │
│   GitLab Repo -> GitLab CI -> GitLab Registry -> Manifest Repo -> ArgoCD -> Cluster     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 On-Prem drawing points

- Keep user ingress and async worker lanes clearly separated.
- Show Kafka as central async bus.
- Show MariaDB and MongoDB roles separately.
- Keep GitLab delivery lane at the bottom as a dedicated strip.

---

## 2) Kubernetes Architecture (CURRENT)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                               2) KUBERNETES (CURRENT)                                   │
│                                                                                          │
│  Namespaces                                                                              │
│   - tutum-app                                                                            │
│   - tutum-data                                                                           │
│   - tutum-storage                                                                        │
│                                                                                          │
│  tutum-app                                                                               │
│   Ingress/Gateway -> Frontend -> Backend                                                 │
│   Workers:                                                                               │
│     price-producer, price-consumer, news-producer, news-consumer,                       │
│     elastic-consumer, email-worker, ocr                                                  │
│                                                                                          │
│  tutum-data                                                                              │
│   MongoDB StatefulSet                                                                    │
│   Redis StatefulSet                                                                      │
│   Kafka StatefulSet                                                                      │
│   Elasticsearch StatefulSet                                                               │
│   Kibana Deployment                                                                       │
│                                                                                          │
│  tutum-storage                                                                           │
│   MinIO StatefulSet                                                                       │
│                                                                                          │
│  CI/CD + GitOps                                                                          │
│   GitLab Pipeline -> GitLab Registry -> Manifests -> ArgoCD Sync                        │
│                                                                                          │
│  Security                                                                                │
│   Kyverno/Cosign policy layer is WIP                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 K8s traffic lanes

1. User lane: `Ingress -> FE -> BE`
2. Data lane: `BE -> Mongo/Maria/Redis/Kafka/MinIO`
3. Event lane: `Producer -> Kafka -> Consumer -> Cache/DB/ES`
4. Delivery lane: `GitLab -> Registry -> ArgoCD -> Rollout`

### 2.2 K8s security drawing points

- Mark ingress-only public entry.
- Mark deny-by-default intent for direct DB exposure.
- Mark external egress allow-list (KIS, Upbit/Binance, Bedrock, SES/SQS).

---

## 3) AWS Sample Architecture (TO-BE)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                               3) AWS SAMPLE (TO-BE)                                      │
│                                                                                          │
│  Internet                                                                                │
│   │                                                                                      │
│   ▼                                                                                      │
│  Route53 -> ALB(HTTPS + ACM) -> AWS WAF -> K8s Ingress -> Frontend/Backend              │
│                                                                                          │
│  VPC (ap-northeast-2, Multi-AZ)                                                          │
│   Public Subnets: ALB, Bastion(optional)                                                 │
│   Private Subnets: self-managed K8s nodes + data nodes                                   │
│                                                                                          │
│  App/Data                                                                                │
│   Frontend / Backend / Workers                                                            │
│   MongoDB / MariaDB / Redis / Kafka / Elasticsearch / Kibana / MinIO                    │
│                                                                                          │
│  Archive                                                                                 │
│   MinIO -> S3 -> Glacier (lifecycle)                                                      │
│                                                                                          │
│  Delivery                                                                                │
│   GitLab Repo -> GitLab CI -> GitLab Registry -> Manifests -> ArgoCD -> K8s             │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 AWS drawing points

- Explicitly annotate: `No Cloudflare Tunnel`.
- Explicitly annotate: `No EKS in this baseline`.
- Place WAF in front of ingress chain.
- Draw storage lifecycle as a separate right-side branch.

---

## 4. Scenario flow A: Search path

```text
User
 -> Frontend (search input)
 -> Backend (/api/search)
 -> Redis cache lookup
    -> hit: immediate response
    -> miss: DB lookup + external market API + cache set
 -> Frontend render
```

Drawing labels:
- `S-01` user input
- `S-02` FE->BE request
- `S-03` cache lookup
- `S-04` miss branch external fetch
- `S-05` response

---

## 5. Scenario flow B: Write/review path

```text
User
 -> Frontend (submit)
 -> Backend (validate/auth)
 -> Mongo/Maria write
 -> optional event publish (Kafka)
 -> consumer index/update
 -> Frontend refresh
```

Drawing labels:
- `W-01` submit
- `W-02` API write
- `W-03` DB persist
- `W-04` async event
- `W-05` UI refresh

---

## 6. Observability architecture

```text
Metrics: App/K8s -> Prometheus -> Grafana
Traces:  App -> OTel Collector -> Tempo -> Grafana
Logs:    App -> Fluentd -> Elasticsearch -> Kibana/Grafana
Alerts:  Error/Latency/KafkaLag -> Slack/Jira
```

Drawing requirement:
- Keep three horizontal lanes (Metric / Trace / Log).
- Add alert arrows toward Slack/Jira.

---

## 7. CI/CD and GitOps architecture

```text
GitLab Commit/PR
 -> guard
 -> lint/test
 -> scan (sonar/trivy)
 -> build/push (gitlab registry)
 -> sign (cosign, WIP)
 -> manifests update
 -> argocd sync
 -> rolling deploy
 -> slack/jira notify
```

Drawing requirement:
- Show `develop -> staging`, `main -> production` split.
- Show rollback path from previous image tag/manifests.

---

## 8. Final draw review checklist

1. Are On-Prem, K8s, AWS shown as separate stages/pages?
2. Is "GitLab only" clearly visible?
3. Is "MinIO -> S3 -> Glacier" clearly visible?
4. Is "Kyverno/Cosign WIP" clearly marked?
5. Can teammates explain search/write flow from diagram only?

