# 온프레미스 VM -> AWS 마이그레이션 현황 정리 (2026-03-12)

## 목적
- 기존 온프레미스 VM 8대에 SSH 접속해 현재 실제 역할을 확인한다.
- 각 VM이 담당하던 기능이 AWS의 어느 리소스로 이전되었는지 매핑한다.
- 지금 시점에 어떤 VM을 종료하면 안 되는지 판단 근거를 남긴다.

## 조사 범위
- 조사 시각: 2026-03-12 KST
- 온프레미스 접속 대상: `cp1`, `cp2`, `cp3`, `w1`, `w2`, `w3`, `mon`, `mongo`
- 온프레미스 확인 명령
  - `kubectl get nodes -o wide`
  - `kubectl get pods -A -o wide`
  - `kubectl get svc -A`
  - `docker ps`
  - `mongosh --eval 'db.runCommand({ ping: 1 })'`
- AWS 확인 명령
  - `aws eks list-clusters --region ap-northeast-2`
  - `kubectl config current-context`
  - `kubectl get nodes -o wide`
  - `kubectl get pods -A -o wide`
  - `aws rds describe-db-instances --region ap-northeast-2`
  - `aws ec2 describe-instances --region ap-northeast-2`
  - `aws s3api list-buckets`

## 조사 한계
- 온프레미스 VM에서 `sudo` 암호는 없어서 root 전용 설정 파일까지는 직접 열람하지 못했다.
- 따라서 이 문서는 사용자 권한으로 확인 가능한 활성 서비스, 컨테이너, 쿠버네티스 파드 기준으로 작성했다.
- 종료 판단은 현재 관찰 가능한 live 상태 기준이며, 숨겨진 cron 또는 외부 클라이언트 연결은 별도 추적이 필요하다.

## 2026-03-13 재검증 메모
- 사용자 요청으로 전원 상태를 다시 확인한 결과 `cp-1`, `cp-2`, `cp-3`, `worker1`, `worker2`, `worker3`, `monitoring`, `mongodb` 8대 모두 `ping-up` 상태였다.
- NAT/SSH 포트(`2220~2230`)도 모두 `tcp-open`으로 확인됐다.
- 다만 현재 셸에는 올바른 SSH 인증키가 없어 `ssh` 인증은 실패했다. 따라서 2026-03-13 확인은 네트워크 reachability 기준이다.
- 본 문서의 상세 역할 표는 2026-03-12 SSH 감사 결과를 유지하되, 전원 상태 관련 판단은 2026-03-13 재검증 결과를 우선한다.

## 한눈에 보는 결론
- AWS 이전은 상당 부분 진행됐지만, 온프레미스 VM을 지금 한 번에 모두 끄는 단계는 아니다.
- 현재 AWS에서 실제로 확인된 주요 대응 리소스는 아래와 같다.

| 기능 | 현재 AWS 리소스 | 확인 결과 |
|------|------------------|-----------|
| Kubernetes 클러스터 | `tutum-stg-eks`, `tutum-prd-eks` | `aws eks list-clusters` 확인 |
| 앱/데이터 워크로드 | `tutum-stg-eks` EKS 노드 19대 | `kubectl get nodes -o wide` 확인 |
| MariaDB | RDS `tutum-mariadb` | `available` |
| 모니터링 저장소 | EC2 `tutum-monitoring` (`10.60.11.95`, `t3.medium`) | `running` |
| 객체 스토리지 | S3 `tutum-prod-storage` | bucket 확인 |
| MongoDB 앱 정본 | EKS `tutum-data/mongodb-0~2` | `backend/auth/ocr` cutover 후 live pod 확인 |
| Kafka | EKS `tutum-data/kafka-0~2` | live pod 확인 |
| Elasticsearch | EKS `tutum-data/elasticsearch-0` | live pod 확인 |

## VM별 역할 / AWS 매핑 / 종료 판단

| VM | IP | 현재 온프레미스에서 확인된 역할 | 현재 AWS 대응 리소스 | 마이그레이션 판단 | 종료 판단 |
|----|----|------------------------------|----------------------|------------------|-----------|
| `cp1` | `192.168.0.220` | kubeadm control-plane 1. `kubelet`, `containerd` active. `etcd-cp-1`, `kube-apiserver-cp-1`, `kube-controller-manager-cp-1`, `kube-scheduler-cp-1`, `coredns` 등 control-plane 핵심 파드 실행 | EKS 관리형 control plane + EKS worker fleet | 부분 완료. AWS EKS control plane은 존재하지만, 온프레미스 control plane도 아직 live cluster를 유지 중 | 즉시 종료 금지 |
| `cp2` | `192.168.0.221` | kubeadm control-plane 2. `kubelet`, `containerd` active. `etcd-cp-2`, `kube-apiserver-cp-2`, `kube-scheduler-cp-2`와 `tigera-operator`, `calico-typha` 등 클러스터 운영 파드 실행 | EKS 관리형 control plane + AWS 네트워크/CNI 기반 클러스터 | 부분 완료. AWS 쪽 대체 수단은 있으나 온프레미스 클러스터 자체는 아직 동작 중 | 즉시 종료 금지 |
| `cp3` | `192.168.0.222` | kubeadm control-plane 3. `kubelet`, `containerd` active. `etcd-cp-3`, `kube-apiserver-cp-3` 외에 `monitoring/alloy`, MetalLB speaker 등 일부 운영 파드 배치 | EKS 관리형 control plane + EKS Alloy DaemonSet | 부분 완료. AWS 대응은 존재하지만 온프레미스 control plane 제거 전 상태 아님 | 즉시 종료 금지 |
| `w1` | `192.168.0.223` | 앱/데이터/스토리지 worker. `sonarqube-sonarqube-0`, `elastic-consumer`, `kafka-1`, `mongodb-2`, `redis-2`, `minio-1` 실행 | EKS `tutum-app`, `tutum-data`에 대응 워크로드 존재. SonarQube는 AWS monitoring EC2 + `sonar.tutum.my` 경로 확인 | 부분 완료. 앱/데이터 일부는 AWS에 있음. MinIO 잔여 의존은 온프레미스에 남음 | 즉시 종료 금지 |
| `w2` | `192.168.0.224` | 가장 많은 infra/app/data 파드가 집중된 worker. `argocd`, `cert-manager`, `istiod`, `keda`, `kyverno`, `backend` 이력 파드, `ocr`, `price-producer`, `cloudflared`, `kafka-0`, `mongodb-0`, `redis-1`, `minio-0`, `minio-3` 등 실행 | AWS EKS에 ArgoCD, Istio, KEDA, Kyverno, backend, ocr, Kafka, MongoDB, Redis가 모두 존재 | 부분 완료. AWS 대응은 많지만 온프레미스에서도 아직 같은 기능이 live | 즉시 종료 금지 |
| `w3` | `192.168.0.225` | ingress/app/data worker. `istio-ingressgateway`, `argocd-server`, `gitlab-runner`, `backend`, `frontend`, `email-worker`, `cloudflared`, `elasticsearch-0`, `kafka-2`, `mongodb-1`, `redis-0`, `sonarqube-postgresql-0`, `minio-2` 실행 | AWS EKS에 ingress, app, GitLab Runner, Elasticsearch, Kafka, MongoDB, Redis 대응 워크로드 존재 | 부분 완료. SonarQube AWS 경로는 확인됐지만 cloudflared와 일부 온프레미스 ingress 경로는 아직 잔존 | 즉시 종료 금지 |
| `mon` | `192.168.0.230` | 별도 monitoring VM. `docker` active. `grafana`, `loki`, `tempo`, `mimir`, `kiali`, `influxdb` 컨테이너 실행 | AWS EC2 `tutum-monitoring` (`10.60.11.95`, `t3.medium`)에서 LGTM stack 운영 중 | 대부분 완료. AWS monitoring EC2는 확인됐지만 온프레미스 monitoring VM도 아직 실행 중 | 조건부 종료 가능. Alloy/로그/트레이스 대상이 모두 AWS EC2를 보는지 재검증 후 종료 |
| `mongo` | `192.168.0.231` | standalone legacy MongoDB VM. `mongod` active, `mongosh ping` 성공 | AWS EKS `tutum-data/mongodb-0~2` ReplicaSet이 현재 앱 기준 Mongo 정본 역할 | 대부분 완료. 앱 경로는 AWS EKS Mongo로 옮겼지만 legacy VM 접속자 추적 전 | 조건부 종료 가능. hidden client/백업 경로 점검 후 종료 |

## 기능 단위 매핑 표

| 기존 온프레미스 기능 | 온프레미스 실제 위치 | 현재 AWS 대응 리소스 | 상태 | 남은 이슈 |
|----------------------|----------------------|----------------------|------|-----------|
| Kubernetes control plane | `cp1`, `cp2`, `cp3` kubeadm control-plane | EKS 관리형 control plane | 부분 완료 | 온프레미스 kubeadm 클러스터가 아직 live |
| 앱 워크로드 (`frontend`, `backend`, `auth`, `ocr`, workers) | 주로 `w2`, `w3` | EKS `tutum-app` namespace | 대부분 완료 | 온프레미스에 중복 워크로드와 old rollout 파드 잔존 |
| ArgoCD | `w2`, `w3` | EKS `argocd` namespace | 완료에 가까움 | 온프레미스 ArgoCD 정리 필요 |
| GitLab Runner | `w3` | EKS `gitlab-runner` namespace | 부분 완료 | 온프레미스 runner 정리 기준 수립 필요 |
| SonarQube | `w1`, `w3` | AWS monitoring EC2 `10.60.11.95:9000` + `sonar.tutum.my` | 대부분 완료 | GitLab CI Sonar 실행 검증, external target registration 자동화 필요 |
| Istio ingress / 내부 진입점 | `w3` + on-prem MetalLB `192.168.0.240` | AWS ALB + EKS ingress | 부분 완료 | on-prem `cloudflared`가 아직 실행 중 |
| Monitoring LGTM | `mon` VM Docker Compose | AWS EC2 `tutum-monitoring` | 대부분 완료 | traces/lag 후속과 온프레미스 monitoring 종료 검증 필요 |
| MongoDB 앱 DB | legacy `mongo` VM + on-prem K8s `mongodb-0~2` | EKS `tutum-data/mongodb-0~2` | 대부분 완료 | legacy VM과 on-prem Mongo StatefulSet 정리 필요 |
| MariaDB | 학원 외부 DB | RDS `tutum-mariadb` | 완료 | 앱 경로는 RDS 사용 중 |
| Redis | on-prem K8s `redis-0~2` | EKS `tutum-data/redis-0~2` | 완료에 가까움 | 온프레미스 Redis 종료 시점만 남음 |
| Kafka | on-prem K8s `kafka-0~2` | EKS `tutum-data/kafka-0~2` | 대부분 완료 | 가이드상 장기 목표는 Kafka EC2 이전, 온프레미스 브로커 정리 필요 |
| Elasticsearch | on-prem K8s `elasticsearch-0` | EKS `tutum-data/elasticsearch-0` | 부분 완료 | 복원/검증 기준 문서상 후속 작업 남음 |
| 객체 스토리지 | on-prem K8s `minio-0~3` | S3 `tutum-prod-storage` | 부분 완료 | MinIO 잔여 데이터 mirror와 최종 정리 미완 |

## 지금 바로 꺼도 되는가?
아니다. 현재 관찰 결과만으로는 아래 이유 때문에 전체 VM 종료는 위험하다.

1. 온프레미스 kubeadm 클러스터 자체가 아직 Ready 상태다.
2. `worker1~3`에 app/data/storage/infra 파드가 실제로 계속 실행 중이다.
3. `cloudflared`, `sonarqube`, `minio`, legacy Mongo, on-prem monitoring처럼 정리되지 않은 경로가 남아 있다.
4. 일부 기능은 AWS에 대응 리소스가 있어도 온프레미스와 병행 운영 중이다.

## 종료 우선순위 제안

| 순서 | 대상 | 선행 조건 | 비고 |
|------|------|-----------|------|
| 1 | `mongo` | legacy VM 접속자, 백업 스크립트, 배치/cron, 외부 앱 연결 여부 확인 | 앱 정본은 AWS EKS Mongo로 전환됐지만 hidden client audit 필요 |
| 2 | `mon` | Alloy/로그/트레이스가 모두 AWS `tutum-monitoring`만 바라보는지 확인 | AWS monitoring EC2는 이미 live |
| 3 | on-prem `cloudflared` | DNS/ALB/Route53/ACM 경로만으로 서비스 진입 가능 확인 | 현재 `w2`, `w3`에 pod 잔존 |
| 4 | on-prem `minio` | S3 mirror 및 실제 업로드/다운로드 검증 완료 | object storage cutover 최종 마감 필요 |
| 5 | `worker1~3` | SonarQube, GitLab Runner, MinIO, 데이터 StatefulSet, ingress 등 잔존 워크로드 제거 후 drain | 이 단계 전에는 종료 금지 |
| 6 | `cp1~3` | 온프레미스 클러스터에 서비스 파드가 더 이상 없고, kubeadm cluster 폐기 계획 수립 완료 | 마지막 단계 |

## 현 시점 권고안
- 단기적으로는 `mongo`, `mon`, `cloudflared`, `minio`, `sonarqube`부터 개별 감사가 필요하다.
- 운영 관점에서는 "AWS에 동일 기능이 있다"와 "온프레미스를 꺼도 된다"를 분리해서 판단해야 한다.
- 현재 상태를 한 줄로 요약하면 아래와 같다.

> 핵심 서비스는 상당 부분 AWS로 올라왔지만, 온프레미스는 아직 철수 완료 단계가 아니라 병행 운영/잔존 의존 제거 단계다.

## 근거로 확인한 대표 명령 결과 요약
- 온프레미스 kubeadm 클러스터 노드: `cp-1`, `cp-2`, `cp-3`, `worker1`, `worker2`, `worker3` 모두 `Ready`
- 온프레미스 ingress: `istio-ingressgateway` LoadBalancer `192.168.0.240`
- 온프레미스 monitoring VM Docker 컨테이너: `grafana`, `loki`, `tempo`, `mimir`, `kiali`, `influxdb`
- 온프레미스 legacy Mongo VM: `mongod active`, `ping ok`
- AWS EKS 현재 context: `arn:aws:eks:ap-northeast-2:903913341620:cluster/tutum-stg-eks`
- AWS RDS: `tutum-mariadb` `available`
- AWS monitoring EC2: `tutum-monitoring` `10.60.11.95`
- AWS S3 bucket: `tutum-prod-storage`
