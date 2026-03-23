import Link from "next/link";
import { ArrowRight } from "lucide-react";

import Footer from "@/components/Footer";
import TopNav from "@/components/TopNav";
import type { FooterPageEntry } from "@/lib/footer-pages";

function isExternalHref(href: string) {
  return href.startsWith("http") || href.startsWith("mailto:");
}

export default function FooterInfoPage({
  eyebrow,
  title,
  description,
  sections,
  ctaLabel,
  ctaHref,
  variant = "default",
}: FooterPageEntry) {
  const external = isExternalHref(ctaHref);
  const isLegal = variant === "legal";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-12%] top-16 h-72 w-72 rounded-full bg-fuchsia-500/12 blur-3xl" />
          <div className="absolute right-[-10%] top-32 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="absolute bottom-[-8%] left-1/3 h-80 w-80 rounded-full bg-pink-500/10 blur-3xl" />
        </div>

        <section className="relative mx-auto max-w-7xl px-6 pb-10 pt-24 lg:px-8 lg:pt-28">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-fuchsia-600 dark:text-fuchsia-400">
              {eyebrow}
            </span>
            <h1 className="mt-6 text-4xl font-black tracking-tight text-foreground sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {description}
            </p>
          </div>
        </section>

        {isLegal ? (
          <>
            <section className="relative mx-auto max-w-4xl px-6 py-6 lg:px-8">
              <div className="space-y-10">
                {sections.map((section, index) => (
                  <article
                    key={section.title}
                    className={`pb-10 ${index < sections.length - 1 ? "border-b border-zinc-200/80 dark:border-zinc-800" : ""}`}
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                      Section {String(index + 1).padStart(2, "0")}
                    </p>
                    <h2 className="mt-3 text-2xl font-black text-foreground">{section.title}</h2>
                    <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-[15px]">
                      {section.body}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <section className="relative mx-auto max-w-4xl px-6 py-12 lg:px-8">
              <div className="border-t border-zinc-200/80 pt-6 dark:border-zinc-800">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                  Related Link
                </p>
                {external ? (
                  <a
                    href={ctaHref}
                    target={ctaHref.startsWith("http") ? "_blank" : undefined}
                    rel={ctaHref.startsWith("http") ? "noreferrer" : undefined}
                    className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-foreground transition hover:text-zinc-500"
                  >
                    <span>{ctaLabel}</span>
                    <ArrowRight className="h-4 w-4" />
                  </a>
                ) : (
                  <Link
                    href={ctaHref}
                    className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-foreground transition hover:text-zinc-500"
                  >
                    <span>{ctaLabel}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="relative mx-auto max-w-7xl px-6 py-6 lg:px-8">
              <div className="grid gap-5 lg:grid-cols-3">
                {sections.map((section) => (
                  <article
                    key={section.title}
                    className="rounded-3xl border border-zinc-200/70 bg-white/75 p-6 shadow-[0_24px_50px_-34px_rgba(15,23,42,0.28)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70"
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                      Overview
                    </p>
                    <h2 className="mt-3 text-xl font-black text-foreground">{section.title}</h2>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{section.body}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="relative mx-auto max-w-7xl px-6 py-16 lg:px-8">
              <div className="rounded-[2rem] border border-zinc-200/70 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-800 px-8 py-10 text-white shadow-[0_30px_60px_-34px_rgba(24,24,27,0.65)]">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-300">
                  Next Step
                </p>
                <div className="mt-4 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                  <div className="max-w-2xl">
                    <h2 className="text-2xl font-black sm:text-3xl">필요한 정보만 빠르게 확인할 수 있도록 구성했습니다.</h2>
                    <p className="mt-3 text-sm leading-6 text-zinc-300 sm:text-base">
                      더 자세한 사용 흐름은 실제 화면에서 바로 이어서 확인할 수 있습니다.
                    </p>
                  </div>
                  {external ? (
                    <a
                      href={ctaHref}
                      target={ctaHref.startsWith("http") ? "_blank" : undefined}
                      rel={ctaHref.startsWith("http") ? "noreferrer" : undefined}
                      className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-zinc-200"
                    >
                      <span>{ctaLabel}</span>
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  ) : (
                    <Link
                      href={ctaHref}
                      className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-zinc-200"
                    >
                      <span>{ctaLabel}</span>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
