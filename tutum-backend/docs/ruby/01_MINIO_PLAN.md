1. node2 MinIO 설정 (OCR 이미지/프로필 이미지 보관 → 추후 S3 전환)
   목표

node2에 MinIO 띄우고

ocr-images, profile-images 버킷 생성

(옵션) presigned URL 방식으로 업로드/다운로드 가능하게

Steps (체크포인트 포함)

node2에 MinIO 배포 (docker or systemd or k8s 중 택1)

콘솔 접속 확인 (UI 로그인)

버킷 2개 생성

접근 정책(공개/비공개) 결정: 기본은 비공개 + presigned

(선택) lifecycle rule (N일 후 삭제/아카이브)

S3 호환 전환 전략 문서화: “MinIO endpoint만 바꾸면 됨”

TASK: Setup MinIO on node2 for object storage
CONTEXT:

- Use MinIO to store OCR images + user profile images
- Buckets: ocr-images, profile-images
- Default policy: private (use presigned URL)
- Future: migrate to AWS S3 with minimal code change
  INPUTS:
- node2 OS/Runtime: (fill: Ubuntu/Rocky + docker? k8s?)
  OUTPUT:

1. Installation/deploy steps (commands)
2. Access info (URL/port), health check command
3. mc client setup + bucket create commands
4. Sample presigned URL command
5. Notes for S3 migration (what config changes)
   CONSTRAINTS:

- Do not expose root credentials in repo; use env vars / secret manager
