# 개발 로그 작업 요약 (2026-03-10)

## 1. 작업 요약

- 작업 일시: 2026-03-10
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: **D-6** SonarQube 설치 — 코드 품질 분석 도구를 monitoring EC2에 배포하고 `sonar.tutum.my`로 외부 접근 구성

---

## 2. 상세 변경 사항

### 인프라 구성

| 항목 | 내용 |
|------|------|
| 배포 위치 | monitoring EC2 (`i-0a8cab5d5ce1cac60`, 10.60.11.95) |
| 방식 | docker-compose (기존 모니터링 스택에 추가) |
| SonarQube 이미지 | `sonarqube:10-community` |
| DB | `postgres:15-alpine` (컨테이너 내부, sonar_db) |
| 외부 접근 | ALB 리스너 룰 + Route53 `sonar.tutum.my` |

### kernel 파라미터 설정 (SonarQube/Elasticsearch 요구사항)

```bash
sysctl -w vm.max_map_count=524288
sysctl -w fs.file-max=131072
# /etc/sysctl.conf에도 영구 적용
```

### /opt/monitoring/docker-compose.yml 변경

- `volumes:` 섹션에 추가:
  ```yaml
  sonar_db_data:
  sonarqube_data:
  sonarqube_logs:
  sonarqube_extensions:
  ```
- `services:` 섹션에 추가:
  ```yaml
  sonar-db:
    image: postgres:15-alpine
    container_name: sonar-db
    environment:
      POSTGRES_USER: sonar
      POSTGRES_PASSWORD: sonar2026
      POSTGRES_DB: sonar
    volumes:
      - sonar_db_data:/var/lib/postgresql/data

  sonarqube:
    image: sonarqube:10-community
    container_name: sonarqube
    depends_on:
      - sonar-db
    environment:
      SONAR_JDBC_URL: jdbc:postgresql://sonar-db:5432/sonar
      SONAR_JDBC_USERNAME: sonar
      SONAR_JDBC_PASSWORD: sonar2026
    ports:
      - "9000:9000"
    ulimits:
      nofile:
        soft: 131072
        hard: 131072
  ```

### AWS 리소스 변경

```bash
# 1. monitoring SG에 ALB → 9000 inbound 추가
aws ec2 authorize-security-group-ingress \
  --group-id sg-09bcd23950d81a5f0 \
  --protocol tcp --port 9000 \
  --source-group sg-0045e72a28d17da2d  # ALB SG 1
# (sg-092f6e696a1649308 도 동일하게 추가)

# 2. ALB Target Group 생성 (IP 타입, EC2 private IP)
aws elbv2 create-target-group \
  --name tutum-sonarqube-tg \
  --protocol HTTP --port 9000 \
  --vpc-id vpc-07de5077a86cac33f \
  --target-type ip
# → arn:.../targetgroup/tutum-sonarqube-tg/0e8518fdf7090b28

# 3. EC2 IP 타겟 등록
aws elbv2 register-targets \
  --target-group-arn "arn:.../tutum-sonarqube-tg/..." \
  --targets Id=10.60.11.95,Port=9000

# 4. ALB 리스너 룰 추가 (priority 10)
aws elbv2 create-rule \
  --listener-arn "arn:.../listener/...443..." \
  --priority 10 \
  --conditions '[{"Field":"host-header","HostHeaderConfig":{"Values":["sonar.tutum.my"]}}]' \
  --actions '[{"Type":"forward","TargetGroupArn":"arn:.../tutum-sonarqube-tg/..."}]'

# 5. Route53 A alias 레코드
# sonar.tutum.my → k8s-tutumstg-522ae53287-...(ALB DNS)
```

---

## 3. 작업 중 발생 이슈 및 대응

### 이슈 1: `docker compose` 명령 없음

- **원인**: monitoring EC2의 Docker 버전이 compose v2 plugin 미포함 (구버전)
- **대응**: `docker-compose` (v1, 하이픈 방식) 사용

### 이슈 2: SSM 명령 쿼팅 오류

- **원인**: SSM JSON 파라미터에서 `sed` + 특수문자 이스케이프 충돌
- **대응**: `head -n / tail -n +` 조합으로 볼륨 섹션 삽입

### 이슈 3: health-check-path Windows 경로 변환

- **원인**: Git Bash가 `/api/system/status`를 `C:/Program Files/Git/api/...`로 변환
- **대응**: `//api/system/status` (앞에 `/` 추가)로 우회

---

## 4. 결과

| 검증 항목 | 명령/엔드포인트 | 결과 |
|-----------|----------------|------|
| SonarQube 기동 | `docker logs sonarqube \| grep "is operational"` | `SonarQube is operational` ✅ |
| ALB health check | `aws elbv2 describe-target-health --target-group-arn ...` | `healthy` ✅ |
| HTTPS 접근 | `curl -o /dev/null -w "%{http_code}" https://sonar.tutum.my` | `200` ✅ |
| 초기 로그인 | `https://sonar.tutum.my` → admin / admin | 로그인 후 비밀번호 변경 필요 |

---

## 5. 커밋 로그

```bash
git log --oneline -5
```

```
c4da823 docs: rewrite kiali+s3 dev log to match DEV_LOGS_GUIDE format
07a3a83 Merge branch 'develop' of gitlab.com:tutum-project/.../backend into develop
b2f3d73 docs: add dev log for D-4 MinIO→S3 and D-7 Kiali installation
```

> docker-compose.yml은 monitoring EC2 로컬 파일 변경 (git 추적 대상 아님)

---

## 6. 후속 작업/리스크

- **SonarQube admin 비밀번호 변경**: 초기값 `admin/admin` → 즉시 변경 필요
- **GitLab CI 연동**: `.gitlab-ci.yml`에 `sonar-scanner` 스테이지 추가 (SONAR_TOKEN, SONAR_HOST_URL 설정)
- **메모리 부족 리스크**: EC2 t3.medium (3.7GB), SonarQube + 기존 LGTM 스택 동시 운영 → 메모리 사용량 모니터링 필요
- **D-8 Terraform IaC**: 다음 작업
- **sonar.tutum.my 접근 제어**: 현재 퍼블릭 오픈 상태 → IP 제한 또는 SonarQube 자체 인증으로 관리
