/**
 * Load Test — 일반 부하 테스트
 * Ramp-up 30s → 50 VUs 유지 2분 → Ramp-down 30s
 * 목적: 정상 트래픽 수준에서의 응답 시간 및 에러율 확인
 *
 * 실행: k6 run load-test.js
 * InfluxDB 연동: k6 run --out influxdb=http://k6:tutumk6pass@192.168.0.230:8086/k6 load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = 'http://192.168.0.240';
const errorRate = new Rate('error_rate');
const newsDuration = new Trend('news_duration');
const healthDuration = new Trend('health_duration');

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // ramp-up
    { duration: '2m',  target: 50 },   // 정상 부하
    { duration: '30s', target: 0 },    // ramp-down
  ],
  thresholds: {
    http_req_failed:   ['rate<0.05'],       // 에러율 5% 미만
    http_req_duration: ['p(95)<3000'],      // 95th percentile 3초 미만
    http_req_duration: ['p(99)<5000'],      // 99th percentile 5초 미만
    news_duration:     ['p(95)<3000'],
    error_rate:        ['rate<0.05'],
  },
};

export default function () {
  group('Health', () => {
    const res = http.get(`${BASE_URL}/api/health`);
    healthDuration.add(res.timings.duration);
    check(res, {
      'health 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  sleep(0.5);

  group('News API', () => {
    const res = http.get(`${BASE_URL}/api/v1/news`, {
      tags: { name: 'news_list' },
    });
    newsDuration.add(res.timings.duration);
    check(res, {
      'news 200': (r) => r.status === 200,
      'news response time < 3s': (r) => r.timings.duration < 3000,
    }) || errorRate.add(1);
  });

  sleep(0.5);

  group('Frontend', () => {
    const res = http.get(`${BASE_URL}/`, {
      tags: { name: 'frontend_home' },
    });
    check(res, {
      'frontend 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  sleep(1);
}
