#!/usr/bin/env python3
"""Grafana dashboard import script for CloudDX LGTM stack."""
import json, subprocess, sys

GRAFANA_URL = "http://localhost:3000"
AUTH = "admin:tutum2026!"
MIMIR_UID = "PAE45454D0EDB9216"
LOKI_UID = "P8E80F9AEF21F6940"

dashboards = [
    (1860, "Node Exporter Full", "DS_PROMETHEUS", "prometheus", MIMIR_UID),
    (15520, "Kubernetes Cluster", "DS_PROMETHEUS", "prometheus", MIMIR_UID),
    (15760, "Kubernetes Pods", "DS_PROMETHEUS", "prometheus", MIMIR_UID),
    (7639, "Istio Mesh Dashboard", "DS_PROMETHEUS", "prometheus", MIMIR_UID),
    (13639, "Loki Logs", "DS_LOKI", "loki", LOKI_UID),
]

for gnet_id, name, ds_name, ds_plugin, ds_uid in dashboards:
    print("=== Importing: {} (ID: {}) ===".format(name, gnet_id))

    # Download dashboard JSON from grafana.com
    r = subprocess.run(
        ["curl", "-sf", "https://grafana.com/api/dashboards/{}/revisions/latest/download".format(gnet_id)],
        capture_output=True, text=True, timeout=30
    )
    if r.returncode != 0:
        print("  [FAIL] Download failed")
        continue

    try:
        dash = json.loads(r.stdout)
    except Exception as e:
        print("  [FAIL] Invalid JSON: {}".format(e))
        continue

    # Build import payload
    payload = {
        "dashboard": dash,
        "overwrite": True,
        "inputs": [{"name": ds_name, "type": "datasource", "pluginId": ds_plugin, "value": ds_uid}],
        "folderId": 0
    }

    # Write payload to temp file (dashboard JSON can be very large)
    payload_file = "/tmp/import-{}.json".format(gnet_id)
    with open(payload_file, "w") as f:
        json.dump(payload, f)

    # Import via Grafana API using file reference
    r2 = subprocess.run(
        ["curl", "-sf", "-u", AUTH, "-X", "POST",
         "{}/api/dashboards/import".format(GRAFANA_URL),
         "-H", "Content-Type: application/json",
         "-d", "@{}".format(payload_file)],
        capture_output=True, text=True, timeout=30
    )

    try:
        result = json.loads(r2.stdout)
        slug = result.get("slug", "imported")
        uid = result.get("uid", "unknown")
        print("  [OK] {} (uid: {})".format(slug, uid))
    except Exception:
        output = r2.stdout[:200] if r2.stdout else "no output"
        print("  [RESULT] {}".format(output))
        if r2.stderr:
            print("  [ERR] {}".format(r2.stderr[:200]))

print("\n=== Import Complete ===")
