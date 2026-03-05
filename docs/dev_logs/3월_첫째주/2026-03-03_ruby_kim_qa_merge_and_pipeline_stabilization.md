# 개발 로그 작업 요약 (2026-03-03)

## 1. 작업 요약
- 작업 일시: 2026-03-03
- 작업자: Ruby Kim
- 브랜치: develop
- 작업 목적:
  - OCR/포트폴리오 기능 안정화 및 회귀 이슈 수정
  - develop 최신 변경사항과 안전 병합 후 파이프라인 정상화
  - AWS 마이그레이션 계획서(EKS/ECR + LGTM 기준) 정리

## 2. 상세 변경 사항
- OCR/자산 입력 관련 기능 수정
  - OCR 파서에서 평균단가/매수금액 매핑 로직 보정
  - 자산 직접 등록 시 소수점 입력 허용 범위 확장(최대 6자리)
  - OCR 런타임 의존성 보강(`google-cloud-vision`) 반영
- 프론트엔드 표시 이슈 수정
  - 포트폴리오 SVG gauge 속성 오류(`cx/cy/r` 값 파싱 오류) 수정
- CI/CD 및 병합 운영
  - develop 최신 업데이트를 기준으로 병합 반영
  - GitLab 파이프라인 배포 연계 상태 점검
- 문서화
  - AWS 마이그레이션 계획서에서 Harbor 제거, EKS/ECR + LGTM 기준으로 재정리

## 3. 작업 중 발생 이슈 및 대응
- 이슈:
  - OCR 배포 후 초기 상태에서 Vision 모듈 import 오류로 Pod 준비 실패
- 대응:
  - 백엔드 이미지 의존성에 `google-cloud-vision` 추가 후 재배포하여 복구

- 이슈:
  - 포트폴리오 화면에서 차트/SVG 속성 오류로 렌더링 경고 다수 발생
- 대응:
  - 잘못된 Tailwind 형식 문자열이 SVG 숫자 속성에 들어가지 않도록 프론트 코드 수정

- 이슈:
  - 백엔드 lint 단계가 간헐적으로 실패
- 대응:
  - `cache.py` 후행 공백(W391) 등 린트 이슈를 반영해 재실행, 파이프라인 연속 확인

## 4. 결과(검증 포함)
- 검증 항목:
  - GitLab 파이프라인 실행/배포 연계 확인
  - OCR + 포트폴리오 입력(소수점) 기능 반영 여부 확인
  - 프론트 콘솔 오류 감소 여부 확인
- 검증 결과:
  - 파이프라인 완료 후 OCR/소수점 입력 변경사항 반영 확인
  - SVG 속성 오류 이슈 수정 커밋 반영 확인
  - 주요 기능(시세, OAuth, OCR, 자산 등록) 기준 회귀 점검 진행

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-03" --until="2026-03-03 23:59:59" --author="Ruby Kim"
# 29f3e171 fix(frontend): correct portfolio SVG gauge attributes
# e46b048f fix(lint): remove trailing blank line in OCR parser tests
# 63b0909a fix(ocr,portfolio): improve OCR avg-price mapping and allow 6-decimal direct input
# 53ceb72b docs: revise aws migration plan with LGTM and role list
# c7c1f1cb chore: finalize merged updates and aws migration plan (eks/ecr)
# 035184e7 fix(ocr): add google vision deps to backend image
```

## 6. 후속 작업/리스크
- [ ] OCR 정밀도 개선(평가금액/매수금액/평균단가 라벨 컨텍스트 파싱 고도화)
- [ ] `lint:backend` 간헐 실패 원인(환경/캐시/규칙) 분리 점검
- [ ] 뉴스 파이프라인 소비 지연 및 Kafka consumer lag 상시 모니터링
- [ ] 멘토링 이후 확정안 기반으로 AWS 마이그레이션 실행 계획(3/5~3/12) 상세 태스크화
