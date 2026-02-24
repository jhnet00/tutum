🤖 AI Agent 협업 프로토콜 (V1.0)
이 문서는 Antigravity와 Claude Code의 효율적인 협업을 위한 표준 운영 절차(SOP)입니다. 모든 AI 에이전트는 작업을 시작하기 전 이 문서를 반드시 숙지하십시오.

📋 협업 원칙
설계는 Antigravity, 실행은 Claude: 대규모 컨텍스트 분석이 필요한 계획 수립은 Antigravity가 담당하고, 정밀한 코드 구현과 검증은 Claude Code가 담당합니다.

불변의 기록: docs/work-plans/ 내의 계획 문서는 기록 보존을 위해 기존 내용을 삭제하지 않고 하단에 추가(Append)하는 방식으로 업데이트합니다.

시각적 검증 필수: 모든 기능 구현의 최종 승인은 Antigravity 브라우징 기능을 통한 런타임 확인 후에만 가능합니다.

🔄 5단계 워크플로우 상세
1단계: 계획 수립 (Planning)
주체: Antigravity

임무: 문제 분석 및 해결 계획 수립 후 docs/work-plans/[task-name].md 생성.

필수 포함: DB 스키마 변경안, API 설계, 브라우징 테스트 시나리오.

2단계: 계획 검증 (Plan Verification)
주체: Claude Code

임무: 생성된 MD 파일을 읽고 프로젝트 컨벤션 및 로직의 결함 검토.

업데이트 방식: 보완 사항은 문서 하단 ## Refinements by Claude 섹션에 기술.

3단계: 코드 실행 (Execution)
주체: Antigravity

임무: 보완된 MD 파일을 바탕으로 실제 코드 작성 및 수정.

결과 보고: 변경된 파일 목록과 3줄 요약을 사용자에게 전달.

4단계: 교차 검증 (Cross-Check)
주체: Claude Code

임무: Antigravity의 작업물을 리뷰하여 계획 이행 여부 확인.

승인 기준: 계획 대비 구현률 95% 이상 및 에러 없음 확인 시 승인.

5단계: 브라우징 최종 검증 (Visual Validation)
주체: Antigravity Browsing Agent

임무: localhost:3000 접속 후 시나리오대로 실제 동작 확인.

보고: 화면 렌더링 상태 및 DB 데이터 반영 여부 리포트 작성.


아래 내용은 사용자가 참고 할 내용 

 🛠️ 모델별 최적 프롬프트 (Shortcut)
Antigravity (1단계): "이 기능의 계획을 세워 docs/work-plans/ 폴더에 md로 저장해줘."

Claude (2단계): "docs/work-plans/[파일명].md 확인하고 보완사항 하단에 추가해줘."

Antigravity (3단계): "[파일명].md 읽고 보완사항 반영해서 코딩해줘."

Claude (4단계): "작업요약: [내용] 확인하고 코드베이스 검증해줘."

Antigravity (5단계): "브라우저 열어서 계획서 시나리오대로 동작하는지 검증해줘."