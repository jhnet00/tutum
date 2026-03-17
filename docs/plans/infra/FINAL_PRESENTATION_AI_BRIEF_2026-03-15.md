# Tutum 최종발표 PPT 제작용 상세 지시서 (GPT Pro / 다른 AI용)

목적:
- `50장 이내`의 최종발표용 PPT를 제작한다.
- 첨부된 참고 PDF의 `목차 구성`, `슬라이드 순서`, `설명 방식`, `발표 흐름`을 최대한 닮게 만든다.
- 단, `기술 사실`은 반드시 Tutum 문서 기준으로 맞춘다.

권장 산출물:
- 1차: 슬라이드 34~38장
- 2차: 필요 시 부록 3~5장

---

## 1. AI에게 전달할 핵심 요청

아래 요청을 그대로 사용해도 된다.

### 복붙용 메인 프롬프트

```text
너는 최종발표용 PPT를 만드는 AI다.

목표:
1. 첨부된 참고 PDF의 발표 흐름과 슬라이드 구성 방식(표지 → 목차 → 문제정의 → 기존구조 → 목표구조 → 기술선택 → 실행내용 → 검증결과 → 회고/향후계획 → Q&A)을 매우 유사하게 따른다.
2. 다만 기술 내용은 아래 Tutum 인프라 문서에서 확정된 사실만 사용한다.
3. 최종 결과는 50장 이내, 권장 34~38장으로 만든다.
4. 언어는 한국어로 한다.
5. 디자인은 참고 PDF의 분위기를 따르되, 내용의 정확성을 최우선으로 한다.
6. 과장 금지. 완료되지 않은 작업은 완료라고 쓰지 않는다.

반드시 참고할 소스 문서:
- K8S_MIGRATION_PLAN.md
- K8S_TECH_STACK.md
- K8S_CICD_LGTM_SETUP_PLAN_2.md
- AWS_MIGRATION_PLAN_2026-03-03.md
- AWS_MIGRATION_DETAIL_GUIDE.md
- ONPREM_VM_TO_AWS_MIGRATION_STATUS_2026-03-12.md
- APP_MONGO_INTEGRATION_CHECKLIST.md
- RUBY_MINIO_SES_OCR_K8S_QA.md
- FINAL_PRESENTATION_SLIDE_DRAFT_2026-03-15.md

절대 바꾸면 안 되는 핵심 사실:
- 소스/CI는 GitLab SaaS 유지
- AWS 이미지 레지스트리는 ECR 사용
- 배포 대상은 EKS
- 외부 진입은 Route53 + ALB
- 내부 서비스 메시 기능은 Istio 유지
- 모니터링 백엔드는 EKS 내부가 아니라 전용 monitoring EC2로 분리 운영
- K8s 내부에는 Alloy DaemonSet만 둔다
- MariaDB는 RDS로 이전 완료
- MongoDB 앱 정본은 EKS in-cluster ReplicaSet으로 전환 완료
- frontend/backend/auth/ocr는 AWS 경로 기준으로 동작 중
- object storage는 S3 기준으로 정리 중이지만 runtime 검증은 일부 남아 있다
- on-prem 완전 shutdown은 아직 완료가 아니다
- SonarQube AWS 이전은 미확정/미완료
- Kafka EC2 이전은 장기 backlog로 보류 가능

PPT 구성 원칙:
- 각 슬라이드는 제목 1개 + 핵심 bullet 3~5개 중심
- 한 슬라이드에 메시지는 1개만
- 설명 방식은 “상황 → 문제 → 선택 → 실행 → 결과 → 남은 이슈” 흐름을 유지
- 아키텍처/플로우/비교표/진행률/결과표를 적극 활용
- 발표자가 그대로 읽을 수 있을 정도로 텍스트를 정리하되, 문장이 너무 길어지면 안 된다

특히 반영할 내용:
- 기존 온프레미스 구조(8대 VM, kubeadm, MetalLB, cloudflared, monitoring VM, legacy Mongo 등)
- AWS 목표 구조(EKS, RDS, S3, monitoring EC2, Route53, ALB, ECR, ArgoCD, KEDA, Istio)
- RDS cutover
- MongoDB Atlas/legacy → EKS ReplicaSet 정본 전환
- monitoring EC2 기반 LGTM 전환
- 2026-03-12 기준 온프레미스와 AWS가 병행 존재하는 현재 live status
- shutdown을 성급하게 하지 않고 단계적으로 판단한 이유

중요:
- 참고 PDF의 “목차/섹션 순서/한 장에서 설명하는 양/최종발표 말투”를 최대한 닮게 만든다.
- 하지만 기술 사실이 참고 PDF와 다르게 보일 경우, 기술 사실은 Tutum 문서를 따른다.

최종 출력 형식:
1. 슬라이드 번호
2. 슬라이드 제목
3. 본문 bullet
4. 발표자 스피커 노트(짧게)
5. 시각 요소 제안(표/아키텍처/타임라인/비교표 중 무엇이 적합한지)
```

---

## 2. 이 발표에서 반드시 유지해야 할 스토리라인

추천 스토리:
- 우리는 단순히 서버를 AWS로 복사한 것이 아니라,
- `온프레미스 중심 운영 구조`를 `AWS 중심 정본 운영 구조`로 재정의했다.
- 핵심은 세 가지였다.
  - 서비스 경로 정리
  - 데이터 정본 전환
  - 운영/배포/모니터링 체계 재구성

발표 흐름은 아래 순서를 권장한다:
1. 프로젝트 배경
2. 기존 구조와 문제
3. 목표 구조와 기술 선택
4. 마이그레이션 실행
5. 검증 결과
6. 현재 상태와 남은 과제
7. 결론

---

## 3. 절대 틀리면 안 되는 기술 사실

### 3-1. 현재/목표 인프라
- 기존: `VirtualBox 8대`, `kubeadm`, `containerd`, `Calico`, `MetalLB`
- 목표: `AWS EKS`, `ECR`, `Route53`, `ALB`, `RDS`, `S3`, `monitoring EC2`

### 3-2. CI/CD
- GitLab self-hosted가 아니라 `GitLab SaaS`
- 레지스트리는 `Harbor`가 아니라 `ECR`
- 배포는 `GitLab CI → ECR → ArgoCD → EKS`

### 3-3. 모니터링
- `LGTM 전체를 EKS 내부에 올린 것이 아님`
- `Alloy DaemonSet은 K8s 내부`
- `Grafana/Loki/Tempo/Mimir/Kiali/InfluxDB`는 monitoring EC2

### 3-4. 데이터
- MariaDB는 `학원 서버` 의존에서 `RDS`로 이전 완료
- MongoDB 앱 정본은 `Atlas`가 아니라 `EKS ReplicaSet`
- Redis/Kafka/Elasticsearch도 AWS EKS 쪽 live

### 3-5. 남은 이슈
- on-prem 완전 shutdown은 아직 아님
- legacy Mongo VM, old monitoring VM, MinIO, cloudflared 잔존성 점검 필요
- SonarQube AWS 이전은 아직 결정/완료되지 않음

---

## 4. 추천 슬라이드 수 및 페이지 역할

권장:
- 총 34장

페이지 역할:
- 1~3장: 표지/목차/프로젝트 소개
- 4~7장: 배경/문제/목표
- 8~16장: 설계 및 기술 스택
- 17~25장: 마이그레이션 실행 및 핵심 cutover
- 26~30장: 검증/현재 상태/남은 과제
- 31~34장: 회고/향후 계획/결론/Q&A

---

## 5. 슬라이드별 제작 가이드

### Cover/Intro 구간
- 표지: 프로젝트명, 한 줄 요약
- 목차: 5~6개 섹션
- 프로젝트 소개: 서비스 설명보다 `인프라 현대화` 성격을 먼저 강조

### Problem 구간
- 기존 구조(8대 VM, kubeadm, monitoring VM, Mongo 혼재)를 그림으로 보여주기
- pain point는 “복잡함”보다 `정본 불명확`, `레거시 잔존`, `운영 중복`을 중심으로 쓰기

### Design 구간
- 한 장에 모든 기술을 넣지 말고
  - 아키텍처
  - 기술 스택
  - CI/CD
  - 보안
  - 모니터링
  - 데이터 전략
  로 나눠서 보여주기

### Execution 구간
- 실제 완료된 작업 중심
  - RDS cutover
  - Mongo cutover
  - monitoring EC2 전환
  - ECR/ArgoCD/EKS 경로
- “예정”보다 “완료”가 무엇인지 먼저 보여주기

### Validation 구간
- 상태코드, replica 수, 실제 endpoint 예시, live 확인 결과 포함
- `2026-03-12 기준` 현재 상태를 명시

### Ending 구간
- 남은 과제와 결론을 분리
- 결론에서 “AWS 정본화는 상당 부분 완료, 온프레 완전 철수는 아직 아님”을 분명히 하기

---

## 6. 디자인/서술 톤 가이드

디자인:
- 디자인은 내가 따로 해야하니까 신경쓰지말고 그냥 화이트+블랙
- 다만 화려한 장식보다 `기술 발표용 정리된 정보 구조`가 더 중요
- 표, 비교표, 단계별 타임라인, 박스형 아키텍처 다이어그램을 적극 사용

문장 톤:
- 학생 발표이지만 너무 가볍지 않게
- “무엇을 했는가”와 “왜 그렇게 했는가”를 같이 설명
- 확실한 것은 단정적으로, 미완료는 조건부/보류로 표현

금지 표현:
- “완전히 마무리됐다” (근거 없으면 금지)
- “모든 인프라가 AWS로 넘어갔다” (금지)
- “SonarQube도 AWS에서 운영 중이다” (현재 기준 금지)

추천 표현:
- “AWS 기준 정본 경로를 확보했다”
- “핵심 서비스 경로는 AWS로 전환됐다”
- “온프레미스 완전 철수는 단계적으로 진행할 예정이다”

---

## 7. 발표 중 강조할 질문 포인트

청중이 궁금해할 가능성이 높은 질문:
- 왜 monitoring은 EKS 내부가 아니라 EC2인가?
- 왜 MariaDB는 RDS로, Mongo는 EKS ReplicaSet으로 갔는가?
- 왜 on-prem을 바로 끄지 않았는가?
- 왜 Kafka EC2 이전은 바로 하지 않았는가?
- GitLab SaaS를 유지하면서도 GitOps를 어떻게 구성했는가?

PPT는 이 질문들에 자연스럽게 답하도록 구성해야 한다.

---

## 8. 최종 점검 체크리스트

AI가 PPT를 만든 뒤 반드시 체크할 것:
- [ ] 50장 이하인가?
- [ ] 참고 PDF와 비슷한 목차/흐름인가?
- [ ] AWS/EKS/ECR/RDS/S3/monitoring EC2가 정확히 반영됐는가?
- [ ] Mongo cutover와 RDS cutover가 정확히 들어갔는가?
- [ ] on-prem 완전 shutdown을 완료라고 쓰지 않았는가?
- [ ] 남은 과제가 솔직하게 반영됐는가?
- [ ] 결론이 “운영 기준의 전환”이라는 메시지로 정리되는가?

---

## 9. 이 문서와 함께 쓰면 좋은 파일

같이 넘겨주면 가장 좋다:
- `FINAL_PRESENTATION_SLIDE_DRAFT_2026-03-15.md`
- 참고 PDF
- 위 infra 문서들

추천 사용 방식:
1. 먼저 이 문서로 AI에게 전체 제약을 준다.
2. 다음으로 `FINAL_PRESENTATION_SLIDE_DRAFT_2026-03-15.md`를 같이 넣어 slide-by-slide 초안을 준다.
3. 마지막으로 참고 PDF를 함께 넣어 디자인/흐름을 맞춘다.
