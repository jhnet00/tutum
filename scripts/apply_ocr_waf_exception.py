#!/usr/bin/env python3
"""
Apply or preview an OCR upload exception rule to an AWS WAFv2 WebACL.

Use this when POST /api/proxy/import/ocr is blocked by WAF before it reaches
the OCR service. The rule is intentionally narrow:
  - method == POST
  - uri path starts with /api/proxy/import/ocr
  - content-type contains multipart/form-data

Examples:
  python scripts/apply_ocr_waf_exception.py \
    --name tutum-stg-waf \
    --id 14db8c23-c2dc-4d17-9f85-4b509bf4c261 \
    --region ap-northeast-2 \
    --action ALLOW

  python scripts/apply_ocr_waf_exception.py \
    --name tutum-stg-waf \
    --id 14db8c23-c2dc-4d17-9f85-4b509bf4c261 \
    --region ap-northeast-2 \
    --action COUNT \
    --dry-run
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import shutil
import subprocess
import tempfile
from typing import Any

try:
    import boto3  # type: ignore
except ModuleNotFoundError:
    boto3 = None


RULE_NAME = "AllowOCRUploadMultipart"


def byte_match_statement(
    field_to_match: dict[str, Any],
    search_string: str,
    positional_constraint: str,
) -> dict[str, Any]:
    return {
        "ByteMatchStatement": {
            "SearchString": search_string.encode("utf-8"),
            "FieldToMatch": field_to_match,
            "TextTransformations": [{"Priority": 0, "Type": "NONE"}],
            "PositionalConstraint": positional_constraint,
        }
    }


def build_rule(action: str) -> dict[str, Any]:
    action = action.upper()
    action_block: dict[str, Any]
    if action == "ALLOW":
        action_block = {"Allow": {}}
    elif action == "COUNT":
        action_block = {"Count": {}}
    else:
        raise ValueError(f"Unsupported action: {action}")

    return {
        "Name": RULE_NAME,
        "Priority": 0,
        "Statement": {
            "AndStatement": {
                "Statements": [
                    byte_match_statement(
                        {"Method": {}},
                        "POST",
                        "EXACTLY",
                    ),
                    byte_match_statement(
                        {"UriPath": {}},
                        "/api/proxy/import/ocr",
                        "STARTS_WITH",
                    ),
                    byte_match_statement(
                        {"SingleHeader": {"Name": "content-type"}},
                        "multipart/form-data",
                        "CONTAINS",
                    ),
                ]
            }
        },
        "Action": action_block,
        "VisibilityConfig": {
            "SampledRequestsEnabled": True,
            "CloudWatchMetricsEnabled": True,
            "MetricName": "allowOcrUploadMultipart",
        },
    }


def normalize_rules(existing_rules: list[dict[str, Any]], new_rule: dict[str, Any]) -> list[dict[str, Any]]:
    filtered = [copy.deepcopy(rule) for rule in existing_rules if rule.get("Name") != RULE_NAME]
    normalized = [copy.deepcopy(new_rule)] + filtered
    for idx, rule in enumerate(normalized):
        rule["Priority"] = idx
    return normalized


def printable_web_acl(name: str, acl_id: str, scope: str, action: str, rules: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "Name": name,
        "Id": acl_id,
        "Scope": scope,
        "Action": action.upper(),
        "RuleNames": [rule["Name"] for rule in rules],
        "Rules": rules,
    }


def _cli_json_safe(value: Any) -> Any:
    if isinstance(value, bytes):
        return base64.b64encode(value).decode("ascii")
    if isinstance(value, list):
        return [_cli_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: _cli_json_safe(item) for key, item in value.items()}
    return value


def _run_aws_cli(args: list[str]) -> dict[str, Any]:
    if not shutil.which("aws"):
        raise RuntimeError("aws cli is not installed or not available in PATH")

    completed = subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
    )
    stdout = (completed.stdout or "").strip()
    return json.loads(stdout) if stdout else {}


def _get_web_acl_via_cli(args: argparse.Namespace) -> dict[str, Any]:
    command = [
        "aws",
        "wafv2",
        "get-web-acl",
        "--name",
        args.name,
        "--scope",
        args.scope,
        "--id",
        args.id,
        "--region",
        args.region,
        "--output",
        "json",
    ]
    if args.profile:
        command.extend(["--profile", args.profile])
    return _run_aws_cli(command)


def _update_web_acl_via_cli(args: argparse.Namespace, payload: dict[str, Any]) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as temp_file:
        json.dump(_cli_json_safe(payload), temp_file, indent=2)
        temp_file.flush()
        command = [
            "aws",
            "wafv2",
            "update-web-acl",
            "--region",
            args.region,
            "--output",
            "json",
            "--cli-input-json",
            f"file://{temp_file.name}",
        ]
        if args.profile:
            command.extend(["--profile", args.profile])
        return _run_aws_cli(command)


def main() -> int:
    parser = argparse.ArgumentParser(description="Add or update an OCR WAF exception rule.")
    parser.add_argument("--name", required=True, help="WebACL name, e.g. tutum-stg-waf")
    parser.add_argument("--id", required=True, help="WebACL id UUID")
    parser.add_argument("--region", required=True, help="AWS region, e.g. ap-northeast-2")
    parser.add_argument("--scope", default="REGIONAL", choices=["REGIONAL", "CLOUDFRONT"])
    parser.add_argument("--action", default="ALLOW", choices=["ALLOW", "COUNT"])
    parser.add_argument("--profile", help="AWS CLI profile name for fallback mode")
    parser.add_argument("--dry-run", action="store_true", help="Print update payload without applying it")
    args = parser.parse_args()

    if boto3 is not None:
        waf = boto3.client("wafv2", region_name=args.region)
        current = waf.get_web_acl(Name=args.name, Scope=args.scope, Id=args.id)
    else:
        current = _get_web_acl_via_cli(args)

    web_acl = current["WebACL"]
    updated_rules = normalize_rules(web_acl.get("Rules", []), build_rule(args.action))

    if args.dry_run:
        print(json.dumps(printable_web_acl(args.name, args.id, args.scope, args.action, updated_rules), indent=2, default=str))
        return 0

    update_params: dict[str, Any] = {
        "Name": args.name,
        "Scope": args.scope,
        "Id": args.id,
        "DefaultAction": web_acl["DefaultAction"],
        "Description": web_acl.get("Description", ""),
        "VisibilityConfig": web_acl["VisibilityConfig"],
        "Rules": updated_rules,
        "LockToken": current["LockToken"],
    }

    for key in (
        "CustomResponseBodies",
        "CaptchaConfig",
        "ChallengeConfig",
        "TokenDomains",
        "AssociationConfig",
        "DataProtectionConfig",
        "OnSourceDDoSProtectionConfig",
    ):
        if key in web_acl:
            update_params[key] = web_acl[key]

    if boto3 is not None:
        response = waf.update_web_acl(**update_params)
    else:
        response = _update_web_acl_via_cli(args, update_params)

    print(
        json.dumps(
            {
                "status": "updated",
                "name": args.name,
                "id": args.id,
                "scope": args.scope,
                "action": args.action.upper(),
                "next_lock_token": response.get("NextLockToken"),
                "client": "boto3" if boto3 is not None else "aws-cli",
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
