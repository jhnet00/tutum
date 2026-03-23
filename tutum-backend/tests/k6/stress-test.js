/**
 * Stress Test — KEDA 오토스케일링 유발 테스트
 * 점진적으로 VU 증가 → KEDA scale-up 확인
 * 목적: backend ScaledObject (min:2, max:5) 동작 검증
 *
 * 실행: k6 run stress-test.js
 * InfluxDB 연동: k6 run --out influxdb=http://k6:tutumk6pass@192.168.0.230:8086/k6 stress-test.js
 *
 * 실행 중 별도 터미널에서 확인:
 *   watch kubectl get pods -n tutum-app
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = 'http://192.168.0.240';
const errorRate = new Rate('error_rate');

export const options = {
  stages: [
    { duration: '30s', target: 20  },   // warm-up
    { duration: '1m',  target: 80  },   // 증가
    { duration: '1m',  target: 120 },   // 피크 — KEDA scale-up 유발
    { duration: '2m',  target: 120 },   // 유지 — 최대 파드 수 확인
    { duration: '1m',  target: 0   },   // ramp-down — KEDA scale-down 대기
  ],
  thresholds: {
    http_req_failed:   ['rate<0.10'],   // 스트레스 테스트 — 10% 허용
    http_req_duration: ['p(95)<5000'],
    error_rate:        ['rate<0.10'],
  },
};

export default function () {
  // health 엔드포인트에 집중 부하
  const res = http.get(`${BASE_URL}/api/health`);
  check(res, {
    'status 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  // news API도 포함 (backend 실제 처리 부하)
  const news = http.get(`${BASE_URL}/api/v1/news`);
  check(news, {
    'news ok': (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(0.1);
}
