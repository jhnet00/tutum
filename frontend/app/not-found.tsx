"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Home, AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white p-6">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-600/20 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="relative z-10 text-center space-y-8">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl mb-4">
          <AlertTriangle className="h-10 w-10 text-fuchsia-500" />
        </div>
        
        <div className="space-y-4">
          <h1 className="text-7xl font-black bg-gradient-to-b from-white to-zinc-500 text-transparent bg-clip-text">404</h1>
          <h2 className="text-2xl font-bold text-zinc-200">페이지를 찾을 수 없습니다</h2>
          <p className="text-zinc-500 max-w-md mx-auto leading-relaxed">
            요청하신 페이지가 사라졌거나 잘못된 경로입니다.<br />
            아래 버튼을 눌러 안전한 홈으로 돌아가세요.
          </p>
        </div>

        <div className="pt-4">
          <Link href="/">
            <Button size="lg" className="rounded-full px-8 bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white font-bold h-14 text-lg shadow-xl shadow-indigo-500/20 active:scale-95 transition-all">
              <Home className="mr-2 h-5 w-5" />
              메인으로 돌아가기
            </Button>
          </Link>
        </div>
      </div>

      {/* Footer-like Logo */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 opacity-20">
        <span className="text-4xl font-black tracking-tighter text-zinc-100">Tutum</span>
      </div>
    </div>
  );
}
