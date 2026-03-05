# 개발 로그 작업 요약 (2026-03-04)

## 1. 작업 요약
- 작업 일시: 2026-03-04
- 작업자: Ruby Kim
- 브랜치: develop
- 작업 목적:
  - 서버 SSH 접근 보안 강화
  - 내부망 전용 접근 정책 명시
  - 외부 구간 보안(WAF) 적용 계획 정리

## 2. 상세 변경 사항
- 대상 서버: `cp-3 (192.168.0.222)`
- SSH 내부 접근 제어 설정 반영
  - `/etc/hosts.deny`에 `ALL:ALL` 정책 적용
  - `/etc/hosts.allow`에 내부망/허용 IP 기반 접근 정책 유지
- SSH root 직접 로그인 차단 반영
  - `sshd_config`에서 `PermitRootLogin no` 기준 적용
- 외부 보안 정책 명시
  - AWS 전환 시 외부 유입 트래픽은 `AWS WAF`로 보호 예정
  - 내부(SSH/관리접속)와 외부(웹 트래픽) 보안 계층 분리 원칙 확정

## 3. 작업 중 발생 이슈 및 대응
- 이슈:
  - SSH 보안 설정에서 내부 통제(`hosts.allow/deny`)와 외부 통제(WAF)의 역할 구분 필요
- 대응:
  - 내부 접근 통제는 OS/SSH 정책으로, 외부 웹 트래픽 방어는 AWS WAF로 분리 운영하도록 정리

## 4. 결과(검증 포함)
- 검증 항목:
  - 내부 SSH 접근 제한 정책 반영 여부
  - root 직접 접속 차단 정책 적용 여부
  - 외부 WAF 적용 계획 문서 반영 여부
- 검증 결과:
  - 내부망 전용 SSH 보호 정책(allow/deny) 적용 완료
  - `PermitRootLogin no` 적용 기준으로 root 직접 접근 차단
  - AWS 마이그레이션 계획에서 외부 보호 계층은 WAF 사용으로 정리 완료

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-04" --until="2026-03-04 23:59:59"
# (문서 기록 작업, 서버 설정 변경사항은 Git 추적 대상 아님)
```

## 6. 후속 작업/리스크
- [ ] `hosts.allow/deny`는 보조 통제 수단으로 유지하고, SSH 실효 통제는 UFW/SG + sshd 설정으로 표준화
- [ ] AWS 이관 후 ALB 앞단 WAF(Managed Rule + Rate Limit) 적용
- [ ] Session Manager 기반 운영접속 전환 시 SSH 22 포트 완전 차단 검토
