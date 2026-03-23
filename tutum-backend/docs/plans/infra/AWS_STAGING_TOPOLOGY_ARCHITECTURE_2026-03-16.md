# TUTUM AWS Staging 토폴로지 아키텍처

- 작성일: `2026-03-16`
- 범위: `ap-northeast-2` 리전에 실제로 운영 중인 staging 인프라
- 목적: 현재 AWS 토폴로지, 실사용 기술 스택, 그리고 `draw.io`나 발표 자료에 바로 옮길 수 있는 아키텍처 설계도를 정리

---

## 1. 요약

`2026-03-16` 기준 TUTUM staging은 프라이빗 서브넷 중심의 AWS 아키텍처로 운영되고 있습니다.

- 인터넷 트래픽은 `Route53 -> ACM -> WAF -> ALB` 경로로 유입됩니다.
- 핵심 애플리케이션 워크로드는 `EKS (tutum-stg-eks)` 위에서 동작합니다.
- 애플리케이션 계층은 `Next.js + FastAPI + Auth FastAPI + OCR + Kafka workers`로 구성됩니다.
- 데이터 계층은 대부분 클러스터 내부에 있으며 `MongoDB ReplicaSet`, `Redis`, `Kafka`, `Elasticsearch`를 사용합니다.
- 계정 및 포트폴리오 같은 관계형 데이터는 `RDS MariaDB (tutum-mariadb)`를 사용합니다.
- AI는 `Amazon Bedrock Claude Sonnet 4.6`과 `Titan Embed v2`를 사용합니다.
- 관측 시스템은 이중 구조입니다.
  - 클러스터 내부 수집기와 익스포터: `Grafana Alloy`, `node-exporter`, `kafka-exporter`, `redis-exporter`, `elasticsearch-exporter`
  - 외부 모니터링 VM: `tutum-monitoring`의 `Grafana / Loki / Tempo / Mimir`
- `SonarQube`는 클러스터 내부 파드로 동작하지 않고, 현재는 ALB를 통해 프라이빗 모니터링 EC2 경로를 바라봅니다.
- 객체 저장소와 백업은 `S3 tutum-prod-storage`를 사용합니다.

즉, 이 구조는 "모든 것이 EKS 안에 있다"라고 그리면 안 되고, 실제 모습은 아래처럼 이해하는 것이 맞습니다.

1. 엣지와 보안은 AWS 관리형 서비스
2. 앱과 데이터는 대부분 EKS 내부
3. 모니터링과 Sonar는 일부 별도 EC2
4. AI, 시크릿, 스토리지, 레지스트리, 메일, DB는 외부 관리형 서비스

---

## 2. AWS 리소스 인벤토리

## 2-1. 네트워크와 엣지

| 구분 | 현재 리소스 | 값 / 이름 | 비고 |
|---|---|---|---|
| 리전 | AWS Region | `ap-northeast-2` | 서울 |
| VPC | VPC | `tutum-eks-stg-vpc` | CIDR `10.60.0.0/16` |
| Public subnet A | Subnet | `10.60.1.0/24` | `ap-northeast-2a` |
| Public subnet C | Subnet | `10.60.2.0/24` | `ap-northeast-2c` |
| Private subnet A | Subnet | `10.60.11.0/24` | `ap-northeast-2a` |
| Private subnet C | Subnet | `10.60.12.0/24` | `ap-northeast-2c` |
| 인터넷 아웃바운드 | NAT Gateway | `nat-02d4de6a0d9b1cd72` | Public subnet A에 1개 |
| 인터넷 인바운드 | ALB | `k8s-tutumstg-522ae53287` | internet-facing |
| DNS | Route53 Hosted Zone | `tutum.my` | public hosted zone |
| TLS | ACM certificate | `*.tutum.my`, `tutum.my` | 상태 `ISSUED` |
| 엣지 보호 | WAF | `tutum-stg-waf` | ALB에 연결 |

## 2-2. VPC 엔드포인트

| 타입 | 서비스 |
|---|---|
| Gateway | `S3` |
| Interface | `ECR API` |
| Interface | `ECR DKR` |
| Interface | `STS` |
| Interface | `Secrets Manager` |
| Interface | `GuardDuty data` |

## 2-3. 컴퓨트와 플랫폼

| 구분 | 현재 리소스 | 값 / 이름 | 비고 |
|---|---|---|---|
| Kubernetes | EKS cluster | `tutum-stg-eks` | version `1.35` |
| Service CIDR | EKS networking | `172.20.0.0/16` | cluster service CIDR |
| Worker OS | EKS nodes | `Bottlerocket` | EKS Auto Mode 관리 노드 |
| 현재 워커 수 | Node count | `11` | 캡처 시점 기준 |
| NodePool | `system` | `1` node | control/platform workloads |
| NodePool | `private-system` | `1` node | platform workloads |
| NodePool | `private-app` | `2` nodes | app workloads |
| NodePool | `private-ci` | `1` node | CI workloads |
| NodePool | `private-data` | `6` nodes | data workloads |
| NodePool | `general-purpose` | `0` nodes | 구성은 되어 있으나 현재 미사용 |
| Monitoring VM | EC2 | `tutum-monitoring` | `m5.large`, private IP `10.60.11.95` |

## 2-4. 관리형 서비스

| 구분 | 현재 리소스 | 값 / 이름 | 비고 |
|---|---|---|---|
| 레지스트리 | ECR | `tutum/frontend`, `tutum/backend`, `tutum/auth`, `tutum/workers` | public/utility repo 일부도 mirror 또는 pull |
| 관계형 DB | RDS MariaDB | `tutum-mariadb` | `db.t3.micro`, `Multi-AZ`, private, `10.11.15` |
| 시크릿 | Secrets Manager | active | External Secrets로 클러스터 동기화 |
| 객체 저장소 | S3 | `tutum-prod-storage` | 앱 파일 및 백업 |
| AI 런타임 | Bedrock | `global.anthropic.claude-sonnet-4-6` | 채팅 / admin 분석 |
| 임베딩 | Bedrock | `amazon.titan-embed-text-v2:0` | ES 벡터 검색 |
| 메일 | SES | active in backend | 인증 메일 / email worker |

---

## 3. 현재 공개 진입점

| 도메인 / 경로 | 실제 대상 | 목적 |
|---|---|---|
| `https://tutum.my/` | ALB -> app ingress -> frontend | 메인 서비스 |
| `https://tutum.my/api/proxy/*` | frontend internal proxy -> backend/auth/ocr | API 중계 |
| `https://kiali.tutum.my/kiali/` | ALB host rule -> Kiali | 서비스 메시 가시화 |
| `https://sonar.tutum.my/` | ALB host rule -> monitoring EC2의 외부 Sonar target | 품질 대시보드 |

참고:

- `sonar.tutum.my`는 운영상 staging 일부이지만, 아키텍처적으로는 메인 앱 경로와 다릅니다.
- 일반적인 in-cluster SonarQube 배포 경로로 보면 안 됩니다.

---

## 4. 실제로 동작 중인 Kubernetes 워크로드

## 4-1. 플랫폼 네임스페이스

| Namespace | 주요 컴포넌트 |
|---|---|
| `argocd` | ArgoCD server, repo server, application controller, notifications, redis, dex |
| `external-secrets` | External Secrets operator, webhook, cert controller |
| `keda` | KEDA operator, admission webhook, metrics apiserver |
| `istio-system` | `istiod`, `kiali` |
| `kyverno` | admission, background, cleanup, reports |
| `gitlab-runner` | GitLab Runner |
| `amazon-guardduty` | GuardDuty agent daemonset |
| `monitoring` | Alloy daemonset, node-exporter daemonset |

## 4-2. 앱 네임스페이스

Namespace: `tutum-app`

| 워크로드 | Replica 수 | 역할 |
|---|---|---|
| `frontend` | `2` | Next.js UI, proxy 진입점 |
| `backend` | `2` | 메인 FastAPI API |
| `auth` | `2` | 인증 FastAPI 서비스 |
| `ocr` | `1` | OCR API 서비스 |
| `news-producer` | `1` | 뉴스 크롤링 및 Kafka 적재 |
| `news-consumer` | `2` | Kafka 뉴스 -> MongoDB 저장 |
| `elastic-consumer` | `1` | 뉴스 -> Elasticsearch 인덱싱 |
| `price-producer` | `1` | 시세 feed producer |
| `price-consumer` | `2` | 시세 feed consumer |
| `email-worker` | `1` | 메일 작업 처리 |
| `cloudflared` | `0` | 현재 비활성, active topology 아님 |

## 4-3. 데이터 네임스페이스

Namespace: `tutum-data`

| 워크로드 | Replica 수 | 역할 |
|---|---|---|
| `mongodb` | `3` | 문서 DB, replica set |
| `redis` | `3` | cache / session / realtime state |
| `kafka` | `3` | event bus, KRaft mode |
| `elasticsearch` | `1` | 뉴스 검색 / RAG 조회 |

## 4-4. 오토스케일링과 트래픽 제어

| 컴포넌트 | 현재 사용 방식 |
|---|---|
| AWS Load Balancer Controller | K8s ingress로부터 ALB 생성 |
| Istio | ingress gateway, virtual service, mesh policy |
| Kiali | mesh 시각화 |
| KEDA | `frontend`, `backend`, `news-consumer`, `price-consumer`, `elastic-consumer` 오토스케일 |
| External Secrets | AWS Secrets Manager 시크릿 동기화 |
| ArgoCD | GitOps 배포 |
| Kyverno | 클러스터 정책 강제 |

---

## 5. 기술 스택 요약

## 5-1. 엣지 / 네트워크

- `Route53`
- `ACM`
- `AWS WAF`
- `Application Load Balancer`
- `AWS Load Balancer Controller`
- `Istio Gateway / VirtualService`
- `NAT Gateway`
- `VPC Endpoints`

## 5-2. 애플리케이션 계층

- `Frontend`: `Next.js`
- `Backend API`: `FastAPI`
- `Auth service`: `FastAPI`
- `OCR service`: dedicated OCR API
- `Workers`: `news`, `price`, `elastic`, `email`

## 5-3. 데이터 계층

- `MongoDB ReplicaSet`
- `Redis StatefulSet`
- `Kafka KRaft cluster`
- `Elasticsearch`
- `RDS MariaDB`
- `S3`

## 5-4. AI / 검색 계층

- `Amazon Bedrock Claude Sonnet 4.6`
- `Amazon Titan Embed Text v2`
- `Elasticsearch BM25 + vector search`
- `MongoDB + Elasticsearch` 기반 RAG 컨텍스트

## 5-5. 관측 / 운영

- `Grafana Alloy`
- `Prometheus node-exporter`
- `redis-exporter`
- `kafka-exporter`
- `elasticsearch-exporter`
- monitoring EC2의 외부 `Grafana / Loki / Tempo / Mimir`
- `Kiali`

## 5-6. CI/CD / 보안 / 거버넌스

- `GitLab CI/CD`
- `GitLab Runner`
- `ECR`
- `ArgoCD`
- `External Secrets Operator`
- `Kyverno`
- `GuardDuty`
- `Secrets Manager`

## 5-7. AWS 외부 연동

- OCR용 `Google Cloud Vision API`
- 주식 시세용 `KIS API`
- 코인 시세용 `Upbit API`
- `Google / Kakao / Naver OAuth`
- 메일 발송용 `SES`

---

## 6. 핵심 런타임 흐름

## 6-1. 사용자 웹 요청 흐름

1. 사용자가 `tutum.my`에 접속
2. `Route53`가 public ALB로 해석
3. `WAF`가 트래픽 필터링
4. `ALB`가 app ingress로 전달
5. `Istio`가 `frontend`로 라우팅
6. `frontend`가 `backend`, `auth`, `ocr`로 API 프록시

## 6-2. 뉴스 및 AI 흐름

1. `news-producer`가 금융/코인 뉴스를 수집
2. 메시지가 `Kafka`로 전달
3. `news-consumer`가 구조화된 문서를 `MongoDB`에 저장
4. `elastic-consumer`가 ES 문서와 Bedrock 임베딩 생성
5. 사용자가 AI 질문
6. `backend`가 `Elasticsearch`에서 BM25 + vector search 수행
7. `backend`가 grounding된 프롬프트를 `Bedrock Claude`로 전달
8. 응답이 frontend chat/admin AI로 반환

## 6-3. OCR 흐름

1. 사용자가 frontend를 통해 이미지 업로드
2. frontend가 `/api/proxy/import/*`를 `ocr`로 프록시
3. OCR 서비스가 파일을 `S3 tutum-prod-storage`에 저장
4. OCR 서비스가 `Google Cloud Vision API` 호출
5. 파싱된 자산 정보가 frontend/backend 흐름으로 반환

## 6-4. 모니터링 흐름

1. 클러스터의 pod/node가 metrics, logs, traces 생성
2. `Alloy`와 exporters가 클러스터 내부 telemetry 수집
3. 수집된 telemetry가 monitoring EC2로 전송
4. `Grafana / Loki / Tempo / Mimir`가 대시보드와 조회 API 제공
5. admin 페이지가 요약된 모니터링 데이터와 AI 진단 결과를 소비

---

## 7. 아키텍처 다이어그램 (Mermaid)

아래 Mermaid는 GitHub Markdown, Mermaid Live, draw.io 설계 초안에 바로 붙여서 사용할 수 있습니다.

```mermaid
flowchart LR
    User["사용자 / 운영자"]
    DNS["Route53<br/>tutum.my"]
    WAF["AWS WAF<br/>tutum-stg-waf"]
    ACM["ACM<br/>*.tutum.my"]
    GVision["Google Cloud Vision API"]
    KIS["KIS API"]
    Upbit["Upbit API"]
    OAuth["Google / Kakao / Naver OAuth"]

    User --> DNS
    DNS --> ALB
    WAF -. 연결 .- ALB
    ACM -. TLS 인증서 .- ALB

    subgraph AWS["AWS ap-northeast-2"]
        subgraph VPC["VPC 10.60.0.0/16 (tutum-eks-stg-vpc)"]
            subgraph Public["Public subnets (10.60.1.0/24, 10.60.2.0/24)"]
                ALB["Public ALB<br/>k8s-tutumstg-522ae53287"]
                NAT["NAT Gateway"]
            end

            subgraph Private["Private subnets (10.60.11.0/24, 10.60.12.0/24)"]
                subgraph EKS["EKS tutum-stg-eks (v1.35)"]
                    LBC["AWS Load Balancer Controller"]
                    ISTIO["Istio Gateway / VirtualService"]
                    FE["Frontend<br/>Next.js"]
                    BE["Backend<br/>FastAPI"]
                    AUTH["Auth<br/>FastAPI"]
                    OCR["OCR API"]
                    WORKERS["Workers<br/>news / price / email / elastic"]
                    MONGO["MongoDB RS x3"]
                    REDIS["Redis x3"]
                    KAFKA["Kafka x3 (KRaft)"]
                    ES["Elasticsearch x1"]
                    ARGO["ArgoCD"]
                    ESO["External Secrets"]
                    KEDA["KEDA"]
                    KIALI["Kiali"]
                    ALLOY["Alloy + exporters"]
                    GD["GuardDuty agent"]
                end

                MON["EC2 tutum-monitoring<br/>Grafana / Loki / Tempo / Mimir<br/>Sonar target :9000"]
                RDS["RDS MariaDB<br/>tutum-mariadb<br/>Multi-AZ"]
            end

            VPCE["VPC Endpoints<br/>S3 / ECR API / ECR DKR / STS /<br/>Secrets Manager / GuardDuty"]
        end

        ECR["ECR<br/>tutum/frontend<br/>tutum/backend<br/>tutum/auth<br/>tutum/workers"]
        S3["S3 tutum-prod-storage<br/>ocr-images / profile-images / backups"]
        SM["Secrets Manager"]
        BEDROCK["Amazon Bedrock<br/>Claude Sonnet 4.6<br/>Titan Embed v2"]
        SES["Amazon SES"]
    end

    ALB --> LBC --> ISTIO
    ISTIO --> FE
    ISTIO --> BE
    ALB -->|kiali.tutum.my| KIALI
    ALB -->|sonar.tutum.my| MON

    FE -->|/api/proxy| BE
    FE -->|auth proxy| AUTH
    FE -->|OCR upload| OCR

    BE --> MONGO
    BE --> REDIS
    BE --> KAFKA
    BE --> ES
    BE --> RDS
    BE --> BEDROCK
    BE --> S3
    BE --> SES
    BE --> KIS
    BE --> Upbit
    BE --> OAuth

    WORKERS --> KAFKA
    WORKERS --> MONGO
    WORKERS --> ES
    OCR --> S3
    OCR --> GVision

    ESO --> SM
    ARGO --> EKS
    EKS --> ECR
    EKS --> VPCE
    ALLOY --> MON
```

---

## 8. Draw.io 배치 가이드

슬라이드형 AWS 아키텍처 이미지로 다시 그릴 때는 아래처럼 배치하면 가장 보기 좋습니다.

## 8-1. 최상단

- 왼쪽: `사용자 / 운영자`
- 중앙: `Route53`, `ACM`, `WAF`
- 그 아래: `Public ALB`

## 8-2. 바깥 박스

- 가장 큰 바깥 박스: `AWS Cloud / ap-northeast-2`
- 그 안에 VPC 박스 하나: `10.60.0.0/16`

## 8-3. VPC 분리

- 위쪽 영역: public subnet
  - `ALB`
  - `NAT Gateway`
- 아래쪽 영역: private subnet
  - 좌중앙: `EKS Cluster`
  - 우중앙: `RDS MariaDB`
  - 우하단: `Monitoring EC2`
  - VPC 오른쪽 가장자리: `VPC Endpoints`

## 8-4. EKS 내부 블록

EKS 박스 안은 4개 그룹으로 나누는 것이 좋습니다.

1. `Platform`
   - ArgoCD
   - External Secrets
   - KEDA
   - Istio
   - Kiali
   - GuardDuty agent

2. `App`
   - frontend
   - backend
   - auth
   - ocr
   - workers

3. `Data`
   - MongoDB
   - Redis
   - Kafka
   - Elasticsearch

4. `Observability`
   - Alloy
   - exporters

## 8-5. AWS 관리형 서비스는 오른쪽

VPC 바깥, AWS 리전 박스 안에 아래를 배치합니다.

- `ECR`
- `S3 tutum-prod-storage`
- `Secrets Manager`
- `Bedrock`
- `SES`

## 8-6. AWS 외부 서비스는 맨 오른쪽

AWS 박스 바깥에는 아래를 둡니다.

- `Google Cloud Vision API`
- `KIS API`
- `Upbit API`
- `Google / Kakao / Naver OAuth`

---

## 9. 현재 상태와 레거시를 구분해서 그릴 것

현재 상태로 표시해야 하는 것:

- EKS app/data workloads
- RDS MariaDB
- S3 객체 저장소 및 백업
- monitoring EC2
- Sonar 외부 target 경로
- Bedrock AI 경로

메인 "현재 상태" 다이어그램에 넣지 않거나, 반드시 legacy로 라벨링해야 하는 것:

- 예전 on-prem MinIO
- 구 외부 MariaDB `211.46.52.153:15432`
- 비활성 `cloudflared`
- 예전 VM 기반 앱 노드

---

## 10. 발표 자료용 캡션 추천 문구

다이어그램 아래에는 아래 문장을 쓰면 자연스럽습니다.

> TUTUM staging은 EKS를 중심으로 한 private-subnet 우선 AWS 아키텍처를 사용하며, 엣지/보안은 관리형 서비스, 데이터 서비스는 대부분 in-cluster, 관계형 데이터는 RDS MariaDB, 객체 저장소는 S3, AI는 Bedrock, 관측 및 Sonar 연동은 별도 monitoring EC2로 구성되어 있습니다.

---

## 11. 아키텍처 참고 메모

- `SonarQube`는 현재 `ALB -> external target registration` 경로에 의존하므로 일반 in-cluster 서비스와 분리해서 그려야 합니다.
- 실제 앱 경로는 사실상 `User -> ALB -> Frontend -> internal proxy -> Backend/Auth/OCR` 입니다.
- 현재 AWS 기준의 관계형 DB는 예전 학원 DB가 아니라 `RDS MariaDB` 입니다.
- `S3 tutum-prod-storage`가 OCR 이미지, 프로필 이미지, 백업의 기본 객체 저장소 역할을 대체했습니다.
- 이 문서는 staging 기준이므로 replica 수나 node 수는 KEDA, EKS Auto Mode 수렴에 따라 달라질 수 있습니다.

