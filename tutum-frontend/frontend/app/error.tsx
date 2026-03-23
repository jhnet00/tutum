"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ShieldAlert, RefreshCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error caught by boundary:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div className="mb-6 p-4 bg-destructive/10 rounded-full text-destructive">
        <ShieldAlert className="h-10 w-10" />
      </div>
      <h2 className="text-xl font-bold mb-2">화면을 불러오는데 문제가 발생했습니다</h2>
      <p className="text-muted-foreground mb-6 max-w-sm text-sm">
        일시적인 오류이거나 서버와의 연결이 원활하지 않을 수 있습니다.
      </p>
      <div className="flex gap-4">
        <Button onClick={() => reset()} size="sm">
          <RefreshCcw className="h-4 w-4 mr-2" /> 다시 시도
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.location.href = "/"}>
           메인 화면으로
        </Button>
      </div>
    </div>
  );
}
