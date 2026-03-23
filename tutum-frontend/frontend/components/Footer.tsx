import Link from "next/link";
import { ArrowUpRight, Gitlab, Mail, Twitter } from "lucide-react";

const socialLinks = [
  {
    label: "GitLab",
    href: "https://gitlab.com/tutum-project/",
    icon: Gitlab,
  },
  {
    label: "X",
    href: "https://x.com/",
    icon: Twitter,
  },
  {
    label: "Email",
    href: "https://outlook.live.com/mail/0/deeplink/compose?to=admin@tutum.my&subject=Tutum%20Inquiry",
    icon: Mail,
  },
];

const footerGroups = [
  {
    title: "서비스",
    links: [
      { label: "주요 기능", href: "/service/features" },
      { label: "요금제", href: "/service/pricing" },
      { label: "업데이트", href: "/service/updates" },
      { label: "가이드", href: "/service/guide" },
    ],
  },
  {
    title: "회사",
    links: [
      { label: "소개", href: "/company/about" },
      { label: "채용", href: "/company/careers" },
      { label: "문의하기", href: "/company/contact" },
    ],
  },
  {
    title: "법적 고지",
    links: [
      { label: "개인정보처리방침", href: "/legal/privacy" },
      { label: "이용약관", href: "/legal/terms" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative w-full border-t border-zinc-100 dark:border-zinc-800 mt-20 bg-background pt-16 pb-32">
      
      <div className="mx-auto max-w-7xl px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-16 mb-20">
          {/* Brand Column */}
          <div className="col-span-2 md:col-span-1">
            <h3 className="text-xl font-black tracking-tighter text-foreground mb-4">Tutum</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              AI 기반 자산 관리의 새로운 기준.<br />
              복잡한 투자를 가장 단순하게.
            </p>
            <div className="flex gap-4">
              {socialLinks.map(({ label, href, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith("http") ? "_blank" : undefined}
                  rel={href.startsWith("http") ? "noreferrer" : undefined}
                  aria-label={label}
                  className="p-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-fuchsia-500 hover:text-white transition-colors"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>
 
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h4 className="font-bold text-foreground mb-4">{group.title}</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="group inline-flex items-center gap-1.5 hover:text-fuchsia-500 transition-colors"
                    >
                      <span>{link.label}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-xs text-zinc-400 font-medium">
                © 2026 TUTUM INC. ALL RIGHTS RESERVED.
            </p>
            <div className="flex gap-6 text-xs text-zinc-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> All Systems Operational</span>
            </div>
        </div>
      </div>

      {/* Big Fading Logo - Background */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-none select-none -z-0 w-full overflow-hidden flex justify-center">
        <h1 className="text-[12rem] sm:text-[18rem] font-black tracking-tighter leading-[0.8] text-transparent bg-clip-text bg-gradient-to-t from-zinc-200 to-transparent dark:from-zinc-900/40 dark:to-transparent transform translate-y-[20%]">
          Tutum
        </h1>
      </div>
    </footer>
  );
}
