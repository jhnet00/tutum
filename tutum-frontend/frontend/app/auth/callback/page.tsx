"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;

    const finishLogin = async () => {
      const errorMessage = searchParams.get("error");
      if (errorMessage) {
        console.error("OAuth callback error:", errorMessage);
        router.replace(`/login?message=oauth_error&detail=${encodeURIComponent(errorMessage)}`);
        return;
      }

      try {
        await refreshUser();
      } catch (error) {
        console.error("OAuth callback sync failed:", error);
      } finally {
        router.replace("/portfolio/asset");
      }
    };

    processed.current = true;
    finishLogin();
  }, [searchParams, router, refreshUser]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mx-auto mb-4"></div>
        <p className="text-xl font-medium">로그인 처리 중입니다.</p>
        <p className="text-gray-400 mt-2">잠시만 기다려 주세요.</p>
      </div>
    </div>
  );
}

export default function AuthCallback() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <AuthCallbackContent />
    </Suspense>
  );
}
