#!/usr/bin/env python3
"""Update InfluxDB datasource with auth token."""
import json, subprocess

GRAFANA_URL = "http://localhost:3000"
AUTH = "admin:tutum2026!"

payload = {
    "id": 4,
    "uid": "P951FEA4DE68E13C5",
    "orgId": 1,
    "name": "InfluxDB",
    "type": "influxdb",
    "access": "proxy",
    "url": "http://influxdb:8086",
    "isDefault": False,
    "basicAuth": False,
    "version": 1,
    "jsonData": {
        "version": "Flux",
        "organization": "tutum",
        "defaultBucket": "k6"
    },
    "secureJsonData": {
        "token": "GSW6Ppk3SLDt5zM54jIXI1rrb0g4yU9mdMaMpIf342nV0S69NAO9a2cGdYclNUmeoMC32APrTlXbdxXVBXGQtg=="
    }
}

with open("/tmp/influxdb_ds.json", "w") as f:
    json.dump(payload, f)

r = subprocess.run(
    ["curl", "-s", "-u", AUTH, "-X", "PUT",
     "{}/api/datasources/4".format(GRAFANA_URL),
     "-H", "Content-Type: application/json",
     "-d", "@/tmp/influxdb_ds.json"],
    capture_output=True, text=True, timeout=15
)
print(r.stdout[:200])
