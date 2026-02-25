"use client";

import { useCallback, useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, X, Mail, Loader2, AlertCircle, ArrowRight } from "lucide-react";
import Link from "next/link";

type VerifyState = "verifying" | "success" | "error" | "awaiting";

function VerifyEmailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [state, setState] = useState<VerifyState>("verifying");
    const [message, setMessage] = useState("");
    const [email, setEmail] = useState<string | null>(null);
    const [resendLoading, setResendLoading] = useState(false);

    const token = searchParams.get("token");
    const paramEmail = searchParams.get("email");
    const status = searchParams.get("status");

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

    const handleTokenVerification = useCallback(async (verifyToken: string) => {
        setState("verifying");
        try {
            const resp = await fetch(`${API_BASE}/api/v1/auth/verify?token=${verifyToken}`);
            const data = await resp.json();
            
            if (resp.ok) {
                setState("success");
                setMessage("이메일 인증이 완료되었습니다!");
            } else {
                setState("error");
                setMessage(data.detail || "인증에 실패했습니다. 토큰이 만료되었거나 이미 사용되었을 수 있습니다.");
            }
        } catch (e) {
            setState("error");
            setMessage("서버와 통신하는 도중 오류가 발생했습니다.");
        }
    }, [API_BASE]);

    useEffect(() => {
        if (status === "success") {
            setState("success");
            setMessage("이메일 인증이 완료되었습니다!");
        } else if (token) {
            handleTokenVerification(token);
        } else if (paramEmail) {
            setEmail(paramEmail);
            setState("awaiting");
        } else {
            setState("error");
            setMessage("인증 토큰 또는 이메일 정보가 없습니다.");
        }
    }, [handleTokenVerification, paramEmail, status, token]);

    const handleResend = async () => {
        const targetEmail = email || paramEmail;
        if (!targetEmail) return;

        setResendLoading(true);
        try {
            const resp = await fetch(`${API_BASE}/api/v1/auth/resend-verification`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(targetEmail),
            });
            if (resp.ok) {
                alert("인증 메일이 새롭게 발송되었습니다.");
            } else {
                const err = await resp.json();
                alert(err.detail || "발송 실패");
            }
        } catch (e) {
            alert("통신 오류가 발생했습니다.");
        } finally {
            setResendLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
            <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 text-center p-6">
                <CardHeader className="space-y-4">
                    {state === "verifying" && (
                        <div className="mx-auto rounded-full bg-blue-100 p-4 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                            <Loader2 className="h-8 w-8 animate-spin" />
                        </div>
                    )}
                    {state === "success" && (
                        <div className="mx-auto rounded-full bg-emerald-100 p-4 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                            <Check className="h-8 w-8" />
                        </div>
                    )}
                    {state === "error" && (
                        <div className="mx-auto rounded-full bg-red-100 p-4 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                            <X className="h-8 w-8" />
                        </div>
                    )}
                    {state === "awaiting" && (
                        <div className="mx-auto rounded-full bg-amber-100 p-4 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                            <Mail className="h-8 w-8" />
                        </div>
                    )}

                    <CardTitle className="text-2xl font-bold">
                        {state === "verifying" && "이메일 인증 중..."}
                        {state === "success" && "인증 완료"}
                        {state === "error" && "인증 오류"}
                        {state === "awaiting" && "이메일 인증 필요"}
                    </CardTitle>
                    
                    <CardDescription className="text-base text-zinc-600 dark:text-zinc-400">
                        {state === "verifying" && "잠시만 기다려주세요. 정보를 확인하고 있습니다."}
                        {state === "success" && message}
                        {state === "error" && message}
                        {state === "awaiting" && (
                            <>
                                <span className="font-bold text-zinc-900 dark:text-white">{email}</span> 계정은 아직 인증되지 않았습니다.<br />
                                서비스 이용을 위해 이메일 인증을 완료해주세요.
                            </>
                        )}
                    </CardDescription>
                </CardHeader>

                <CardFooter className="flex flex-col gap-3 mt-4">
                    {state === "success" && (
                        <Button className="w-full h-11 text-base font-semibold" onClick={() => router.push("/login")}>
                            로그인하러 가기 <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    )}
                    {state === "error" && token && (
                        <>
                            <Button variant="outline" className="w-full h-11" onClick={() => router.push("/login")}>
                                로그인 페이지로 이동
                            </Button>
                            <p className="text-xs text-zinc-500">
                                인증 메일을 다시 받으려면 로그인 페이지에서 이메일을 입력해주세요.
                            </p>
                        </>
                    )}
                    {state === "awaiting" && (
                        <>
                            <Button className="w-full h-11 text-base font-semibold" onClick={handleResend} disabled={resendLoading}>
                                {resendLoading ? "발송 중..." : "인증 이메일 재발송"}
                            </Button>
                            <Link href="/login" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white underline">
                                이미 인증을 완료했나요? 로그인하기
                            </Link>
                        </>
                    )}
                    {state === "error" && !token && (
                        <Button className="w-full h-11" onClick={() => router.push("/")}>
                            메인으로 돌아가기
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
            </div>
        }>
            <VerifyEmailContent />
        </Suspense>
    );
}
