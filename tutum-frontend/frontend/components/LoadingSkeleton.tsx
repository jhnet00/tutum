import { Card, CardContent } from "@/components/ui/card";

export default function LoadingSkeleton({ type = "card" }: { type?: "card" | "list" }) {
    if (type === "list") {
        return (
            <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="h-10 w-10 rounded-full bg-muted"></div>
                        <div className="flex-1 space-y-2">
                            <div className="h-4 w-3/4 rounded bg-muted"></div>
                            <div className="h-3 w-1/2 rounded bg-muted/70"></div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <Card>
            <CardContent className="p-6">
                <div className="animate-pulse space-y-4">
                    <div className="h-6 w-3/4 rounded bg-muted"></div>
                    <div className="h-4 w-full rounded bg-muted/70"></div>
                    <div className="h-4 w-5/6 rounded bg-muted/70"></div>
                </div>
            </CardContent>
        </Card>
    );
}
