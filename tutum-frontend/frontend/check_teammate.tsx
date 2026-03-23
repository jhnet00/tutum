"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PortfolioHeader from "@/components/PortfolioHeader";
import { Check, Plus, FileUp, X } from "lucide-react";

export default function BulkInsertUploadPage() {
    const [currentStep, setCurrentStep] = useState(1);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();

    const steps = [
        { number: 1, title: "리스트 준비", id: "prepare" },
        { number: 2, title: "리스트 채우기", id: "fill" },
        { number: 3, title: "업로드", id: "upload" },
        { number: 4, title: "확인", id: "confirm" },
    ];

    const handleNext = () => {
        if (currentStep < 4) {
            setCurrentStep(currentStep + 1);
        } else {
            router.push("/portfolio/asset");
        }
    };

    const handlePrevious = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        }
    };

    const handleFileSelect = (file: File) => {
        if (file && (file.type === "text/csv" || file.name.endsWith(".csv"))) {
            setSelectedFile(file);
        } else {
            alert("CSV 파일만 업로드 가능합니다.");
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
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950 transition-colors duration-300">
            <PortfolioHeader />
            <div className="flex flex-1">
                {/* Left Sidebar */}
                <aside className="w-72 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-8">
                    <h1 className="mb-10 text-xl font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-tight">대량 등록하기</h1>
                    <nav className="relative flex flex-col gap-8">
                        {/* Connecting Line */}
                        <div className="absolute left-3 top-3 bottom-3 w-[1px] border-l border-dashed border-zinc-300 dark:border-zinc-700 z-0" />

                        {steps.map((step) => (
                            <button
                                key={step.number}
                                onClick={() => setCurrentStep(step.number)}
                                className="group relative z-10 flex items-center gap-4 text-left outline-none"
                            >
                                <div
                                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 ${currentStep >= step.number
                                        ? "bg-zinc-900 border-zinc-900 dark:bg-white dark:border-white shadow-lg"
                                        : "bg-zinc-50 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                        }`}
                                >
                                    {currentStep > step.number ? (
                                        <Check className="h-3.5 w-3.5 text-white dark:text-zinc-900" strokeWidth={4} />
                                    ) : (
                                        <div className={`h-2 w-2 rounded-full ${currentStep === step.number ? "bg-white dark:bg-zinc-900" : "bg-transparent"}`} />
                                    )}
                                </div>
                                <span className={`text-sm font-bold transition-colors duration-300 ${currentStep === step.number
                                    ? "text-zinc-900 dark:text-white"
                                    : "text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-900 dark:group-hover:text-zinc-300"
                                    }`}>
                                    {step.title}
                                </span>
                            </button>
                        ))}
                    </nav>
                </aside>

                {/* Main Content */}
                <main className="flex-1 p-12">
                    <div className="mx-auto max-w-7xl h-full flex flex-col">
                        <div className="flex-1">
                            {/* Step 1: 리스트 준비 */}
                            {currentStep === 1 && (
                                <div className="space-y-8">
                                    <h2 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">
                                        종목/거래내역 리스트 준비
                                    </h2>
                                    <div className="space-y-6">
                                        <p className="text-lg text-zinc-600 dark:text-zinc-400 font-medium leading-relaxed">
                                            여러 개의 자산 또는 거래 내역을 CSV 파일로 업로드할 수 있습니다.<br />
                                            아래 템플릿을 다운받으신 후 정보를 입력하거나, 갖고 계신 파일을 형식에 맞추어 편집해 주세요.
                                        </p>

                                        <div className="flex flex-wrap gap-4">
                                            <a
                                                href="/templates/domino_assets_win.csv"
                                                download="domino_assets_win.csv"
                                                className="px-6 py-3.5 bg-white dark:bg-zinc-100 text-zinc-900 font-bold rounded-xl shadow-sm border border-zinc-200 dark:border-transparent hover:bg-zinc-50 dark:hover:bg-white transition-all active:scale-95 flex items-center gap-2"
                                            >
                                                <span>Windows용 템플릿 파일 다운로드</span>
                                            </a>
                                            <a
                                                href="/templates/domino_assets_win.csv"
                                                download="domino_assets_mac.csv"
                                                className="px-6 py-3.5 bg-white dark:bg-zinc-100 text-zinc-900 font-bold rounded-xl shadow-sm border border-zinc-200 dark:border-transparent hover:bg-zinc-50 dark:hover:bg-white transition-all active:scale-95 flex items-center gap-2"
                                            >
                                                <span>Mac용 템플릿 파일 다운로드</span>
                                            </a>
                                        </div>

                                        <p className="text-sm font-bold text-zinc-400 dark:text-zinc-600">
                                            CSV 파일은 메모장, excel, numbers 등 무료 프로그램으로 편집 가능합니다.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Step 2: 리스트 채우기 */}
                            {currentStep === 2 && (
                                <div className="space-y-10">
                                    <header className="space-y-4">
                                        <h2 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">
                                            리스트 채우는 방법
                                        </h2>
                                        <p className="text-zinc-600 dark:text-zinc-400 font-medium leading-relaxed">
                                            종목별 최신 보유 현황을 업로드하거나 거래내역 전체를 업로드할 수 있어요. 기존에 등록한 보유/거래 내역이 있다면 기존 내역에 새 업로드 내역이 추가됩니다.
                                        </p>
                                    </header>

                                    {/* Method 1 */}
                                    <section className="space-y-6">
                                        <div className="space-y-2">
                                            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">1. 종목별 최신 보유 현황 업로드</h3>
                                            <p className="text-sm text-zinc-500 dark:text-zinc-500 font-medium leading-relaxed">
                                                현재 보유 중인 종목의 최종 현황만 업로드 하시려면, 템플릿 파일에서 종목명 또는 종목코드, 수량, 평단가를 채워주세요.<br />
                                                종목명, 종목코드, 심볼 모두 입력 가능해요.
                                            </p>
                                        </div>

                                        {/* Icons */}
                                        <div className="flex gap-8">
                                            <div className="flex items-center gap-3 font-bold text-sm">
                                                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] shadow-sm">SAMSUNG</div>
                                                <div>
                                                    <div className="text-zinc-900 dark:text-white">삼성전자</div>
                                                    <div className="text-zinc-400 dark:text-zinc-600 font-medium tracking-tighter text-xs">005930<br />(종목코드)</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 font-bold text-sm">
                                                <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center text-white text-[10px] shadow-sm">TESLA</div>
                                                <div>
                                                    <div className="text-zinc-900 dark:text-white">테슬라</div>
                                                    <div className="text-zinc-400 dark:text-zinc-600 font-medium tracking-tighter text-xs">TSLA<br />(심볼)</div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <h4 className="text-[10px] font-black text-emerald-500 dark:text-emerald-400 uppercase tracking-widest">템플릿 입력 예시</h4>
                                            <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                                                <table className="w-full text-xs text-left">
                                                    <thead className="bg-zinc-50 dark:bg-zinc-900 font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest border-b border-zinc-200 dark:border-zinc-800">
                                                        <tr>
                                                            <th className="px-5 py-3 border-r border-zinc-200 dark:border-zinc-800">종목명/종목 코드</th>
                                                            <th className="px-5 py-3 border-r border-zinc-200 dark:border-zinc-800">수량</th>
                                                            <th className="px-5 py-3 border-r border-zinc-200 dark:border-zinc-800">평단가</th>
                                                            <th className="px-5 py-3">환율</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-transparent font-bold">
                                                        <tr className="text-zinc-900 dark:text-zinc-100">
                                                            <td className="px-5 py-3 border-r border-zinc-200 dark:border-zinc-800">삼성전자</td>
                                                            <td className="px-5 py-3 border-r border-zinc-200 dark:border-zinc-800">2</td>
                                                            <td className="px-5 py-3 border-r border-zinc-200 dark:border-zinc-800">88,000</td>
                                                            <td className="px-5 py-3"></td>
                                                        </tr>
                                                        <tr className="text-zinc-900 dark:text-zinc-100">
                                                            <td className="px-5 py-3 border-r border-zinc-200 dark:border-zinc-800">테슬라</td>
                                                            <td className="px-5 py-3 border-r border-zinc-200 dark:border-zinc-800">10</td>
                                                            <td className="px-5 py-3 border-r border-zinc-200 dark:border-zinc-800">256.50</td>
                                                            <td className="px-5 py-3 text-emerald-500 dark:text-emerald-400">1,250</td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Method 2 */}
                                    <section className="space-y-6">
                                        <div className="space-y-2">
                                            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">2. 거래내역 업로드</h3>
                                            <div className="text-sm text-zinc-500 dark:text-zinc-500 font-medium leading-relaxed">
                                                <p>종목별 거래내역 전체를 업로드하시려면, 거래 유형과 거래일을 추가로 채워주세요.</p>
                                                <ul className="mt-1 space-y-0.5">
                                                    <li className="flex items-start gap-1">
                                                        <span className="text-yellow-500">•</span>
                                                        <span>해외 종목의 경우 환율을 입력하지 않으면 업로드 시의 환율이 적용됩니다.</span>
                                                    </li>
                                                    <li className="flex items-start gap-1">
                                                        <span className="text-yellow-500">•</span>
                                                        <span>앱에서는 등록한 거래내역을 확인 가능하며, 거래내역을 수정 및 삭제하시려면 <b>Tutum 앱</b>에서 진행해 주세요.</span>
                                                    </li>
                                                </ul>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <h4 className="text-[10px] font-black text-emerald-500 dark:text-emerald-400 uppercase tracking-widest">템플릿 입력 예시</h4>
                                            <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                                                <table className="w-full text-xs text-left">
                                                    <thead className="bg-zinc-50 dark:bg-zinc-900 font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest border-b border-zinc-200 dark:border-zinc-800">
                                                        <tr>
                                                            <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">종목명/종목 코드</th>
                                                            <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">수량</th>
                                                            <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">평단가</th>
                                                            <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">환율</th>
                                                            <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">거래 유형</th>
                                                            <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">거래일</th>
                                                            <th className="px-4 py-3">계좌명</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-transparent font-bold">
                                                        <tr className="text-zinc-900 dark:text-zinc-100">
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">삼성전자</td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">2</td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">88,000</td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800"></td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">매수</td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">2023-04-07 15:40:30</td>
                                                            <td className="px-4 py-3 font-medium text-xs">키움증권</td>
                                                        </tr>
                                                        <tr className="text-zinc-900 dark:text-zinc-100">
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">테슬라</td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">10</td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">256.50</td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800 text-emerald-500">1,250</td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">매도</td>
                                                            <td className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-800">2023-04-07</td>
                                                            <td className="px-4 py-3 font-medium text-xs">미래에셋</td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            )}

                            {/* Step 3: 업로드 */}
                            {currentStep === 3 && (
                                <div className="space-y-8 h-full flex flex-col">
                                    <h2 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">업로드</h2>

                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={onFileChange}
                                        accept=".csv"
                                        className="hidden"
                                    />

                                    <div
                                        onDragOver={onDragOver}
                                        onDragLeave={onDragLeave}
                                        onDrop={onDrop}
                                        onClick={() => fileInputRef.current?.click()}
                                        className={`flex-1 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed transition-all duration-300 min-h-[400px] cursor-pointer
                                            ${isDragging
                                                ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/10 scale-[0.99]"
                                                : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                                            }`}
                                    >
                                        {!selectedFile ? (
                                            <div className="text-center group p-12 pointer-events-none">
                                                <div className="mx-auto h-20 w-20 rounded-2xl bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:scale-110 group-hover:bg-zinc-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-zinc-900 transition-all duration-300 mb-6">
                                                    <Plus className="h-10 w-10" />
                                                </div>
                                                <p className="text-xl font-bold text-zinc-900 dark:text-white">CSV 파일을 여기에 드래그하거나</p>
                                                <button className="mt-4 text-emerald-500 font-bold hover:underline">파일 선택하기</button>
                                            </div>
                                        ) : (
                                            <div className="text-center p-12 w-full max-w-md animate-in fade-in zoom-in duration-300">
                                                <div className="mx-auto h-24 w-24 rounded-3xl bg-emerald-500 flex items-center justify-center text-white shadow-xl shadow-emerald-500/20 mb-6 relative group">
                                                    <FileUp className="h-12 w-12" />
                                                    <button
                                                        onClick={removeFile}
                                                        className="absolute -top-3 -right-3 h-8 w-8 rounded-full bg-zinc-900 text-white flex items-center justify-center border-2 border-white dark:border-zinc-950 hover:bg-red-500 transition-colors"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xl font-black text-zinc-900 dark:text-white truncate px-4">{selectedFile.name}</p>
                                                    <p className="text-sm font-bold text-zinc-500 dark:text-zinc-400">
                                                        {(selectedFile.size / 1024).toFixed(1)} KB • 업로드 준비 완료
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={removeFile}
                                                    className="mt-6 text-sm font-bold text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                                                >
                                                    다른 파일 선택하기
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Step 4: 확인 */}
                            {currentStep === 4 && (
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <h2 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white flex items-center gap-2">
                                            거의 다 끝났어요 🎉
                                        </h2>
                                        <p className="text-zinc-500 dark:text-zinc-400 font-medium">
                                            등록 내역이 정확한지 확인해 주세요.
                                        </p>
                                    </div>

                                    {/* 페이지네이션 컨트롤 */}
                                    <div className="flex items-center gap-2">
                                        <button className="w-8 h-8 rounded-full border border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition">
                                            <span className="text-xs">◀</span>
                                        </button>
                                        <button className="w-8 h-8 rounded-full border border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition">
                                            <span className="text-xs">▶</span>
                                        </button>
                                    </div>

                                    {/* 편집 가능한 테이블 */}
                                    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                                                <tr>
                                                    <th className="px-4 py-3 font-semibold w-12"></th>
                                                    <th className="px-4 py-3 font-semibold">종목 100개</th>
                                                    <th className="px-4 py-3 font-semibold">보유량</th>
                                                    <th className="px-4 py-3 font-semibold">평단가</th>
                                                    <th className="px-4 py-3 font-semibold">환율 ⓘ</th>
                                                    <th className="px-4 py-3 font-semibold">거래 유형 ⓘ</th>
                                                    <th className="px-4 py-3 font-semibold">거래일</th>
                                                    <th className="px-4 py-3 font-semibold">계좌명 ⓘ</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-transparent">
                                                {/* 예시 데이터 - 실제로는 파싱된 CSV 데이터 사용 */}
                                                <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                                                    <td className="px-4 py-3 text-zinc-400">1</td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-[8px] font-bold shrink-0">분데스</div>
                                                            <input type="text" defaultValue="분데스 서브" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white font-semibold" />
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="10주" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="68,300원" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="0원" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="" placeholder="매수/매도" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="" placeholder="2024-01-01" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="" placeholder="계좌명" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                </tr>
                                                <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                                                    <td className="px-4 py-3 text-zinc-400">2</td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white text-[8px] font-bold shrink-0">TSLA</div>
                                                            <div className="flex-1">
                                                                <input type="text" defaultValue="TSLA" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white font-semibold" />
                                                                <input type="text" defaultValue="테슬라" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-400 text-xs" />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="10주" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="223.4달러" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="1,298.5원" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="매수" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-emerald-500 font-medium" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="23-06-03 22:30" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="" placeholder="계좌명" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                </tr>
                                                <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                                                    <td className="px-4 py-3 text-zinc-400">3</td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-[8px] font-bold shrink-0">삼성</div>
                                                            <div className="flex-1">
                                                                <input type="text" defaultValue="삼성전자" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white font-semibold" />
                                                                <input type="text" defaultValue="005930(KS)" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-400 text-xs" />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="20주" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="152,500원" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="0원" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="매수" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-emerald-500 font-medium" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="2026-01-23" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" defaultValue="422-04-225598" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                    </td>
                                                </tr>
                                                {/* 빈 행들 */}
                                                {[4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((num) => (
                                                    <tr key={num} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                                                        <td className="px-4 py-3 text-zinc-400">{num}</td>
                                                        <td className="px-4 py-3">
                                                            <input type="text" placeholder="종목명/코드" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input type="text" placeholder="0주" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input type="text" placeholder="0원" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input type="text" placeholder="0원" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input type="text" placeholder="매수/매도" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input type="text" placeholder="날짜" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input type="text" placeholder="계좌" className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-emerald-500 focus:outline-none text-zinc-900 dark:text-white" />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Navigation Buttons */}
                        <div className="mt-12 flex items-center justify-center gap-4">
                            <button
                                onClick={handlePrevious}
                                disabled={currentStep === 1}
                                className={`px-10 py-4 rounded-full font-bold transition-all ${currentStep === 1
                                    ? "opacity-0 pointer-events-none"
                                    : "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800"
                                    }`}
                            >
                                이전
                            </button>
                            <button
                                onClick={handleNext}
                                disabled={currentStep === 3 && !selectedFile}
                                className={`px-10 py-4 rounded-full font-bold shadow-xl transition-all ${currentStep === 3 && !selectedFile
                                    ? "bg-zinc-200 text-zinc-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-600 shadow-none"
                                    : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-zinc-900/10 dark:shadow-none hover:scale-105 active:scale-95"
                                    }`}
                            >
                                {currentStep === 4 ? "등록하기" : "다음"}
                            </button>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
