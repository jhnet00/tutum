"use client";

/**
 * ============================================
 * ProfileModal - 사용자 프로필 수정 모달
 * ============================================
 * 
 * 사용자가 자신의 프로필(닉네임, 아이디)을 수정할 수 있는 모달입니다.
 * PortfolioHeader의 사용자 메뉴에서 '내 정보 수정' 클릭 시 열립니다.
 * 
 * 사용되는 Context: AuthContext (useAuth)
 */

import React, { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { buildAuthUrl } from "@/lib/auth-endpoint";

interface ProfileModalProps {
    isOpen: boolean;   // 모달 열림 상태
    onClose: () => void;  // 닫기 콜백
}

export default function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
    const { user, token, updateUser, logout } = useAuth();

    const [nickname, setNickname] = useState("");
    const [userId, setUserId] = useState("");
    const [isUpdating, setIsUpdating] = useState(false);
    const [isWithdrawing, setIsWithdrawing] = useState(false);

    useEffect(() => {
        if (user && isOpen) {
            setNickname(user.nickname || "");
            setUserId(user.id || "");
        }
    }, [user, isOpen]);

    if (!isOpen) return null;

    const handleUpdate = async () => {
        if (!nickname.trim() || !userId.trim()) {
            alert("닉네임과 아이디를 모두 입력해주세요.");
            return;
        }
        setIsUpdating(true);
        try {
            // TODO: 백엔드 API 연동 (PUT /api/v1/auth/me)
            updateUser({ nickname, id: userId });
            onClose();
        } finally {
            setIsUpdating(false);
        }
    };

    const handleWithdraw = async () => {
        if (!confirm("정말로 탈퇴하시겠습니까? 모든 데이터가 영구적으로 삭제됩니다.")) {
            return;
        }

        setIsWithdrawing(true);
        try {
            const response = await fetch(buildAuthUrl("/api/v1/auth/me"), {
                method: "DELETE",
                credentials: "include",
                headers: {
                    "Authorization": `Bearer ${token}`,
                },
            });

            if (response.ok) {
                alert("회원 탈퇴가 완료되었습니다. 그동안 이용해주셔서 감사합니다.");
                logout();
            } else {
                const data = await response.json();
                alert(data.detail || "탈퇴 처리 중 오류가 발생했습니다.");
            }
        } catch (error) {
            console.error("Withdrawal Error:", error);
            alert("서버와 통신하는 도중 오류가 발생했습니다.");
        } finally {
            setIsWithdrawing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300 px-4">
            <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
                {/* 모달 헤더 */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
                    <h2 className="text-xl font-bold text-white">내 프로필</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-white"
                        type="button"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* 모달 본문 */}
                <div className="p-8 space-y-8">
                    {/* 프로필 수정 폼 */}
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-white">닉네임</label>
                            <Input
                                value={nickname}
                                onChange={(e) => setNickname(e.target.value)}
                                className="bg-zinc-800 border-zinc-700 text-white h-12 rounded-xl focus:ring-zinc-600 px-4"
                                placeholder="닉네임을 입력하세요"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-bold text-white">아이디</label>
                            <Input
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                                className="bg-zinc-800 border-zinc-700 text-white h-12 rounded-xl focus:ring-zinc-600 px-4"
                                placeholder="아이디를 입력하세요"
                            />
                        </div>
                    </div>

                    {/* 액션 버튼 */}
                    <div className="space-y-4 pt-4">
                        <Button
                            onClick={handleUpdate}
                            className="w-full h-14 bg-zinc-400 hover:bg-zinc-300 text-zinc-900 font-bold text-lg rounded-full transition-all"
                            type="button"
                            disabled={isUpdating || isWithdrawing}
                        >
                            {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : "변경"}
                        </Button>
                        <button 
                            onClick={handleWithdraw}
                            disabled={isUpdating || isWithdrawing}
                            className="w-full text-center text-xs text-zinc-600 hover:text-zinc-400 transition-colors underline-offset-4 hover:underline disabled:opacity-50"
                        >
                            {isWithdrawing ? "탈퇴 처리 중..." : "회원탈퇴"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
