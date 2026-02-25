#!/usr/bin/env python3
"""Update Loki datasource with Tempo trace linking."""
import json, subprocess

GRAFANA_URL = "http://localhost:3000"
AUTH = "admin:tutum2026!"

payload = {
    "id": 2,
    "uid": "P8E80F9AEF21F6940",
    "orgId": 1,
    "name": "Loki",
    "type": "loki",
    "access": "proxy",
    "url": "http://loki:3100",
    "isDefault": False,
    "basicAuth": False,
    "version": 1,
    "jsonData": {
        "derivedFields": [
            {
                "datasourceUid": "tempo",
                "matcherRegex": "traceID=(\\w+)",
                "name": "TraceID",
                "url": "${__value.raw}"
            },
            {
                "datasourceUid": "tempo",
                "matcherRegex": "trace_id=(\\w+)",
                "name": "TraceID2",
                "url": "${__value.raw}"
            }
        ]
    }
}

with open("/tmp/loki_ds_update.json", "w") as f:
    json.dump(payload, f)

r = subprocess.run(
    ["curl", "-s", "-u", AUTH, "-X", "PUT",
     "{}/api/datasources/2".format(GRAFANA_URL),
     "-H", "Content-Type: application/json",
     "-d", "@/tmp/loki_ds_update.json"],
    capture_output=True, text=True, timeout=15
)

try:
    result = json.loads(r.stdout)
    msg = result.get("message", result.get("name", "unknown"))
    print("Result: {}".format(msg))
except Exception:
    print("Raw: {}".format(r.stdout[:300]))
