"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import PortfolioHeader from "@/components/PortfolioHeader";
import { Check, Plus, Scan, X, Loader2, Search, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import Image from "next/image";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
// OCR 전용 서비스 경로 (프록시 기반 라우팅)
const OCR_API_URL = '/api/proxy';

export default function OCRUploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const steps = [{ number: 1, title: "이미지 업로드", id: "upload" }];

  const handleNext = async () => {
    if (selectedFile) {
      // 실제 OCR API 호출
      setIsProcessing(true);
      try {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("user_id", user?.id || "demo-user");

        const uploadResponse = await fetch(`${OCR_API_URL}/import/ocr`, {
          method: "POST",
          body: formData,
        });

        if (!uploadResponse.ok) throw new Error("OCR 업로드 실패");

        const uploadData = await uploadResponse.json();

        // Draft 결과 조회
        const draftResponse = await fetch(
          `${OCR_API_URL}/import/draft/${uploadData.import_id}`,
        );
        if (!draftResponse.ok) throw new Error("OCR 결과 조회 실패");

        const draftData = await draftResponse.json();

        // 최종 등록 전 LocalStorage에 저장하여 통합 등록 폼(bulk-register)으로 전달
        if (draftData?.items) {
          const pendingData = draftData.items.map((item: any) => ({
            uid: Math.random().toString(36).substr(2, 9),
            symbol: item.symbol,
            name: item.symbol,
            type:
              item.asset_type === "stock"
                ? "stock"
                : item.asset_type === "crypto"
                  ? "crypto"
                  : "currency",
            quantity: item.amount,
            price: item.avg_price || 0,
            currency: item.currency || "KRW",
            date: new Date().toISOString().split("T")[0],
            account: "Upbit",
          }));
          localStorage.setItem("pending_assets", JSON.stringify(pendingData));
        }
        // bulk-register가 아직 없을 수 있으므로 direct-input 등으로 임시 리다이렉트 하거나
        // 해당 경로가 실제 존재하는지 확인 필요. 일단 요청대로 유지하되 경로 존재 여부 확인.
        router.push("/direct-input");
      } catch (error) {
        console.error("❌ OCR 처리 에러:", error);
        alert("OCR 처리 중 오류가 발생했습니다. 다시 시도해주세요.");
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handlePrevious = () => {
    router.back();
  };

  const handleFileSelect = (file: File) => {
    if (file && file.type.startsWith("image/")) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      alert("이미지 파일만 업로드 가능합니다.");
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950 transition-colors duration-300">
      <PortfolioHeader />
      <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
        {/* Left Sidebar - Hidden on Mobile */}
        <aside className="w-full md:w-72 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-6 md:p-8 hidden md:block">
          <h1 className="mb-10 text-xl font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-tight">
            OCR 자동 등록
          </h1>
          <nav className="relative flex flex-col gap-8">
            {/* Connecting Line */}
            <div className="absolute left-3 top-3 bottom-3 w-[1px] border-l border-dashed border-zinc-300 dark:border-zinc-700 z-0" />

            {steps.map((step) => (
              <div
                key={step.number}
                className="group relative z-10 flex items-center gap-4 text-left outline-none"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-zinc-900 bg-zinc-900 dark:border-white dark:bg-white shadow-lg">
                  <div className="h-2 w-2 rounded-full bg-white dark:bg-zinc-900" />
                </div>
                <span className="text-sm font-bold text-zinc-900 dark:text-white">
                  {step.title}
                </span>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-12 overflow-y-auto">
          <div className="mx-auto max-w-7xl h-full flex flex-col">
            <div className="flex-1 space-y-8 md:space-y-12">
              {/* Step 1: 이미지 업로드 */}
              <div className="space-y-6 md:space-y-8 h-full flex flex-col">
                <div className="space-y-3 md:space-y-2">
                  <h2 className="text-3xl md:text-4xl font-black tracking-tight text-zinc-900 dark:text-white">
                    자산 내역 촬영/업로드
                  </h2>
                  <p className="text-sm md:text-lg text-zinc-600 dark:text-zinc-400 font-medium leading-relaxed">
                    증권사 앱의 잔고 화면이나 엑셀 표를 캡처하여 업로드해
                    주세요.
                    <br className="hidden md:block" />
                    AI가 종목명, 수량, 평단가를 자동으로 인식하여 통합 등록
                    폼으로 연결합니다.
                  </p>
                </div>

                <div className="flex-1 p-4 md:p-8 rounded-2xl md:rounded-3xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 flex flex-col min-h-[350px] md:min-h-[400px]">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={onFileChange}
                    accept="image/*"
                    className="hidden"
                  />

                  <div
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex-1 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer relative overflow-hidden
                                            ${
                                              isDragging
                                                ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/10 scale-[0.99]"
                                                : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 hover:border-zinc-300 dark:hover:border-zinc-700"
                                            }`}
                  >
                    {!previewUrl ? (
                      <div className="text-center group p-12 pointer-events-none">
                        <div className="mx-auto h-20 w-20 rounded-2xl bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:scale-110 group-hover:bg-zinc-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-zinc-900 transition-all duration-300 mb-6">
                          <Scan className="h-10 w-10" />
                        </div>
                        <p className="text-xl font-bold text-zinc-900 dark:text-white">
                          이미지를 여기에 드래그하거나
                        </p>
                        <button className="mt-4 text-emerald-500 font-bold hover:underline">
                          파일 선택하기
                        </button>
                      </div>
                    ) : (
                      <div className="relative w-full h-full flex items-center justify-center p-8">
                        <div className="relative max-h-full max-w-full shadow-2xl rounded-lg overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewUrl}
                            alt="Preview"
                            className="max-h-[500px] object-contain"
                          />
                          <button
                            onClick={removeFile}
                            className="absolute top-2 right-2 h-8 w-8 rounded-full bg-zinc-900 text-white flex items-center justify-center border-2 border-white dark:border-zinc-950 hover:bg-red-500 transition-colors shadow-lg"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Loading Overlay */}
                    {isProcessing && (
                      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
                        <div className="flex flex-col items-center">
                          <div className="relative mb-6">
                            <Loader2 className="h-16 w-16 animate-spin text-emerald-500" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            </div>
                          </div>
                          <h3 className="text-2xl font-black text-zinc-900 dark:text-white mb-2">
                            AI 엔진 분석 중...
                          </h3>
                          <p className="text-zinc-500 dark:text-zinc-400 font-medium">
                            종목명과 평단가를 정밀 분석하고 있습니다.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* OCR 안내 섹션 */}
                <div className="p-4 md:p-8 rounded-2xl md:rounded-3xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-start gap-4 mb-8">
                    <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
                      <Scan className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
                        정확한 인식을 위한 AI 스캔 가이드
                      </h3>
                      <p className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400">
                        필수 항목들이 포함된 화면을 촬영해 주세요.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8">
                    {/* Correct Example */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-emerald-500">
                        <Check className="h-5 w-5" />
                        <span className="font-bold">좋은 예시 (Correct)</span>
                      </div>
                      <div className="relative aspect-[9/16] w-full max-w-[200px] mx-auto rounded-2xl overflow-hidden border-4 border-emerald-500 shadow-xl shadow-emerald-500/10">
                        <Image
                          src="/images/good.png"
                          alt="Correct Example"
                          fill
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-emerald-500/10 pointer-events-none" />
                        <div className="absolute top-4 right-4 bg-emerald-500 text-white text-[10px] font-black px-2 py-1 rounded">
                          PASS
                        </div>
                      </div>
                      <p className="text-xs text-center text-zinc-500 leading-relaxed px-4">
                        수량, 평단가 필드가 정확히 명시된 화면
                      </p>
                    </div>

                    {/* Wrong Example */}
                    <div className="space-y-4 opacity-70 grayscale-[0.5]">
                      <div className="flex items-center gap-2 text-red-500 justify-end">
                        <span className="font-bold">잘못된 예시 (Wrong)</span>
                        <X className="h-5 w-5" />
                      </div>
                      <div className="relative aspect-[9/16] w-full max-w-[200px] mx-auto rounded-2xl overflow-hidden border-2 border-zinc-200 dark:border-zinc-700">
                        <Image
                          src="/images/bad.png"
                          alt="Wrong Example"
                          fill
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-zinc-900/40 pointer-events-none" />
                        <div className="absolute top-4 right-4 bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded">
                          FAIL
                        </div>
                      </div>
                      <p className="text-xs text-center text-zinc-400 leading-relaxed px-4">
                        요약 정보만 있는 화면은 인식이 어렵습니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 md:mt-12 flex flex-col sm:flex-row items-center justify-between border-t border-zinc-200 dark:border-zinc-800 pt-8 gap-4">
              <Button
                variant="ghost"
                onClick={() => router.back()}
                className="w-full sm:w-auto text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white font-bold h-14 px-8 rounded-2xl gap-2 order-2 sm:order-1"
              >
                <ArrowLeft className="h-5 w-5" />
                취소
              </Button>

              <Button
                onClick={handleNext}
                disabled={!selectedFile || isProcessing}
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white font-black h-14 px-12 rounded-2xl transition-all shadow-xl shadow-emerald-500/20 active:scale-95 text-lg min-w-[240px] order-1 sm:order-2"
              >
                {isProcessing ? "분석 중..." : "AI 스캔 시작 (한꺼번에 등록)"}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
