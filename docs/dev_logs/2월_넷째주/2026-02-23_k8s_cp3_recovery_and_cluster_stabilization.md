# 2026-02-23 K8S cp3 복구 및 클러스터 안정화 트러블슈팅

## 1. 장애 요약
- 현상: `cp-3`의 Control Plane(`etcd`, `kube-apiserver`)가 CrashLoop 상태로 불안정했고, 이후 Calico/Typha 통신 문제로 `CoreDNS`까지 연쇄 장애 발생.
- 영향: API 응답 불안정, 노드 `NotReady` 반복, CNI 비정상으로 DNS/네트워크 기능 저하.
- 최종 상태: `cp-1`, `cp-3`, `worker2`, `worker3` 모두 `Ready`, `etcd` 2멤버 정상, `calico` `AVAILABLE=True`, `CoreDNS` `Running`.

## 2. 관찰된 핵심 증상
- `cp-3`가 `INTERNAL-IP=10.0.2.15`(NAT)로 등록되어 Control Plane static pod 인증서/광고 주소와 실제 운영망이 불일치.
- `cp-3`의 `etcd-cp-3`, `kube-apiserver-cp-3`가 반복 CrashLoop.
- `kubeadm join --control-plane` 단계에서 `etcdserver: can only promote a learner member which is in sync with leader` 발생.
- Calico degraded 및 `calico-node`에서 Typha(`192.168.0.222:5473`) timeout.
- `CoreDNS` CrashLoopBackOff.

## 3. 근본 원인
1. 네트워크 기준 혼재
- Host-Only 대역(`192.168.56.0/24`) 기준 방화벽/운영 흔적이 남아 브릿지 대역(`192.168.0.0/24`)과 충돌.

2. cp3 설정 드리프트
- cp3가 NAT IP(`10.0.2.15`)를 기준으로 kubeadm/인증서가 생성되어 Control Plane peer 통신 불일치.

3. 방화벽 누락
- cp3 UFW에 브릿지 대역 허용이 부족했고, 특히 Typha 포트 `5473/tcp` 미허용으로 CNI 연쇄 장애 유발.

4. 재조인 중 learner 잔존
- 실패한 control-plane join 시도 흔적으로 etcd learner 멤버가 남아 다음 조인 시도에서 promote 실패.

## 4. 해결 과정(실행 순서)
1. cp3 상태 확인
- `ip -4 -brief a`로 `enp0s3=10.0.2.15`, `enp0s8=192.168.0.222` 확인.
- static pod manifest에서 `10.0.2.15` 하드코딩 확인.

2. cp1에서 복구 준비
- 신규 join token/CA hash/certificate key 발급.
- 기존 `cp-3` 노드 객체 정리.

3. cp3 초기화 및 재조인
- `kubeadm reset -f`, CNI 흔적 정리, kubelet args 정리 후
- `kubeadm join ... --control-plane --apiserver-advertise-address 192.168.0.222 --node-name cp-3` 재실행.

4. etcd learner 장애 해소
- cp1 etcd member list 확인 후 stale learner 제거.
- 재조인 재시도하여 cp3 control-plane 정상 편입.

5. UFW 규칙 브릿지 기준으로 보정
- cp3에 `192.168.0.0/24` 기준으로 `2379-2380`, `10250`, `10257`, `10259`, `179`, `4789/udp`, `7946/tcp,udp` 허용.
- 추가로 `5473/tcp` 허용(누락 핵심 포트).

6. CNI/DNS 안정화
- Typha pod 재기동 후 Calico 정상화 확인.
- `CoreDNS` Running 회복 확인.

## 5. 최종 검증 결과
- `kubectl get nodes -o wide`
  - `cp-1 Ready control-plane`
  - `cp-3 Ready control-plane`
  - `worker2 Ready`
  - `worker3 Ready`
- `kubectl get pods -n kube-system -o wide`
  - `etcd-cp-1`, `etcd-cp-3`, `kube-apiserver-cp-1`, `kube-apiserver-cp-3` 모두 Running.
  - `coredns` 2개 Running.
- `kubectl get tigerastatus`
  - `calico AVAILABLE=True`.

## 6. 역할/영역별 원인 기여도(과실 분석 대체)
> 주의: 개인 비난/인사 판단용 과실률이 아니라, 재발 방지용 기술 원인 기여도입니다.

### 노드 담당자 현황
| 노드 | 담당자 | 역할 |
|---|---|---|
| `cp-1` | 서버컴 | Control Plane (복구 작업 기준 노드) |
| `cp-2` | 박성준 | Control Plane |
| `cp-3` | 김루비 | Control Plane (이번 장애 발생 노드) |
| `worker-1` | 김경윤 | Worker / MongoDB |
| `worker-2` | 김정호 | Worker |
| `worker-3` | 김정호 | Worker |

### 원인 기여도

- **노드 표준화/이미지 관리(설정 드리프트): 35%**
  - 담당: 김루비 (`cp-3`)
  - `cp-3`가 NAT IP(`10.0.2.15`) 기준으로 kubeadm/인증서가 생성되어 브릿지 운영망과 불일치.

- **네트워크/보안 정책 관리(UFW 정책 갱신 누락): 35%**
  - 담당: 김루비 (`cp-3`)
  - 브릿지 대역(`192.168.0.0/24`) 전환 후 UFW 규칙 미갱신, `5473/tcp`(Typha) 누락으로 CNI 연쇄 장애 유발.

- **클러스터 조인 절차 관리(learner 잔존 처리 누락): 20%**
  - 담당: 서버컴 (`cp-1`, 복구 작업 실행 측)
  - 조인 실패 후 etcd learner 멤버 청소 없이 재시도하여 promote 실패 반복. 복구 절차 미내재화.

- **문서/체크리스트 운영(사전 점검 항목 부족): 10%**
  - 담당: 전체 팀 공통
  - 조인 전 필수 체크(`node-ip`, UFW 포트, etcd member clean-up) 자동 검증 부재.

## 7. 액션 오너 지정
- `cp-3` 설정 정비: **김루비**
  - `node-ip`, 인증서 advertise 주소, UFW 규칙 브릿지 기준 재점검.
- 조인 절차 runbook 보강: **서버컴**
  - join 실패 시 `etcd member list → stale learner remove` 절차 명문화.
- UFW 표준 템플릿 통일: **전체 CP 담당자 공동** (서버컴, 박성준, 김루비)
- worker 노드 상태 모니터링: **김정호**, **김경윤**

## 8. 재발 방지 액션
1. `kubeadm join` 전 공통 체크 스크립트 추가
- `ip a`, `kubelet --node-ip`, `ufw required ports`, `containerd version` 검증.

2. UFW 표준 템플릿 통일
- Host-Only/Bridge 혼용 금지, 운영망(`192.168.0.0/24`) 기준 규칙을 문서/스크립트 동시 관리.

3. 장애 복구 표준화
- join 실패 시 `etcd member list -> stale learner remove` 절차를 runbook에 명시.

4. 버전 정합성 점검
- 현재 cp3 runtime이 `containerd://2.2.1`로 이질적이므로, 유지/다운그레이드 기준 확정 후 통일.
