# 2026-03-06 AWS Session Manager 검증 + MariaDB EKS 연결 확인

## 작업자
박성준

## 작업 배경
- AWS Migration Plan Phase A 완료 기준 중 미완 항목 검증
- 런북 체크리스트: `[ ] Session Manager 세션 정책(STG 1대) 검증` → 완료 처리
- Phase A 마지막 항목: EKS worker → MariaDB(211.46.52.153:15432) outbound 연결 확인

## 완료 항목

### 1. Session Manager STG 검증

#### 인스턴스 상태
| 인스턴스 | 노드그룹 | SSM PingStatus |
|---------|---------|----------------|
| i-0eef06d350fae53d3 | ng-stg-general (tutum-stg-eks) | Online ✅ |
| i-04c7be740d1959e46 | ng-stg-general (tutum-stg-eks) | Online ✅ |

#### 검증 결과
| 항목 | 결과 |
|------|------|
| AmazonSSMManagedInstanceCore IAM 부착 | ✅ tutum-eks-node-role-stg |
| Inbound 22/3389 미개방 | ✅ self-referencing SG 1개만 (EFA용) |
| SSM 명령 실행 | ✅ Status: Success (`echo SSM_OK; hostname; uptime`) |
| CloudWatch 세션 로깅 설정 | ✅ SSM-SessionManagerRunShell 문서 생성 완료 |

#### SSM-SessionManagerRunShell 설정 내용
- CW Log Group: `/tutum/ssm/session` (90일 보관)
- cloudWatchStreamingEnabled: true
- idleSessionTimeout: 30분
- s3BucketName: "" (현재 CW만 사용)

### 2. MariaDB EKS 연결 확인

- 대상: `211.46.52.153:15432` (학원 제공 MariaDB 공인 IP)
- 테스트 방법: SSM send-command → `bash /dev/tcp/211.46.52.153/15432`
- 결과: **MARIADB_REACHABLE** ✅
- EKS worker SG outbound: `0.0.0.0/0` 전체 허용 → 차단 없음

## 참조 문서
- `docs/ruby/aws_settings/2026-03-05_session_manager_access_policy_draft.md`
- `docs/ruby/2026-03-05_AWS_CONSOLE_TEAM_ACCESS_5H_RUNBOOK.md` (체크리스트 항목)
- `docs/plans/infra/AWS_MIGRATION_PLAN_2026-03-03.md` (Phase A 기준)

## 결론
- **Phase A 완료 기준 모두 충족**
- Session Manager STG 검증 완료 (체크리스트 `[x]` 처리 가능)
- MariaDB 직접 연결 경로 확인 → Phase C E2E 테스트 전제조건 충족
- 다음 단계: Phase B (ALB Ingress Controller, ArgoCD on EKS, NetworkPolicy 이식, Istio 재설치)
