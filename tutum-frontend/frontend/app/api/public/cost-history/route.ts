import { readFile } from "fs/promises";
import Papa from "papaparse";
import { NextResponse } from "next/server";

const DEFAULT_CSV_PATH =
  process.env.ADMIN_COST_CSV_PATH ||
  "C:\\OneDrive\\문서\\카카오톡 받은 파일\\DailyDetail_2026-03월_하이미디어 아카데미.csv";

const DATE_INDEX = 1;
const PRODUCT_INDEX = 5;
const USAGE_TYPE_INDEX = 6;
const REGION_INDEX = 7;
const DESCRIPTION_INDEX = 8;
const AMOUNT_INDEX = 11;

type DailyBucket = {
  date: string;
  aws_total_usd: number;
  eks_stack_total_usd: number;
  nat_total_usd: number;
};

function decodeCsv(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("euc-kr").decode(buffer);
  }
}

function toAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const numeric = Number.parseFloat(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

function classify(productName: string, usageType: string, description: string) {
  const haystack = `${productName} ${usageType} ${description}`.toLowerCase();
  const isNat =
    haystack.includes("natgateway") || haystack.includes("nat gateway");
  const isEksControlPlane =
    productName === "Amazon Elastic Container Service for Kubernetes";
  const isLoadBalancer = productName === "Elastic Load Balancing";
  const isVpc = productName === "Amazon Virtual Private Cloud";
  const isEc2 = productName === "Amazon Elastic Compute Cloud";
  const isInfraTransfer =
    productName === "Data Transfer" &&
    (haystack.includes("nat") ||
      haystack.includes("load balanc") ||
      haystack.includes("elastic container service for kubernetes") ||
      haystack.includes("eks"));

  return {
    isNat,
    isEksControlPlane,
    isLoadBalancer,
    isVpc,
    isEc2,
    isInfraTransfer,
    isEksStack:
      isNat ||
      isEksControlPlane ||
      isLoadBalancer ||
      isVpc ||
      isEc2 ||
      isInfraTransfer,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = await readFile(DEFAULT_CSV_PATH);
    const decoded = decodeCsv(raw);
    const parsed = Papa.parse<string[]>(decoded, {
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      return NextResponse.json(
        {
          available: false,
          detail: parsed.errors[0]?.message || "CSV parse failed",
          source_path: DEFAULT_CSV_PATH,
        },
        { status: 500 }
      );
    }

    const rows = parsed.data
      .slice(1)
      .filter((row) => row.length > AMOUNT_INDEX && String(row[DATE_INDEX] || "").trim());
    if (rows.length === 0) {
      return NextResponse.json({
        available: false,
        detail: "CSV is empty",
        source_path: DEFAULT_CSV_PATH,
      });
    }

    const dailyMap = new Map<string, DailyBucket>();
    let awsTotal = 0;
    let eksStackTotal = 0;
    let natTotal = 0;
    let eksControlPlaneTotal = 0;
    let ec2Total = 0;
    let loadBalancerTotal = 0;
    let vpcTotal = 0;
    let firstEksDate: string | null = null;
    let lastEksDate: string | null = null;

    for (const row of rows) {
      const date = String(row[DATE_INDEX] || "").trim();
      const productName = String(row[PRODUCT_INDEX] || "").trim();
      const usageType = String(row[USAGE_TYPE_INDEX] || "").trim();
      const region = String(row[REGION_INDEX] || "").trim();
      const description = String(row[DESCRIPTION_INDEX] || "").trim();
      const amount = toAmount(row[AMOUNT_INDEX]);

      awsTotal += amount;

      const bucket =
        dailyMap.get(date) ||
        {
          date,
          aws_total_usd: 0,
          eks_stack_total_usd: 0,
          nat_total_usd: 0,
        };
      bucket.aws_total_usd += amount;

      const flags = classify(productName, usageType, description);
      if (flags.isEksStack) {
        eksStackTotal += amount;
        bucket.eks_stack_total_usd += amount;
        if (!firstEksDate || date < firstEksDate) firstEksDate = date;
        if (!lastEksDate || date > lastEksDate) lastEksDate = date;
      }
      if (flags.isNat) {
        natTotal += amount;
        bucket.nat_total_usd += amount;
      }
      if (flags.isEksControlPlane) eksControlPlaneTotal += amount;
      if (flags.isEc2 && !flags.isNat) ec2Total += amount;
      if (flags.isLoadBalancer) loadBalancerTotal += amount;
      if (flags.isVpc) vpcTotal += amount;

      dailyMap.set(date, bucket);
    }

    const daily = [...dailyMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((bucket) => ({
        ...bucket,
        aws_total_usd: Number(bucket.aws_total_usd.toFixed(2)),
        eks_stack_total_usd: Number(bucket.eks_stack_total_usd.toFixed(2)),
        nat_total_usd: Number(bucket.nat_total_usd.toFixed(2)),
      }));

    return NextResponse.json({
      available: true,
      source_path: DEFAULT_CSV_PATH,
      currency: "USD",
      estimated_eks_start_date: firstEksDate,
      estimated_eks_end_date: lastEksDate,
      days: daily.length,
      totals: {
        aws_total_usd: Number(awsTotal.toFixed(2)),
        eks_stack_total_usd: Number(eksStackTotal.toFixed(2)),
        nat_total_usd: Number(natTotal.toFixed(2)),
        eks_control_plane_total_usd: Number(eksControlPlaneTotal.toFixed(2)),
        ec2_total_usd: Number(ec2Total.toFixed(2)),
        load_balancer_total_usd: Number(loadBalancerTotal.toFixed(2)),
        vpc_total_usd: Number(vpcTotal.toFixed(2)),
      },
      daily,
      matched_categories: [
        "Amazon Elastic Container Service for Kubernetes",
        "Amazon Elastic Compute Cloud",
        "Amazon Virtual Private Cloud",
        "Elastic Load Balancing",
        "Data Transfer (NAT/LB/EKS inferred)",
      ],
      notes: [
        "Accumulated EKS stack cost is inferred from the local CSV, not the AWS Billing API.",
        "NAT cost includes both NAT Gateway hours and NAT data processing rows detected in the CSV.",
      ],
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unable to read local cost CSV";
    return NextResponse.json(
      {
        available: false,
        detail,
        source_path: DEFAULT_CSV_PATH,
      },
      { status: 500 }
    );
  }
}
