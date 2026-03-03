/**
 * Smoke Test — 서비스 기본 동작 확인
 * VUs: 1, Duration: 30s
 * 목적: 배포 직후 주요 엔드포인트 응답 확인
 *
 * 실행: k6 run smoke-test.js
 * InfluxDB 연동: k6 run --out influxdb=http://k6:tutumk6pass@192.168.0.230:8086/k6 smoke-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = 'http://192.168.0.240';
const errorRate = new Rate('error_rate');

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],       // 에러율 1% 미만
    http_req_duration: ['p(95)<2000'],    // 95th percentile 2초 미만
    error_rate: ['rate<0.01'],
  },
};

export default function () {
  // 1. Health check
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, {
    'health status 200': (r) => r.status === 200,
    'health body ok': (r) => r.json('status') === 'alive',
  }) || errorRate.add(1);

  sleep(1);

  // 2. Frontend 홈
  const home = http.get(`${BASE_URL}/`);
  check(home, {
    'frontend status 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(1);

  // 3. 뉴스 목록 (공개 API)
  const news = http.get(`${BASE_URL}/api/v1/news`);
  check(news, {
    'news status 200': (r) => r.status === 200,
    'news has items': (r) => r.json('items') !== null,
  }) || errorRate.add(1);

  sleep(1);
}
