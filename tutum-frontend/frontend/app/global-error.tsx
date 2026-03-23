"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ShieldAlert, RefreshCcw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error caught:", error);
  }, [error]);

  return (
    <html lang="ko">
      <body className="font-sans">
        <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 p-6 text-center text-white">
          <div className="mb-6 p-4 bg-rose-500/10 rounded-full text-rose-500">
            <ShieldAlert className="h-12 w-12" />
          </div>
          <h2 className="text-2xl font-black mb-2 tracking-tighter">애플리케이션 오류</h2>
          <p className="text-zinc-400 mb-8 max-w-sm font-medium leading-relaxed">
            죄송합니다. 시스템 내부 오류가 발생했습니다.<br/>
            문제 해결을 위해 노력 중입니다.
            {error.message && (
                <span className="block mt-4 p-2 bg-white/5 rounded text-xs font-mono text-rose-400">
                    {error.message}
                </span>
            )}
          </p>
          <div className="flex gap-4">
            <Button onClick={() => reset()} className="bg-white text-black hover:bg-zinc-200 font-bold px-6">
              다시 시도
            </Button>
            <Button variant="outline" onClick={() => window.location.href = "/"} className="border-white/20 hover:bg-white/10 font-bold">
               메인으로 이동
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
