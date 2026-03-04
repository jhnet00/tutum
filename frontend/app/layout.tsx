import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { FavoritesProvider } from "@/context/FavoritesContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AssetProvider } from "@/context/AssetContext";
import { MarketPriceProvider } from "@/context/MarketPriceContext";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tutum - 안전한 AI 자산 관리",
  description: "Tutum과 함께 스마트한 투자를 시작하세요. 실시간 시세부터 AI 인사이트까지.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css"
        />
      </head>
      <body
        className="font-sans antialiased"
        style={{
          fontFamily:
            '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif',
        }}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <FavoritesProvider>
                <AssetProvider>
                  <MarketPriceProvider>
                    {children}
                  </MarketPriceProvider>
                </AssetProvider>
            </FavoritesProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
