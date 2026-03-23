# Ubuntu 22.04 LTS EOL 대응 계획

> 작성일: 2026-03-04
> 멘토링 피드백: 정예찬 멘토님 (2026-03-04)

---

## 현황

| 항목 | 내용 |
|------|------|
| 현재 OS | Ubuntu 22.04 LTS (Jammy Jellyfish) |
| 표준 지원 종료 | 2027년 4월 |
| EOL 이후 위험 | 보안 패치 중단 → CVE 미대응 상태 지속 |
| 영향 범위 | 전체 k8s 노드 (cp1/cp2/cp3 + worker1/2/3, 총 6대) |

---

## 위험도 평가

EOL 이후 보안 업데이트가 중단되면:
- 커널 취약점 노출 (클러스터 전 노드 동시 위험)
- apt 패키지 저장소 업데이트 중단
- KISA 보안 점검 시 "미지원 OS 사용"으로 감점

---

## 대응 옵션 비교

| 옵션 | 설명 | 권장 시점 |
|------|------|-----------|
| **Ubuntu Pro ESM** | Canonical 유료 확장 보안 유지보수 (5년 추가) | 2026년 내 검토 |
| **Ubuntu 24.04 LTS 업그레이드** | `do-release-upgrade -d` 인플레이스 업그레이드 | 2026년 하반기 |
| **노드 롤링 교체** | 새 노드를 24.04로 프로비저닝 후 워크로드 이관 | 2026년 말 ~ 2027년 초 |

---

## 단계별 실행 계획

### Phase 1 — 2026년 2분기 (즉시)
- [ ] 각 노드 `lsb_release -a` 로 현재 버전 확인
- [ ] Ubuntu Pro 무료 개인 라이선스 (최대 5대) 등록 검토
- [ ] 자동 보안 업데이트 활성화 (`unattended-upgrades` 패키지)

```bash
# 자동 보안 업데이트 활성화
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

### Phase 2 — 2026년 3분기
- [ ] Ubuntu 24.04 LTS 호환성 검증 (테스트 노드 1대에서 선행 업그레이드)
- [ ] k8s 노드 드레인 → OS 업그레이드 → 재조인 절차 문서화

```bash
# 노드 1대 업그레이드 절차 예시
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
sudo do-release-upgrade        # 22.04 → 24.04
kubectl uncordon <node>
```

### Phase 3 — 2026년 4분기 ~ 2027년 1분기 (EOL 전)
- [ ] 전체 6개 노드 롤링 업그레이드 (한 번에 1~2대씩)
- [ ] 업그레이드 완료 후 KISA 보안 점검 항목 재확인

---

## 발표 어필 포인트

> "현재 Ubuntu 22.04 LTS를 사용 중이며, EOL(2027년 4월)을 인지하고 있습니다.
> Phase 1로 자동 보안 업데이트를 적용했고, 2026년 하반기에 Ubuntu 24.04 LTS 롤링 업그레이드를 계획하고 있습니다."

---

## 참고

- [Ubuntu 릴리즈 수명주기](https://ubuntu.com/about/release-cycle)
- [Ubuntu Pro ESM](https://ubuntu.com/pro)
- KISA 보안 점검 가이드 (CC인증 기준 OS 패치 정책)
