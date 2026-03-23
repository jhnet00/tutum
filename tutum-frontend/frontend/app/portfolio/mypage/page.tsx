"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    User,
    Lock,
    Bell,
    Trash2,
    ChevronRight,
    Camera,
    Check,
    AlertCircle,
    ShieldCheck,
    Mail,
    ShieldAlert,
    Save,
    LogOut,
    ArrowLeft,
    Loader2,
    Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { getAuthApiBase } from "@/lib/auth-endpoint";

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_DIMENSION = 1600;
const AVATAR_OUTPUT_TYPE = "image/jpeg";
const AVATAR_QUALITY_STEPS = [0.92, 0.86, 0.78, 0.7, 0.62];
const HEIC_MIME_TYPES = new Set([
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
]);
const AVATAR_UPLOAD_SUCCESS_MESSAGE = "\ud504\ub85c\ud544 \uc774\ubbf8\uc9c0\uac00 \ubcc0\uacbd\ub418\uc5c8\uc2b5\ub2c8\ub2e4.";
const AVATAR_UPLOAD_FAILURE_MESSAGE = "\uc774\ubbf8\uc9c0 \uc5c5\ub85c\ub4dc\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.";
const AVATAR_SERVER_ERROR_MESSAGE = "\uc11c\ubc84 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4.";

function replaceExtension(filename: string, nextExtension: string) {
    const baseName = filename.replace(/\.[^.]+$/, "") || "profile-image";
    return `${baseName}.${nextExtension}`;
}

function isHeicLikeFile(file: File) {
    const mimeType = file.type.toLowerCase();
    return HEIC_MIME_TYPES.has(mimeType) || /\.(heic|heif)$/i.test(file.name);
}

function loadImageElement(file: Blob) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new window.Image();

        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };

        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("브라우저에서 이미지 파일을 읽을 수 없습니다."));
        };

        image.src = objectUrl;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                    return;
                }

                reject(new Error("이미지 변환 중 오류가 발생했습니다."));
            },
            AVATAR_OUTPUT_TYPE,
            quality
        );
    });
}

async function convertHeicToJpeg(file: File) {
    const heic2anyModule = await import("heic2any");
    const converted = await heic2anyModule.default({
        blob: file,
        toType: AVATAR_OUTPUT_TYPE,
        quality: AVATAR_QUALITY_STEPS[0],
    });
    const convertedBlob = Array.isArray(converted) ? converted[0] : converted;

    return new File([convertedBlob], replaceExtension(file.name, "jpg"), {
        type: AVATAR_OUTPUT_TYPE,
        lastModified: Date.now(),
    });
}

async function normalizeAvatarFile(file: File) {
    const sourceFile = isHeicLikeFile(file) ? await convertHeicToJpeg(file) : file;

    if (!sourceFile.type.startsWith("image/")) {
        throw new Error("JPEG, PNG, WEBP, HEIC 형식의 이미지만 업로드할 수 있습니다.");
    }

    const image = await loadImageElement(sourceFile);
    const scale = Math.min(
        1,
        MAX_AVATAR_DIMENSION / Math.max(image.width || 1, image.height || 1)
    );
    const targetWidth = Math.max(1, Math.round((image.width || 1) * scale));
    const targetHeight = Math.max(1, Math.round((image.height || 1) * scale));
    const canvas = document.createElement("canvas");

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("이미지 처리를 위한 브라우저 기능을 사용할 수 없습니다.");
    }

    // JPEG로 통일하면서 투명 영역은 흰색 배경으로 채운다.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    let selectedBlob: Blob | null = null;
    for (const quality of AVATAR_QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, quality);
        selectedBlob = blob;
        if (blob.size <= MAX_AVATAR_SIZE_BYTES) {
            break;
        }
    }

    if (!selectedBlob) {
        throw new Error("이미지 변환 중 오류가 발생했습니다.");
    }

    if (selectedBlob.size > MAX_AVATAR_SIZE_BYTES) {
        throw new Error("이미지가 너무 커서 업로드할 수 없습니다. 더 작은 사진을 선택해 주세요.");
    }

    return new File(
        [selectedBlob],
        replaceExtension(sourceFile.name || file.name, "jpg"),
        {
            type: AVATAR_OUTPUT_TYPE,
            lastModified: Date.now(),
        }
    );
}

export default function MyPage() {
    const { user, token, logout, refreshUser } = useAuth();
    const router = useRouter();
    const API_URL = getAuthApiBase();

    const authHeaders = (headers: Record<string, string> = {}) => {
        if (!token) return headers;
        return { ...headers, Authorization: `Bearer ${token}` };
    };

    // Profile State
    const [nickname, setNickname] = useState("");
    const [marketingOptIn, setMarketingOptIn] = useState(false);
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

    // Password State
    const [passwords, setPasswords] = useState({
        old: "",
        new: "",
        confirm: ""
    });
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordStatus, setPasswordStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: "" });

    // Delete Account State
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Avatar State
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

    useEffect(() => {
        if (user) {
            setNickname(user.nickname || "");
            setMarketingOptIn(user.marketing_opt_in || false);
        }
    }, [user]);

    /**
     * 프로필 업데이트 처리
     */
    const handleUpdateProfile = async () => {
        if (!nickname.trim()) return;
        setIsUpdatingProfile(true);

        try {
            const response = await fetch(`${API_URL}/api/v1/auth/update-profile`, {
                method: "PUT",
                credentials: "include",
                headers: authHeaders({
                    "Content-Type": "application/json",
                }),
                body: JSON.stringify({
                    nickname: nickname,
                    marketing_opt_in: marketingOptIn
                }),
            });

            if (response.ok) {
                await refreshUser();
                alert("프로필이 업데이트되었습니다.");
            } else {
                alert("프로필 업데이트에 실패했습니다.");
            }
        } catch (error) {
            console.error("Profile update error:", error);
        } finally {
            setIsUpdatingProfile(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingAvatar(true);

        try {
            const normalizedFile = await normalizeAvatarFile(file);
            const formData = new FormData();
            formData.append("file", normalizedFile);

            const response = await fetch(`${API_URL}/api/v1/auth/upload-profile-image`, {
                method: "POST",
                credentials: "include",
                headers: authHeaders(),
                body: formData,
            });

            if (response.ok) {
                await refreshUser();
                alert(AVATAR_UPLOAD_SUCCESS_MESSAGE);
            } else {
                const data = await response.json();
                alert(data.detail || AVATAR_UPLOAD_FAILURE_MESSAGE);
            }
        } catch (error) {
            console.error("Avatar upload error:", error);
            alert(error instanceof Error ? error.message : AVATAR_SERVER_ERROR_MESSAGE);
        } finally {
            setIsUploadingAvatar(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    /**
     * 비밀번호 변경 처리
     */
    const handleChangePassword = async () => {
        if (!passwords.old || !passwords.new || !passwords.confirm) {
            setPasswordStatus({ type: 'error', message: "모든 필드를 입력해주세요." });
            return;
        }
        if (passwords.new !== passwords.confirm) {
            setPasswordStatus({ type: 'error', message: "새 비밀번호가 일치하지 않습니다." });
            return;
        }
        if (passwords.new.length < 8) {
            setPasswordStatus({ type: 'error', message: "비밀번호는 8자 이상이어야 합니다." });
            return;
        }

        setIsChangingPassword(true);
        setPasswordStatus({ type: null, message: "" });

        try {
            const response = await fetch(`${API_URL}/api/v1/auth/change-password`, {
                method: "PUT",
                credentials: "include",
                headers: authHeaders({
                    "Content-Type": "application/json",
                }),
                body: JSON.stringify({
                    old_password: passwords.old,
                    new_password: passwords.new
                }),
            });

            if (response.ok) {
                setPasswordStatus({ type: 'success', message: "비밀번호가 성공적으로 변경되었습니다." });
                setPasswords({ old: "", new: "", confirm: "" });
            } else {
                const data = await response.json();
                setPasswordStatus({ type: 'error', message: data.detail || "비밀번호 변경에 실패했습니다." });
            }
        } catch (error) {
            setPasswordStatus({ type: 'error', message: "서버 오류가 발생했습니다." });
        } finally {
            setIsChangingPassword(false);
        }
    };

    /**
     * 회원 탈퇴 처리
     */
    const handleDeleteAccount = async () => {
        setIsDeleting(true);
        try {
            const response = await fetch(`${API_URL}/api/v1/auth/me`, {
                method: "DELETE",
                credentials: "include",
                headers: authHeaders(),
            });

            if (response.ok) {
                alert("회원 탈퇴가 완료되었습니다.");
                logout();
            } else {
                alert("회원 탈퇴 처리 중 오류가 발생했습니다.");
            }
        } catch (error) {
            console.error("Delete account error:", error);
        } finally {
            setIsDeleting(false);
        }
    };

    /**
     * 아바타 이미지 업로드 처리
     */
    const handleAvatarClick = () => {
        fileInputRef.current?.click();
    };

    /* const legacyHandleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // 파일 크기 체크 (5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert("파일 크기는 5MB를 초과할 수 없습니다.");
            return;
        }

        setIsUploadingAvatar(true);
        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch(`${API_URL}/api/v1/auth/upload-profile-image`, {
                method: "POST",
                credentials: "include",
                headers: authHeaders(),
                body: formData,
            });

            if (response.ok) {
                await refreshUser();
                alert("프로필 이미지가 변경되었습니다.");
            } else {
                const data = await response.json();
                alert(data.detail || "이미지 업로드에 실패했습니다.");
            }
        } catch (error) {
            console.error("Avatar upload error:", error);
            alert("서버 오류가 발생했습니다.");
        } finally {
            setIsUploadingAvatar(false);
        }
    }; */

    /**
     * 아바타 이미지 삭제 처리
     */
    const handleRemoveAvatar = async () => {
        if (!confirm("프로필 이미지를 삭제하시겠습니까?")) return;

        setIsUploadingAvatar(true);
        try {
            const response = await fetch(`${API_URL}/api/v1/auth/profile-image`, {
                method: "DELETE",
                credentials: "include",
                headers: authHeaders(),
            });

            if (response.ok) {
                await refreshUser();
                alert("프로필 이미지가 삭제되었습니다.");
            } else {
                const data = await response.json();
                alert(data.detail || "이미지 삭제에 실패했습니다.");
            }
        } catch (error) {
            console.error("Avatar remove error:", error);
            alert("서버 오류가 발생했습니다.");
        } finally {
            setIsUploadingAvatar(false);
        }
    };

    if (!user) {
        return (
            <div className="min-h-screen bg-[#F8F9FA] dark:bg-[#09090B] pb-20">
                <div className="max-w-2xl mx-auto px-6 pt-12 text-center">
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">마이페이지</h1>
                    <p className="mt-4 text-zinc-500">로그인이 필요합니다. 다시 로그인해 주세요.</p>
                    <Button
                        className="mt-6 bg-black text-white"
                        onClick={() => router.push("/login")}
                    >
                        로그인 페이지로 이동
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F8F9FA] dark:bg-[#09090B] pb-20">
            <div className="max-w-4xl mx-auto px-6 pt-12">
                {/* Header Section */}
                <div className="flex items-center gap-4 mb-10">
                    <button
                        onClick={() => router.back()}
                        className="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-sm"
                    >
                        <ArrowLeft className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                    </button>
                    <div>
                        <h1 className="text-3xl font-black tracking-tight dark:text-white">내 정보 수정</h1>
                        <p className="text-sm text-zinc-500 font-medium">계정 보안 및 프로필 설정을 관리하세요</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: Profile Summary */}
                    <div className="lg:col-span-1 space-y-6">
                        <Card className="border-none shadow-xl bg-white dark:bg-zinc-900 overflow-hidden">
                            <CardContent className="p-0">
                                <div className="p-6 pt-12 text-center">
                                    <div className="relative inline-block mb-20">
                                        <div className="w-32 h-32 rounded-[2rem] bg-white dark:bg-zinc-800 p-1.5 shadow-2xl relative z-10">
                                            <div className="w-full h-full rounded-[1.75rem] bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center font-black text-3xl text-white dark:text-zinc-900 overflow-hidden">
                                                {user.profile_image ? (
                                                    <Image
                                                        src={user.profile_image}
                                                        alt="Profile"
                                                        width={128}
                                                        height={128}
                                                        className="w-full h-full object-cover"
                                                        unoptimized
                                                    />
                                                ) : (
                                                    user.nickname ? user.nickname[0].toUpperCase() : 'U'
                                                )}
                                            </div>
                                        </div>
                                        <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 flex items-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-lg z-20 overflow-hidden divide-x dark:divide-zinc-800">
                                            <button
                                                onClick={handleAvatarClick}
                                                disabled={isUploadingAvatar}
                                                className="p-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                                                title="사진 변경"
                                            >
                                                {isUploadingAvatar ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-zinc-600 dark:text-zinc-400" />
                                                ) : (
                                                    <Camera className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                                                )}
                                            </button>
                                            <button
                                                onClick={handleRemoveAvatar}
                                                disabled={isUploadingAvatar || !user.profile_image}
                                                className="p-2.5 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-zinc-400 hover:text-rose-500 transition-colors disabled:opacity-30"
                                                title="사진 삭제"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            onChange={handleFileChange}
                                            className="hidden"
                                            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                                        />
                                    </div>
                                    <h2 className="text-xl font-black dark:text-white">{user.nickname}</h2>
                                    <p className="text-xs text-zinc-500 font-medium mt-1">{user.email}</p>

                                    <div className="flex justify-center gap-2 mt-4">
                                        <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-none font-bold">
                                            {user.login_type?.toUpperCase()}
                                        </Badge>
                                        <Badge variant="outline" className="text-[10px] font-bold border-zinc-200 dark:border-zinc-800 text-zinc-500">
                                            가입일: {user.created_at ? new Date(user.created_at).toLocaleDateString() : '알 수 없음'}
                                        </Badge>
                                    </div>
                                </div>
                                <div className="border-t border-zinc-100 dark:border-zinc-800 p-4">
                                    <Button
                                        variant="ghost"
                                        onClick={logout}
                                        className="w-full text-zinc-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 font-bold gap-2 rounded-xl"
                                    >
                                        <LogOut className="h-4 w-4" />
                                        로그아웃
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-none shadow-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <ShieldCheck className="h-6 w-6" />
                                <h3 className="font-black">계정 보안 등급: 우수</h3>
                            </div>
                            <p className="text-xs font-bold opacity-80 leading-relaxed">
                                자산 데이터 동기화 및 강력한 비밀번호 설정으로 안전하게 보호되고 있습니다.
                            </p>
                        </Card>
                    </div>

                    {/* Right Column: Settings Sections */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* 1. Profile Settings */}
                        <Card className="border-none shadow-xl bg-white dark:bg-zinc-900 overflow-hidden">
                            <CardHeader className="pb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-xl text-zinc-900 dark:text-white">
                                        <User className="h-5 w-5" />
                                    </div>
                                    <CardTitle className="text-lg font-black dark:text-white">프로필 설정</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">닉네임</label>
                                    <Input
                                        value={nickname}
                                        onChange={(e) => setNickname(e.target.value)}
                                        className="h-12 bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 rounded-xl text-sm font-medium focus:ring-indigo-500"
                                        placeholder="사용하실 닉네임을 입력하세요"
                                    />
                                    <p className="text-[10px] text-zinc-400 font-medium">커뮤니티 및 대시보드에서 표시되는 이름입니다.</p>
                                </div>

                                <div className="flex items-center justify-between py-4 border-t border-zinc-100 dark:border-zinc-800">
                                    <div className="space-y-1">
                                        <h4 className="text-sm font-bold dark:text-white">뉴스레터 및 마케팅 수신 동의</h4>
                                        <p className="text-xs text-zinc-500 font-medium">새로운 기능 소식 및 투자 인사이트를 메일로 받습니다.</p>
                                    </div>
                                    <button
                                        onClick={() => setMarketingOptIn(!marketingOptIn)}
                                        className={cn(
                                            "w-12 h-6 rounded-full relative transition-all duration-300",
                                            marketingOptIn ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-800"
                                        )}
                                    >
                                        <div className={cn(
                                            "absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300",
                                            marketingOptIn ? "left-7" : "left-1"
                                        )} />
                                    </button>
                                </div>

                                <div className="pt-2">
                                    <Button
                                        onClick={handleUpdateProfile}
                                        disabled={isUpdatingProfile}
                                        className="w-full h-12 bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 text-white font-black rounded-xl gap-2 hover:scale-[1.02] active:scale-95 transition-all"
                                    >
                                        {isUpdatingProfile ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Sparkles className="h-4 w-4" />
                                        )}
                                        설정 저장
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* 2. Security (Password Update) - Show only for email users */}
                        {user.login_type === "email" && (
                            <Card className="border-none shadow-xl bg-white dark:bg-zinc-900 overflow-hidden">
                                <CardHeader className="pb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-xl text-zinc-900 dark:text-white">
                                            <Lock className="h-5 w-5" />
                                        </div>
                                        <CardTitle className="text-lg font-black dark:text-white">비밀번호 변경</CardTitle>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">현재 비밀번호</label>
                                            <Input
                                                type="password"
                                                value={passwords.old}
                                                onChange={(e) => setPasswords({ ...passwords, old: e.target.value })}
                                                className="h-12 bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 rounded-xl"
                                            />
                                        </div>
                                        <div className="hidden md:block" />
                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">새 비밀번호</label>
                                            <Input
                                                type="password"
                                                value={passwords.new}
                                                onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                                                className="h-12 bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 rounded-xl"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">비밀번호 확인</label>
                                            <Input
                                                type="password"
                                                value={passwords.confirm}
                                                onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                                                className="h-12 bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 rounded-xl"
                                            />
                                        </div>
                                    </div>

                                    <AnimatePresence>
                                        {passwordStatus.type && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                                className={cn(
                                                    "p-4 rounded-xl flex items-center gap-3 border",
                                                    passwordStatus.type === 'success'
                                                        ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 border-emerald-100 dark:border-emerald-900/30"
                                                        : "bg-rose-50 dark:bg-rose-950/20 text-rose-600 border-rose-100 dark:border-rose-900/30"
                                                )}
                                            >
                                                {passwordStatus.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                                                <span className="text-xs font-bold">{passwordStatus.message}</span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    <div className="pt-4">
                                        <Button
                                            onClick={handleChangePassword}
                                            disabled={isChangingPassword}
                                            className="w-full h-12 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white font-black rounded-xl transition-all"
                                        >
                                            {isChangingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : "비밀번호 업데이트"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* 3. Danger Zone - Redesigned to be more subtle */}
                        <div className="pt-8 border-t border-zinc-200 dark:border-zinc-800">
                            <div className="flex flex-col items-center">
                                {!showDeleteConfirm ? (
                                    <button
                                        onClick={() => setShowDeleteConfirm(true)}
                                        className="text-xs font-bold text-zinc-400 hover:text-rose-500 transition-colors flex items-center gap-2"
                                    >
                                        <ShieldAlert className="h-3 w-3" />
                                        Tutum 서비스를 더 이상 이용하고 싶지 않으신가요? (회원 탈퇴)
                                    </button>
                                ) : (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="w-full p-6 bg-rose-50 dark:bg-rose-950/10 rounded-2xl border border-rose-100 dark:border-rose-900/20 text-center"
                                    >
                                        <p className="text-sm font-black text-rose-600 dark:text-rose-400 mb-2">정말로 탈퇴하시겠습니까?</p>
                                        <p className="text-xs text-rose-500/70 font-medium mb-6">모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다.</p>
                                        <div className="flex gap-4 max-w-xs mx-auto">
                                            <Button
                                                variant="outline"
                                                onClick={() => setShowDeleteConfirm(false)}
                                                className="flex-1 h-10 rounded-xl font-bold border-zinc-200 dark:border-zinc-800"
                                            >
                                                취소
                                            </Button>
                                            <Button
                                                disabled={isDeleting}
                                                onClick={handleDeleteAccount}
                                                className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black"
                                            >
                                                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "회원 탈퇴"}
                                            </Button>
                                        </div>
                                    </motion.div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
