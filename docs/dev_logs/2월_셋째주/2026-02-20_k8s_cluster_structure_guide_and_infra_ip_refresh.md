# 2026-02-20 - K8S 클러스터 구조 가이드 작성 및 Infra IP 최신화

## 1. 작업 배경
- 팀원별 VM 역할과 클러스터 구조가 문서마다 분산되어 있어 온보딩/작업 인계 시 혼선이 발생함.
- 기존 일부 인프라 문서에 구형 IP 대역(Host-Only 기준) 흔적이 남아 있어 운영 기준(브릿지)과 불일치 가능성이 있었음.

## 2. 변경 사항
- 신규 가이드 문서 추가
  - `docs/plans/infra/K8S_CLUSTER_STRUCTURE_GUIDE.md`
  - 포함 내용:
    - 물리 PC-VM-IP-역할 매핑
    - Control Plane / Worker / MongoDB / Monitoring 역할 정리
    - 서비스 트래픽 흐름(ASCII 다이어그램)
    - 브릿지 표준 운영 이유
    - 접속 기준(브릿지 직접 SSH / NAT 포트포워딩)
    - 일일 체크리스트 및 장애 1차 분류

- 인덱스 문서 반영
  - `docs/plans/infra/K8S_DOCS_INDEX.md`
  - `K8S_CLUSTER_STRUCTURE_GUIDE.md` 빠른 진입 섹션 추가
  - 점검 항목 문구를 브릿지 운영 기준으로 정리

- 마이그레이션 문서 IP 최신화
  - `docs/plans/infra/K8S_MIGRATION_PLAN.md`
  - VM 내부 IP/네트워크 대역/MetalLB IP 풀을 `192.168.0.x` 기준으로 정리

## 3. 검증
- `docs/plans/infra` 내 `192.168.56.x` 검색 점검
  - 운영값 기준 문서는 `192.168.0.x`로 정리됨
  - `K8S_CICD_LGTM_SETUP_PLAN.md`의 `192.168.56.x`는 전환 설명(레거시 안내) 문맥으로만 유지됨
- 신규 가이드 문서 경로/인덱스 링크 수동 확인

## 4. 결과
- 팀원이 “누가 어느 노드에서 무엇을 담당하는지”를 단일 문서에서 바로 이해할 수 있는 기준 가이드 확보.
- 브릿지 표준(`192.168.0.x`) 기준으로 인프라 문서 일관성이 강화됨.

## 5. 후속 권장
- `K8S_CICD_LGTM_SETUP_PLAN.md`도 필요 시 “운영값만 보기” 섹션을 추가해 레거시 전환 설명과 본 운영 절차를 더 명확히 분리.
- 클러스터 실제 상태(`kubectl get nodes -o wide`)를 기준으로 가이드의 역할/노드 라벨 섹션을 주기적으로 갱신.
