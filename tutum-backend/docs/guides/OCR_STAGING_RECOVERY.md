# OCR Staging Recovery

## Diagnosis

`/api/proxy/import/ocr` on `https://tutum.my` has two distinct failure modes:

1. `502 Bad Gateway` from `awselb/2.0`
   - Means the ALB route exists, but the `ocr` service has no healthy targets.
   - This is usually `deploy/ocr` scaled to `0` or an unhealthy `ocr` pod.

2. `403 Forbidden`
   - The OCR FastAPI service does not return `403`.
   - Storage migration from MinIO to S3 does not explain `403`; storage errors become `500/503`.
   - A `403` on this route is therefore a WAF/ALB policy block before the request reaches `ocr`.

## Why S3 Is Not The Root Cause

Files:
- [storage.py](/d:/dev/tutum-backend/backend/app/services/storage.py)
- [main.py](/d:/dev/tutum-backend/backend/app/ocr-api/ocr_app/main.py)

Behavior:
- S3 upload failure is wrapped as an exception and surfaced as `503 STORAGE_FAILURE` if strict mode is enabled.
- Otherwise the OCR service falls back to in-memory storage and continues processing.
- Neither path returns `403`.

## Live Routing Path

Files:
- [alb-ingress.yaml](/d:/dev/tutum-backend/k8s-manifests/overlays/staging/alb-ingress.yaml)
- [virtualservice.yaml](/d:/dev/tutum-backend/k8s-manifests/base/ingress/virtualservice.yaml)

Current staging routing sends:

`/api/proxy/import/ocr` -> `service/ocr:8002`

That means the public OCR upload route bypasses the frontend Next.js proxy in live staging.

## Step 1. Recover The OCR Target

Run on `cp-3`:

```bash
kubectl -n tutum-app get deploy ocr
kubectl -n tutum-app get pods -l app=ocr -o wide
kubectl -n tutum-app get endpoints ocr
```

If `deploy/ocr` is `0/0` or endpoints are empty:

```bash
kubectl -n tutum-app scale deploy ocr --replicas=1
kubectl -n tutum-app rollout status deploy/ocr
kubectl -n tutum-app get pods -l app=ocr -o wide
kubectl -n tutum-app get endpoints ocr
```

Expected:
- at least one running `ocr` pod
- `endpoints/ocr` contains `IP:8002`

## Step 2. Verify The Service Internally

Run on `cp-3`:

```bash
kubectl -n tutum-app logs deploy/ocr --tail=100
kubectl -n tutum-app run ocr-curl --rm -it --restart=Never --image=curlimages/curl -- \
  sh -c 'printf \"iVBORw0KGgo=\" | base64 -d > /tmp/ocr.png && \
  curl -sS -X POST http://ocr.tutum-app.svc.cluster.local:8002/import/ocr \
    -F \"file=@/tmp/ocr.png;type=image/png\" \
    -F \"user_id=qa-user\"'
```

Expected:
- not `403`
- OCR service returns JSON or a validation/processing error from the app itself

## Step 3. Apply The WAF OCR Exception

Script:
- [apply_ocr_waf_exception.py](/d:/dev/tutum-backend/scripts/apply_ocr_waf_exception.py)

Run on a machine with AWS credentials for the staging account:

```bash
cd /d/dev/tutum-backend
python3 scripts/apply_ocr_waf_exception.py \
  --name tutum-stg-waf \
  --id 14db8c23-c2dc-4d17-9f85-4b509bf4c261 \
  --region ap-northeast-2 \
  --profile ruby \
  --action ALLOW
```

Safer preview first:

```bash
python3 scripts/apply_ocr_waf_exception.py \
  --name tutum-stg-waf \
  --id 14db8c23-c2dc-4d17-9f85-4b509bf4c261 \
  --region ap-northeast-2 \
  --profile ruby \
  --action COUNT \
  --dry-run
```

The rule is intentionally narrow:
- method = `POST`
- path starts with `/api/proxy/import/ocr`
- `content-type` contains `multipart/form-data`

## Step 4. Validate From Outside

```bash
curl -I https://tutum.my/api/proxy/import/ocr
```

Expected after Step 1:
- no more `502`

Expected after Step 3 and a real browser upload:
- no more `403`

## Operational Conclusion

If OCR fails again on live staging:

1. check `deploy/ocr` and `endpoints/ocr` first
2. if targets exist but browser still gets `403`, re-check the WAF exception rule

This is not primarily a MinIO-to-S3 migration issue.
