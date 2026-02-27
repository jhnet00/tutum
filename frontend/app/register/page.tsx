"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Shield, Check, X, AlertCircle, ArrowLeft, Mail, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// --- Validation Logic ---

const checkPasswordComplexity = (password: string) => {
    let score = 0;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
};

const registerSchema = z.object({
    email: z.string().email("유효한 이메일 주소를 입력해주세요."),
    password: z.string()
        .min(10, "비밀번호는 최소 10자 이상이어야 합니다.")
        .max(128, "비밀번호는 최대 128자까지 가능합니다.")
        .refine((val) => checkPasswordComplexity(val) >= 3, {
            message: "영문 대/소문자, 숫자, 특수문자 중 3종류 이상을 포함해야 합니다.",
        }),
    passwordConfirm: z.string(),
    nickname: z.string()
        .min(2, "닉네임은 최소 2자 이상이어야 합니다.")
        .max(20, "닉네임은 최대 20자까지 가능합니다.")
        .regex(/^[a-zA-Z0-9가-힣_]+$/, "한글, 영문, 숫자, 밑줄(_)만 사용 가능합니다."),
    termsAccepted: z.boolean().refine((val) => val === true, {
        message: "필수 약관에 동의해야 합니다.",
    }),
    marketingOptIn: z.boolean(),
}).refine((data) => data.password === data.passwordConfirm, {
    message: "비밀번호가 일치하지 않습니다.",
    path: ["passwordConfirm"],
}).refine((data) => {
    const emailId = data.email.split("@")[0];
    if (emailId && data.password.includes(emailId)) return false;
    return true;
}, {
    message: "아이디(이메일)를 포함한 비밀번호는 사용할 수 없습니다.",
    path: ["password"],
}).refine((data) => {
    if (data.nickname && data.password.includes(data.nickname)) return false;
    return true;
}, {
    message: "닉네임을 포함한 비밀번호는 사용할 수 없습니다.",
    path: ["password"],
});

type RegisterFormValues = z.infer<typeof registerSchema>;

type Step = "input" | "verifying" | "success";

export default function RegisterPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>("input");
    const [email, setEmail] = useState("");
    const [isPolling, setIsPolling] = useState(false);
    const [resendLoading, setResendLoading] = useState(false);
    const [globalError, setGlobalError] = useState<string | null>(null);

    const form = useForm<RegisterFormValues>({
        resolver: zodResolver(registerSchema),
        defaultValues: {
            email: "",
            password: "",
            passwordConfirm: "",
            nickname: "",
            termsAccepted: false,
            marketingOptIn: false,
        },
        mode: "onChange",
    });

    const { register, handleSubmit, formState: { errors, isValid, isSubmitting }, watch } = form;

    const watchPassword = watch("password", "");
    const passLen = watchPassword.length >= 10 && watchPassword.length <= 128;
    const passComplex = checkPasswordComplexity(watchPassword) >= 3;

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

    // --- Polling Logic ---
    const checkStatus = useCallback(async (targetEmail: string) => {
        try {
            const resp = await fetch(`${API_BASE}/api/v1/auth/verification-status?email=${encodeURIComponent(targetEmail)}`);
            if (resp.ok) {
                const data = await resp.json();
                if (data.is_verified) {
                    setStep("success");
                    setIsPolling(false);
                }
            }
        } catch (e) {
            console.error("Polling error", e);
        }
    }, [API_BASE]);

    useEffect(() => {
        let intervalId: NodeJS.Timeout;
        if (isPolling && email) {
            intervalId = setInterval(() => checkStatus(email), 3000);
        }
        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [isPolling, email, checkStatus]);

    // --- Action Handlers ---

    const onSubmit = async (data: RegisterFormValues) => {
        setGlobalError(null);
        try {
            // 1. Email Duplicate Check
            const checkResp = await fetch(`${API_BASE}/api/v1/auth/check-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: data.email }),
            });
            
            const checkData = await checkResp.json();
            if (!checkResp.ok || !checkData.available) {
                form.setError("email", { message: checkData.message || "이미 등록된 이메일입니다." });
                return;
            }

            // 2. Registration
            const regPayload = {
                email: data.email,
                password: data.password,
                nickname: data.nickname,
                marketing_opt_in: data.marketingOptIn,
            };

            const regResp = await fetch(`${API_BASE}/api/v1/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(regPayload),
            });

            if (!regResp.ok) {
                const err = await regResp.json();
                throw new Error(err.detail || "회원가입 실패");
            }

            // Move to Step 2
            setEmail(data.email);
            setStep("verifying");
            setIsPolling(true);

        } catch (error: any) {
            setGlobalError(error.message || "서버 통신 중 오류가 발생했습니다.");
        }
    };

    const handleResend = async () => {
        if (!email) return;
        setResendLoading(true);
        try {
            const resp = await fetch(`${API_BASE}/api/v1/auth/resend-verification`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(email), // Adjusted to match backend @router.post("/resend-verification") async def resend_verification(email: EmailStr)
            });
            if (resp.ok) {
                alert("인증 메일이 재발송되었습니다.");
            } else {
                const err = await resp.json();
                alert(err.detail || "재발송 실패");
            }
        } catch (e) {
            alert("통신 오류가 발생했습니다.");
        } finally {
            setResendLoading(false);
        }
    };

    // --- Render Helpers ---

    if (step === "verifying") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
                <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 text-center p-6">
                    <CardHeader className="space-y-4">
                        <div className="mx-auto rounded-full bg-blue-100 p-4 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                            <Mail className="h-8 w-8 animate-pulse" />
                        </div>
                        <CardTitle className="text-2xl font-bold">이메일 인증 대기 중</CardTitle>
                        <CardDescription className="text-base text-zinc-600 dark:text-zinc-400">
                            <span className="font-bold text-zinc-900 dark:text-white">{email}</span>(으)로 인증 메일을 보냈습니다.<br />
                            메일함의 링크를 클릭하면 자동으로 다음 단계로 넘어갑니다.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center py-4">
                        <div className="flex items-center gap-2 text-zinc-500 text-sm">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            인증 여부 확인 중...
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-3">
                        <Button
                            variant="outline"
                            className="w-full h-11"
                            onClick={handleResend}
                            disabled={resendLoading}
                        >
                            {resendLoading ? "발송 중..." : "인증 메일 재발송"}
                        </Button>
                        <Button 
                            variant="ghost" 
                            className="w-full"
                            onClick={() => setStep("input")}
                        >
                            로그인 정보 수정하기
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    if (step === "success") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
                <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 text-center p-6">
                    <CardHeader className="space-y-4">
                        <div className="mx-auto rounded-full bg-emerald-100 p-4 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                            <Check className="h-8 w-8" />
                        </div>
                        <CardTitle className="text-2xl font-bold">인증 완료!</CardTitle>
                        <CardDescription className="text-base text-zinc-600 dark:text-zinc-400">
                            이메일 인증이 성공적으로 완료되었습니다.<br />
                            이제 가입을 완료하고 서비스를 이용할 수 있습니다.
                        </CardDescription>
                    </CardHeader>
                    <CardFooter>
                        <Button
                            className="w-full h-11 text-base font-semibold"
                            onClick={() => router.push("/login")}
                        >
                            가입 완료 및 로그인하러 가기
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
            <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800">
                <CardHeader className="space-y-1 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="rounded-full bg-black p-3 dark:bg-white text-white dark:text-black">
                            <Shield className="h-6 w-6" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-bold tracking-tight">회원가입</CardTitle>
                    <CardDescription>
                        안전한 자산 관리를 시작해보세요
                    </CardDescription>
                </CardHeader>

                <form onSubmit={handleSubmit(onSubmit)}>
                    <CardContent className="space-y-5">
                        {globalError && (
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3 rounded-md flex gap-2 items-start text-red-600 dark:text-red-400 text-sm">
                                <AlertCircle className="h-4 w-4 mt-0.5" />
                                <span>{globalError}</span>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="email">이메일 (아이디)</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="name@example.com"
                                {...register("email")}
                                className={cn(errors.email && "border-red-500 focus-visible:ring-red-500")}
                            />
                            {errors.email && <p className="text-xs text-red-500 font-medium">{errors.email.message}</p>}
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label htmlFor="nickname">닉네임</Label>
                                <span className="text-xs text-zinc-400">2~20자</span>
                            </div>
                            <Input
                                id="nickname"
                                placeholder="사용하실 닉네임을 입력하세요"
                                {...register("nickname")}
                                className={cn(errors.nickname && "border-red-500 focus-visible:ring-red-500")}
                            />
                            {errors.nickname && <p className="text-xs text-red-500 font-medium">{errors.nickname.message}</p>}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">비밀번호</Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="비밀번호 입력"
                                {...register("password")}
                                className={cn(errors.password && "border-red-500 focus-visible:ring-red-500")}
                            />

                            <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 mt-2">
                                <div className={cn("flex items-center gap-1", passLen ? "text-emerald-600 font-medium" : "")}>
                                    {passLen ? <Check className="h-3 w-3" /> : <div className="h-1 w-1 rounded-full bg-zinc-300 mx-1" />}
                                    10자 이상
                                </div>
                                <div className={cn("flex items-center gap-1", passComplex ? "text-emerald-600 font-medium" : "")}>
                                    {passComplex ? <Check className="h-3 w-3" /> : <div className="h-1 w-1 rounded-full bg-zinc-300 mx-1" />}
                                    3종류 이상 조합
                                </div>
                            </div>
                            {errors.password && <p className="text-xs text-red-500 font-medium">{errors.password.message}</p>}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password-confirm">비밀번호 확인</Label>
                            <Input
                                id="password-confirm"
                                type="password"
                                placeholder="비밀번호 재입력"
                                {...register("passwordConfirm")}
                                className={cn(errors.passwordConfirm && "border-red-500 focus-visible:ring-red-500")}
                            />
                            {errors.passwordConfirm && <p className="text-xs text-red-500 font-medium">{errors.passwordConfirm.message}</p>}
                        </div>

                        <div className="space-y-3 pt-2">
                            <div className="flex items-start space-x-2 rounded-md border p-4">
                                <Checkbox
                                    id="terms"
                                    onCheckedChange={(checked) => form.setValue("termsAccepted", checked === true, { shouldValidate: true })}
                                />
                                <div className="space-y-1 leading-none">
                                    <Label htmlFor="terms" className="text-sm font-medium leading-none">
                                        서비스 이용약관 및 개인정보 처리방침 동의 (필수)
                                    </Label>
                                    {errors.termsAccepted && <p className="text-xs text-red-500 font-medium mt-1">{errors.termsAccepted.message}</p>}
                                </div>
                            </div>
                            <div className="flex items-start space-x-2 rounded-md border p-4 bg-zinc-50/50 dark:bg-zinc-900/50">
                                <Checkbox
                                    id="marketing"
                                    onCheckedChange={(checked) => form.setValue("marketingOptIn", checked === true)}
                                />
                                <div className="space-y-1 leading-none">
                                    <Label htmlFor="marketing" className="text-sm font-medium leading-none">
                                        마케팅 정보 수신 동의 (선택)
                                    </Label>
                                    <p className="text-xs text-zinc-500">
                                        이벤트 및 혜택 정보를 받아보실 수 있습니다.
                                    </p>
                                </div>
                            </div>
                        </div>

                    </CardContent>
                    <CardFooter className="flex flex-col gap-4 mt-2">
                        <Button
                            type="submit"
                            className="w-full h-11 text-base font-semibold"
                            disabled={isSubmitting || !isValid}
                        >
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            인증 이메일 발송
                        </Button>
                        <div className="text-center text-sm">
                            <span className="text-zinc-500">이미 계정이 있으신가요? </span>
                            <Link href="/login" className="font-semibold text-zinc-900 dark:text-white hover:underline">
                                로그인
                            </Link>
                        </div>
                    </CardFooter>
                </form>
            </Card>
            <div className="flex justify-center mt-2">
                <Button
                    variant="ghost"
                    className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300 transition-colors flex items-center gap-2"
                    onClick={() => router.push("/")}
                >
                    <ArrowLeft className="h-4 w-4" />
                    <span>돌아가기</span>
                </Button>
            </div>
        </div>
    );
}
