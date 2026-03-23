#!/usr/bin/env python3
"""Setup Grafana alert rules for CloudDX LGTM stack."""
import json, subprocess

GRAFANA_URL = "http://localhost:3000"
AUTH = "admin:tutum2026!"
MIMIR_UID = "PAE45454D0EDB9216"

# First, create an alert folder
folder_payload = {"title": "CloudDX Alerts"}
with open("/tmp/alert_folder.json", "w") as f:
    json.dump(folder_payload, f)

r = subprocess.run(
    ["curl", "-s", "-u", AUTH, "-X", "POST",
     "{}/api/folders".format(GRAFANA_URL),
     "-H", "Content-Type: application/json",
     "-d", "@/tmp/alert_folder.json"],
    capture_output=True, text=True, timeout=15
)
try:
    folder = json.loads(r.stdout)
    folder_uid = folder.get("uid", "")
    print("Folder: {} (uid: {})".format(folder.get("title", "?"), folder_uid))
except Exception:
    # Folder might already exist
    print("Folder result: {}".format(r.stdout[:200]))
    folder_uid = ""

# If folder already exists, get its UID
if not folder_uid:
    r = subprocess.run(
        ["curl", "-s", "-u", AUTH,
         "{}/api/folders".format(GRAFANA_URL)],
        capture_output=True, text=True, timeout=15
    )
    folders = json.loads(r.stdout)
    for f in folders:
        if f.get("title") == "CloudDX Alerts":
            folder_uid = f["uid"]
            print("Found existing folder: {}".format(folder_uid))
            break

if not folder_uid:
    folder_uid = "clouddx-alerts"
    print("Using default folder uid")

# Define alert rules
alert_rules = {
    "name": "tutum-alerts",
    "interval": "1m",
    "orgId": 1,
    "rules": [
        {
            "annotations": {
                "summary": "Backend pod is down"
            },
            "condition": "C",
            "data": [
                {
                    "refId": "A",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": MIMIR_UID,
                    "model": {
                        "expr": "sum(up{namespace=~\"tutum-app|tutum-prod-app\", app=\"backend\"}) < 1",
                        "refId": "A"
                    }
                },
                {
                    "refId": "C",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": "__expr__",
                    "model": {
                        "conditions": [
                            {
                                "evaluator": {"params": [0], "type": "gt"},
                                "operator": {"type": "and"},
                                "query": {"params": ["A"]},
                                "reducer": {"params": [], "type": "last"},
                                "type": "query"
                            }
                        ],
                        "refId": "C",
                        "type": "classic_conditions"
                    }
                }
            ],
            "for": "1m",
            "grafana_alert": {
                "title": "BackendDown",
                "condition": "C",
                "no_data_state": "OK",
                "exec_err_state": "OK"
            },
            "labels": {"severity": "critical"}
        },
        {
            "annotations": {
                "summary": "High error rate detected (5xx > 5%)"
            },
            "condition": "C",
            "data": [
                {
                    "refId": "A",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": MIMIR_UID,
                    "model": {
                        "expr": "(sum(rate(http_requests_total{namespace=~\"tutum-app|tutum-prod-app\",status=~\"5..\"}[5m])) / clamp_min(sum(rate(http_requests_total{namespace=~\"tutum-app|tutum-prod-app\"}[5m])), 1)) > 0.05 and sum(rate(http_requests_total{namespace=~\"tutum-app|tutum-prod-app\"}[5m])) > 1",
                        "refId": "A"
                    }
                },
                {
                    "refId": "C",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": "__expr__",
                    "model": {
                        "conditions": [
                            {
                                "evaluator": {"params": [0], "type": "gt"},
                                "operator": {"type": "and"},
                                "query": {"params": ["A"]},
                                "reducer": {"params": [], "type": "last"},
                                "type": "query"
                            }
                        ],
                        "refId": "C",
                        "type": "classic_conditions"
                    }
                }
            ],
            "for": "5m",
            "grafana_alert": {
                "title": "HighErrorRate",
                "condition": "C",
                "no_data_state": "OK",
                "exec_err_state": "OK"
            },
            "labels": {"severity": "critical"}
        },
        {
            "annotations": {
                "summary": "Kafka consumer lag is high (>1000)"
            },
            "condition": "C",
            "data": [
                {
                    "refId": "A",
                    "queryType": "",
                    "relativeTimeRange": {"from": 600, "to": 0},
                    "datasourceUid": MIMIR_UID,
                    "model": {
                        "expr": "kafka_consumer_group_lag > 1000",
                        "refId": "A"
                    }
                },
                {
                    "refId": "C",
                    "queryType": "",
                    "relativeTimeRange": {"from": 600, "to": 0},
                    "datasourceUid": "__expr__",
                    "model": {
                        "conditions": [
                            {
                                "evaluator": {"params": [0], "type": "gt"},
                                "operator": {"type": "and"},
                                "query": {"params": ["A"]},
                                "reducer": {"params": [], "type": "last"},
                                "type": "query"
                            }
                        ],
                        "refId": "C",
                        "type": "classic_conditions"
                    }
                }
            ],
            "for": "10m",
            "grafana_alert": {
                "title": "KafkaConsumerLag",
                "condition": "C",
                "no_data_state": "OK",
                "exec_err_state": "OK"
            },
            "labels": {"severity": "warning"}
        },
        {
            "annotations": {
                "summary": "Redis memory usage is high (>80%)"
            },
            "condition": "C",
            "data": [
                {
                    "refId": "A",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": MIMIR_UID,
                    "model": {
                        "expr": "(redis_memory_max_bytes{namespace=\"tutum-data\"} > 0) and ((redis_memory_used_bytes{namespace=\"tutum-data\"} / redis_memory_max_bytes{namespace=\"tutum-data\"}) > 0.8)",
                        "refId": "A"
                    }
                },
                {
                    "refId": "C",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": "__expr__",
                    "model": {
                        "conditions": [
                            {
                                "evaluator": {"params": [0], "type": "gt"},
                                "operator": {"type": "and"},
                                "query": {"params": ["A"]},
                                "reducer": {"params": [], "type": "last"},
                                "type": "query"
                            }
                        ],
                        "refId": "C",
                        "type": "classic_conditions"
                    }
                }
            ],
            "for": "5m",
            "grafana_alert": {
                "title": "RedisMemoryHigh",
                "condition": "C",
                "no_data_state": "OK",
                "exec_err_state": "OK"
            },
            "labels": {"severity": "warning"}
        },
        {
            "annotations": {
                "summary": "High latency detected (P95 > 500ms)"
            },
            "condition": "C",
            "data": [
                {
                    "refId": "A",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": MIMIR_UID,
                    "model": {
                        "expr": "histogram_quantile(0.95, sum by (le, namespace) (rate(http_request_duration_seconds_bucket{namespace=~\"tutum-app|tutum-prod-app\"}[5m]))) > 0.5 and on(namespace) sum by (namespace) (rate(http_request_duration_seconds_count{namespace=~\"tutum-app|tutum-prod-app\"}[5m])) > 1",
                        "refId": "A"
                    }
                },
                {
                    "refId": "C",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": "__expr__",
                    "model": {
                        "conditions": [
                            {
                                "evaluator": {"params": [0], "type": "gt"},
                                "operator": {"type": "and"},
                                "query": {"params": ["A"]},
                                "reducer": {"params": [], "type": "last"},
                                "type": "query"
                            }
                        ],
                        "refId": "C",
                        "type": "classic_conditions"
                    }
                }
            ],
            "for": "5m",
            "grafana_alert": {
                "title": "HighLatency",
                "condition": "C",
                "no_data_state": "OK",
                "exec_err_state": "OK"
            },
            "labels": {"severity": "warning"}
        },
        {
            "annotations": {
                "summary": "Node disk usage is high (>85%)"
            },
            "condition": "C",
            "data": [
                {
                    "refId": "A",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": MIMIR_UID,
                    "model": {
                        "expr": "(1 - (node_filesystem_avail_bytes{mountpoint=\"/\",fstype!~\"tmpfs|squashfs|overlay|nsfs|ramfs|autofs|proc|sysfs|cgroup2fs\"} / node_filesystem_size_bytes{mountpoint=\"/\",fstype!~\"tmpfs|squashfs|overlay|nsfs|ramfs|autofs|proc|sysfs|cgroup2fs\"})) > 0.85 and on(instance,device,mountpoint) node_filesystem_readonly{mountpoint=\"/\"} == 0",
                        "refId": "A"
                    }
                },
                {
                    "refId": "C",
                    "queryType": "",
                    "relativeTimeRange": {"from": 300, "to": 0},
                    "datasourceUid": "__expr__",
                    "model": {
                        "conditions": [
                            {
                                "evaluator": {"params": [0], "type": "gt"},
                                "operator": {"type": "and"},
                                "query": {"params": ["A"]},
                                "reducer": {"params": [], "type": "last"},
                                "type": "query"
                            }
                        ],
                        "refId": "C",
                        "type": "classic_conditions"
                    }
                }
            ],
            "for": "5m",
            "grafana_alert": {
                "title": "NodeDiskFull",
                "condition": "C",
                "no_data_state": "OK",
                "exec_err_state": "OK"
            },
            "labels": {"severity": "warning"}
        }
    ]
}

# Post the alert rule group
payload = {
    "name": alert_rules["name"],
    "interval": alert_rules["interval"],
    "rules": alert_rules["rules"]
}

with open("/tmp/alert_rules.json", "w") as f:
    json.dump(payload, f)

print("\n=== Creating Alert Rules ===")
r = subprocess.run(
    ["curl", "-s", "-u", AUTH, "-X", "POST",
     "{}/api/v1/provisioning/alert-rules".format(GRAFANA_URL),
     "-H", "Content-Type: application/json",
     "-H", "X-Disable-Provenance: true",
     "-d", "@/tmp/alert_rules.json"],
    capture_output=True, text=True, timeout=15
)

# Try individual rule creation instead
print("Creating rules individually...")
for rule in alert_rules["rules"]:
    title = rule["grafana_alert"]["title"]

    rule_payload = {
        "title": title,
        "ruleGroup": "tutum-alerts",
        "folderUID": folder_uid,
        "condition": rule["condition"],
        "data": rule["data"],
        "for": rule["for"],
        "annotations": rule["annotations"],
        "labels": rule["labels"],
        "noDataState": rule["grafana_alert"]["no_data_state"],
        "execErrState": rule["grafana_alert"]["exec_err_state"],
        "orgId": 1
    }

    with open("/tmp/rule_{}.json".format(title), "w") as f:
        json.dump(rule_payload, f)

    r = subprocess.run(
        ["curl", "-s", "-u", AUTH, "-X", "POST",
         "{}/api/v1/provisioning/alert-rules".format(GRAFANA_URL),
         "-H", "Content-Type: application/json",
         "-H", "X-Disable-Provenance: true",
         "-d", "@/tmp/rule_{}.json".format(title)],
        capture_output=True, text=True, timeout=15
    )

    try:
        result = json.loads(r.stdout)
        if "uid" in result:
            print("  [OK] {} (uid: {})".format(title, result["uid"]))
        else:
            print("  [INFO] {}: {}".format(title, result.get("message", r.stdout[:150])))
    except Exception:
        print("  [RAW] {}: {}".format(title, r.stdout[:200]))

print("\n=== Alert Rules Setup Complete ===")
