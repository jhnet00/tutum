# TUTUM LGTM 모니터링과 Admin 대시보드 발표 가이드

- 작성일: 2026-03-18
- 목적: `https://tutum.my/admin` 모니터링 페이지와 LGTM 관측 구조를 발표할 때, 왜 이 구성을 선택했는지와 무엇을 보여주는지 논리적으로 설명할 수 있도록 정리한다.
- 기준 구현:
  - [admin.py](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/backend/app/routers/admin.py)
  - [page.tsx](C:/Users/CloudDX/Documents/GitHub/clouddx-project/frontend/frontend/app/admin/page.tsx)
  - [2026-03-04_admin-monitoring-dashboard.md](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/docs/presentations/2026-03-04_admin-monitoring-dashboard.md)
  - [AWS_STAGING_TOPOLOGY_ARCHITECTURE_2026-03-16.md](C:/Users/CloudDX/Documents/GitHub/clouddx-project/backend/docs/plans/infra/AWS_STAGING_TOPOLOGY_ARCHITECTURE_2026-03-16.md)

---

## 1. 한 줄 요약

TUTUM은 Kubernetes 기반 서비스 운영에서 `메트릭`, `로그`, `트레이스`를 따로 보지 않고 한 번에 판단할 수 있도록 `LGTM(Grafana + Loki + Tempo + Mimir)` 관측 스택을 구성했고, 운영자가 실제로 필요한 정보만 모은 커스텀 운영 콘솔로 `/admin` 대시보드를 만들었다.

---

## 2. 발표에서 먼저 말할 핵심 메시지

### 핵심 메시지 1

`LGTM은 관측 데이터를 모으는 기반이고, /admin은 운영자가 빠르게 판단하기 위한 실행 화면입니다.`

### 핵심 메시지 2

`Grafana만 쓰면 데이터는 볼 수 있지만, 운영자가 매번 Grafana와 kubectl과 로그를 따로 봐야 해서 느립니다.`

### 핵심 메시지 3

`그래서 저희는 LGTM을 백엔드 관측 기반으로 두고, /admin에서 서비스 운영에 필요한 시그널만 다시 묶어 보여주도록 만들었습니다.`

---

## 3. 왜 LGTM을 선택했는가

## 3-1. 우리가 해결하려던 문제

Kubernetes 환경에서는 운영자가 다음 정보를 동시에 봐야 한다.

- API 응답 속도와 에러율
- 파드/노드 상태
- 워커 파이프라인 이상 여부
- 실시간 로그
- 느리거나 실패한 요청의 추적 경로

이 정보를 각각 다른 도구로 보면 대응 속도가 느려진다.

- 메트릭: Prometheus/Grafana
- 로그: kubectl logs 또는 별도 로그 시스템
- 트레이스: 별도 APM
- 클러스터 상태: kubectl / Lens

즉, `문제는 데이터가 없는 것`이 아니라 `운영자가 한 번에 판단하기 어려운 것`이었다.

## 3-2. LGTM을 선택한 이유

### Grafana

- 메트릭, 로그, 트레이스를 한 UI 계열에서 연결하기 좋다.
- 팀원들이 접근하기 쉽고, 대시보드/Explore가 익숙하다.

### Loki

- 로그를 `Kubernetes label` 기반으로 다루기 좋아서 `namespace`, `pod`, `container` 기준 필터링이 쉽다.
- Elasticsearch 기반 로그 스택보다 운영 부담과 인덱싱 비용이 상대적으로 낮다.

### Tempo

- 트레이스 저장에 집중된 구조라 대규모 인덱싱 부담이 적다.
- OpenTelemetry와 자연스럽게 연결된다.

### Mimir

- Prometheus 호환 쿼리(PromQL)를 그대로 활용할 수 있다.
- 장기 보존과 중앙 메트릭 집계를 분리하기 좋다.

### Alloy

- 메트릭, 로그, 트레이스 수집 경로를 하나의 에이전트 계열로 정리할 수 있다.
- EKS 안에서는 수집기 역할만 두고, 저장 계층은 별도 monitoring EC2로 분리할 수 있다.

## 3-3. 우리 구조에서의 장점

현재 구조는 `EKS 내부에 수집기`, `monitoring EC2에 LGTM 저장/조회 계층`으로 나뉜다.

- EKS 내부
  - `Grafana Alloy`
  - `node-exporter`
  - `kafka-exporter`
  - `redis-exporter`
  - `elasticsearch-exporter`
- monitoring EC2
  - `Grafana`
  - `Loki`
  - `Tempo`
  - `Mimir`

이 구조의 장점은 다음과 같다.

- 앱 클러스터 안에 무거운 관측 저장소를 모두 올리지 않아도 된다.
- 운영용 LGTM 스택을 app/data 워크로드와 분리할 수 있다.
- 비용 절감 시 `monitoring EC2`를 따로 stop 할 수 있다.

---

## 4. 왜 Grafana만 쓰지 않고 /admin을 따로 만들었는가

## 4-1. 문제

Grafana는 관측 데이터 탐색 도구로는 좋지만, 운영자가 매번 필요한 판단을 바로 하기에는 다음 한계가 있다.

- 클러스터 노드/파드 상태는 Grafana만으로 충분하지 않다.
- 운영자는 `kubectl`, `Grafana`, `Loki`, `Tempo`, DB 상태를 계속 오가게 된다.
- 서비스별로 어떤 신호를 우선 봐야 하는지 운영자 관점으로 정리돼 있지 않다.

## 4-2. 그래서 /admin을 만든 이유

`/admin`은 단순 대시보드가 아니라 `운영 콘솔`에 가깝다.

의도는 다음과 같다.

- 운영자가 처음 들어왔을 때 전체 상태를 10초 안에 파악할 수 있게 하기
- 메트릭, 로그, 트레이스, 파이프라인 상태를 한 화면 체계 안에 묶기
- 실무적으로 필요한 데이터만 가공해서 보여주기
- AI 분석으로 사람이 놓칠 수 있는 패턴을 빠르게 요약하기

즉, `LGTM은 원본 데이터 플랫폼`, `/admin`은 `운영자용 요약/판단 UI`다.

## 4-3. 우리가 /admin에서 직접 추가한 가치

- K8s Python SDK로 `노드`, `파드`, `PVC` 상태를 직접 조회
- Mimir에서 KPI를 조회해 `Overview` 카드로 요약
- Loki 로그를 가공해서 `severity`, `trace 링크`, `에러 요약`으로 표시
- Tempo 트레이스를 느린 요청, 5xx, 4xx로 나눠 보여줌
- 워커 상태와 MongoDB/Elasticsearch/Kafka/Redis 신호를 한 화면에 표시
- Bedrock 기반 `탭별 AI 진단` 추가

이건 Grafana 기본 대시보드만으로는 바로 나오지 않는 운영용 가공 정보다.

---

## 5. /admin 페이지에서 실제로 무엇을 보여주는가

현재 `/admin`은 [page.tsx](C:/Users/CloudDX/Documents/GitHub/clouddx-project/frontend/frontend/app/admin/page.tsx) 기준으로 다음 탭을 중심으로 구성되어 있다.

## 5-1. Overview

목적:

- 운영자가 첫 화면에서 전체 상태를 빠르게 본다.

보여주는 것:

- RPS
- P95 Latency
- Error Rate
- Kafka Lag
- 최근 1시간 API 처리량/응답시간 그래프
- 노드/파드/PVC 요약 수치
- 전체 AI 분석

발표 포인트:

- `서비스가 살아 있는가`보다 `지금 느려지고 있는가`, `에러가 늘고 있는가`를 먼저 본다는 의미

## 5-2. Infra

목적:

- 클러스터 레벨 이상을 파악한다.

보여주는 것:

- 노드 CPU/메모리 사용률
- 파드 상태 분포
- 재시작, CrashLoop 위험
- 인프라 AI 분석

발표 포인트:

- 애플리케이션 문제인지, 인프라 문제인지 초기에 분리할 수 있다.

## 5-3. Pipeline

목적:

- 뉴스/시세/색인 워커가 정상적으로 흐르고 있는지 확인한다.

보여주는 것:

- news, elastic, price 계열 워커 상태
- MongoDB news 건수
- Elasticsearch 인덱스 상태
- Loki 최근 로그 샘플
- 파이프라인 AI 분석

발표 포인트:

- TUTUM은 RAG와 시세 파이프라인이 중요하므로, 일반적인 앱 대시보드보다 `데이터 파이프라인 가시성`이 중요했다.

## 5-4. Data

목적:

- 데이터 계층 병목과 용량 위험을 본다.

보여주는 것:

- Redis
- Kafka
- Elasticsearch
- Disk
- MongoDB
- 데이터 AI 분석

발표 포인트:

- 앱 자체보다 데이터 저장소 이상이 서비스 품질에 더 직접적인 영향을 줄 수 있어서 별도 탭으로 분리했다.

## 5-5. Backup

목적:

- 백업이 도는지, 실패했는지 확인한다.

보여주는 것:

- CronJob 기준 백업 실행 결과
- 마지막 성공/실패 시점
- 백업 AI 분석

발표 포인트:

- 운영에서는 장애보다 `복구 가능성`이 중요하기 때문에 백업도 모니터링 대상에 넣었다.

## 5-6. Logs

목적:

- 최근 로그 패턴을 빠르게 확인한다.

보여주는 것:

- Loki 기반 실시간 로그
- namespace, pod, level 필터
- severity 분류
- trace 링크
- 로그 AI 분석

발표 포인트:

- 단순 로그 출력이 아니라 `오류 패턴`과 `중요도`를 빠르게 읽게 하는 데 초점을 맞췄다.

## 5-7. Traces

목적:

- 느리거나 실패한 요청의 경로를 본다.

보여주는 것:

- 최근 느린 요청
- 5xx 에러 트레이스
- 4xx 트레이스
- Grafana deep link
- 트레이스 AI 분석

발표 포인트:

- 로그만으로는 원인을 다 알기 어렵고, 요청 단위의 흐름까지 봐야 병목 지점을 찾을 수 있다.

---

## 6. 발표에서 이렇게 설명하면 자연스럽다

## 6-1. 40초 버전

`저희는 Kubernetes 환경에서 메트릭, 로그, 트레이스를 따로 보지 않기 위해 LGTM 스택을 구성했습니다. Alloy가 EKS 내부에서 데이터를 수집하고, monitoring EC2에서 Grafana, Loki, Tempo, Mimir가 각각 메트릭, 로그, 트레이스를 저장하고 조회합니다. 그런데 Grafana만으로는 운영자가 매번 필요한 판단을 하기에 불편해서, 저희는 tutum.my/admin에 운영용 대시보드를 직접 만들었습니다. 이 페이지에서는 클러스터 상태, 파이프라인 상태, 데이터 저장소 상태, 실시간 로그, 트레이스를 한 번에 보고, 필요하면 탭별 AI 분석으로 이상 징후를 빠르게 요약받을 수 있습니다.` 

## 6-2. 1분 버전

`저희가 LGTM을 선택한 이유는 메트릭, 로그, 트레이스를 하나의 관측 체계로 연결하고 싶었기 때문입니다. Alloy가 각 노드에서 메트릭과 로그를 수집하고, 애플리케이션은 OpenTelemetry로 트레이스를 전송합니다. 이렇게 수집한 데이터는 monitoring EC2의 Mimir, Loki, Tempo에 저장되고 Grafana에서 탐색할 수 있습니다. 다만 운영자는 Grafana만 보는 것이 아니라 실제로는 kubectl, 로그, 파이프라인 상태, 백업 상태까지 함께 판단해야 합니다. 그래서 저희는 /admin 페이지를 별도로 만들어서 Overview, Infra, Pipeline, Data, Backup, Logs, Traces 탭으로 필요한 정보만 다시 구성했습니다. 즉 LGTM이 원본 관측 플랫폼이라면, /admin은 운영자가 빠르게 판단하기 위한 서비스 맞춤형 콘솔이라고 설명할 수 있습니다.` 

---

## 7. 왜 필요한가에 대한 근거

평가관에게는 아래 논리로 설명하면 좋다.

### 운영 속도

- 장애 대응은 `데이터 접근 속도`도 중요하다.
- 한 화면에서 상태를 보게 하면 초기 판단 속도가 빨라진다.

### 데이터 종류 차이

- 메트릭만으로는 원인을 알기 어렵다.
- 로그만으로는 전체 추세를 보기 어렵다.
- 트레이스만으로는 현재 시스템 상태를 파악하기 어렵다.
- 그래서 세 가지를 같이 봐야 한다.

### Kubernetes 환경 특성

- 파드 재시작, 노드 상태, 워커 장애, exporter 상태 등 앱 외 요소가 많다.
- 단순 웹 서비스 대시보드보다 `운영 메타 정보`가 더 중요하다.

### 우리 서비스 특성

- 뉴스 파이프라인, 시세 파이프라인, RAG 검색이 핵심이라 일반 서비스보다 백그라운드 워커 상태가 중요하다.
- 따라서 `Pipeline`, `Data`, `Logs`, `Traces`를 한 UI에 묶는 가치가 크다.

---

## 8. 평가관이 물어볼 만한 질문과 답변 포인트

## 8-1. 왜 Prometheus가 아니라 Mimir를 썼나요?

답변 포인트:

- PromQL 호환성을 유지하면서 장기 보존과 중앙 집계를 더 유연하게 가져가고 싶었다.
- 실제 쿼리는 Prometheus 방식으로 쓰되, 저장/확장 계층은 Mimir를 사용했다.

## 8-2. 왜 ELK 대신 Loki를 썼나요?

답변 포인트:

- Kubernetes label 중심 로그 조회가 편했고, 운영 비용과 인덱싱 부담을 줄이고 싶었다.
- 저희는 로그 분석보다 `운영 로그 필터링과 빠른 조회`가 더 중요해서 Loki가 더 잘 맞았다.

## 8-3. 왜 Grafana만 쓰지 않고 /admin을 따로 만들었나요?

답변 포인트:

- Grafana는 관측 탐색 도구이고, /admin은 운영 판단 화면이다.
- 저희는 `노드/파드 상태`, `파이프라인 상태`, `백업 상태`, `AI 진단`까지 한 화면에 묶고 싶었다.

## 8-4. 왜 monitoring EC2에 LGTM을 두었나요?

답변 포인트:

- 앱 클러스터와 관측 저장 계층을 분리해서 운영하고 싶었다.
- app/data 워크로드와 관측 스택이 서로 자원을 잡아먹지 않게 하려는 목적도 있었다.
- 비용 절감 시 monitoring EC2를 별도로 stop 할 수 있다는 장점도 있다.

## 8-5. /admin 페이지는 Grafana의 대체인가요?

답변 포인트:

- 대체가 아니라 운영자용 요약 콘솔이다.
- 세부 탐색은 여전히 Grafana Explore나 원본 로그/트레이스 도구가 유리하다.

## 8-6. AI 분석은 신뢰할 수 있나요?

답변 포인트:

- AI가 원본 데이터를 생성하는 것은 아니고, 이미 수집한 메트릭/로그/트레이스를 요약하고 우선순위를 제안하는 용도다.
- 최종 판단은 운영자가 원본 지표를 함께 확인해야 한다.

## 8-7. 한계는 무엇인가요?

답변 포인트:

- 현재는 완전한 incident 관리 도구는 아니다.
- 로그와 트레이스의 상관관계는 일부 강화됐지만, 모든 요청이 자동으로 완전 연결되는 것은 아니다.
- 외부 synthetic monitoring, SLO, 배포 이벤트 오버레이는 더 보완할 수 있다.

## 8-8. 왜 Kibana는 쓰지 않았나요?

답변 포인트:

- 저희 Elasticsearch는 주로 뉴스 검색/RAG 인덱스 쪽 역할이 크고, 운영 로그의 중심은 Loki다.
- 운영 모니터링 기준에서는 Kibana보다 Grafana + Loki + Tempo + Mimir 조합이 더 맞았다.

---

## 9. 우리 구조의 강점

- 메트릭, 로그, 트레이스를 한 관측 체계로 연결했다.
- Kubernetes 운영 정보와 애플리케이션 관측 정보를 함께 보여준다.
- 파이프라인 중심 서비스 특성을 반영해 `Pipeline` 탭을 따로 뒀다.
- AI 분석을 붙여 운영자가 우선순위를 빨리 잡게 했다.
- 단순 대시보드가 아니라 실사용 운영 콘솔에 가깝다.

---

## 10. 우리 구조의 한계와 솔직한 평가

- 아직 완전한 AIOps나 Incident Response 플랫폼은 아니다.
- Alert acknowledgement, runbook execution, 배포 이벤트 오버레이는 더 보완할 수 있다.
- 일부 AI 진단은 요약 품질 차이가 있을 수 있다.
- 로그와 trace의 완전한 end-to-end 연결은 계속 개선 중이다.

이 부분을 솔직하게 말하면 오히려 설계 이해도가 높아 보인다.

---

## 11. 발표 마무리 멘트 예시

`정리하면, 저희는 LGTM을 단순히 붙인 것이 아니라 Kubernetes 운영에서 필요한 메트릭, 로그, 트레이스를 통합 관측 체계로 구성했고, 그 위에 운영자가 빠르게 판단할 수 있도록 tutum.my/admin이라는 서비스 맞춤형 운영 콘솔을 만들었습니다. 즉 LGTM이 데이터 수집과 저장의 기반이라면, /admin은 그 데이터를 실제 운영 의사결정에 바로 쓸 수 있게 만든 실행 화면이라고 설명할 수 있습니다.`
