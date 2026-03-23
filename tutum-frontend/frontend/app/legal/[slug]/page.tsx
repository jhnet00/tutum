import { notFound } from "next/navigation";

import FooterInfoPage from "@/components/FooterInfoPage";
import { legalPages } from "@/lib/footer-pages";

export function generateStaticParams() {
  return Object.keys(legalPages).map((slug) => ({ slug }));
}

export default function LegalInfoPage({ params }: { params: { slug: string } }) {
  const page = legalPages[params.slug];

  if (!page) {
    notFound();
  }

  return <FooterInfoPage {...page} />;
}
