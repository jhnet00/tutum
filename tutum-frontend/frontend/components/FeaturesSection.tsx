import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Upload, Cpu, BarChart3 } from "lucide-react";

const features = [
    {
        step: "01",
        title: "스마트 업로드",
        description: "복잡한 금융 내역을 사진이나 CSV 파일로 간단하게 전송하세요.",
        icon: <Upload className="w-8 h-8" />,
    },
    {
        step: "02",
        title: "정밀 로직 분석",
        description: "자체 OCR과 AI 엔진이 데이터를 정교하게 분류하고 최신 시세와 연동합니다.",
        icon: <Cpu className="w-8 h-8" />,
    },
    {
        step: "03",
        title: "통찰력 있는 리포트",
        description: "실시간 뉴스와 시장 지표를 분석하여 최적화된 자산 인사이트를 제안합니다.",
        icon: <BarChart3 className="w-8 h-8" />,
    },
];

export default function FeaturesSection() {
    return (
        <section className="bg-background px-4 py-20 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-16 text-center">
                    <h2 className="mb-4 text-4xl font-black tracking-tight text-foreground uppercase">이용 방법</h2>
                    <p className="text-muted-foreground font-medium text-lg italic-none">3단계로 시작하는 스마트 자산 관리</p>
                </div>

                <div className="grid gap-8 md:grid-cols-3">
                    {features.map((feature) => (
                        <Card key={feature.step} className="border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/50 shadow-none hover:border-emerald-500/50 transition-all duration-300 group overflow-hidden">
                            <CardContent className="pt-10 pb-10 flex flex-col items-center">
                                {/* Step number - Boutique style */}
                                <div className="mb-6">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500 bg-emerald-500/10 px-3 py-1 rounded-full">
                                        Step {feature.step}
                                    </span>
                                </div>

                                {/* Icon - Minimalist */}
                                <div className="mb-10 text-zinc-900 dark:text-zinc-100 p-4 rounded-2xl bg-zinc-50 dark:bg-white/5 group-hover:bg-emerald-500/10 group-hover:text-emerald-500 transition-colors duration-500">
                                    {feature.icon}
                                </div>

                                {/* Content */}
                                <h3 className="mb-3 text-xl font-bold tracking-tight text-foreground">{feature.title}</h3>
                                <p className="text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed text-sm max-w-[220px] mx-auto">{feature.description}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </section>
    );
}
