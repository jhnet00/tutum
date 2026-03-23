import { notFound } from "next/navigation";

import FooterInfoPage from "@/components/FooterInfoPage";
import { servicePages } from "@/lib/footer-pages";

export function generateStaticParams() {
  return Object.keys(servicePages).map((slug) => ({ slug }));
}

export default function ServiceInfoPage({ params }: { params: { slug: string } }) {
  const page = servicePages[params.slug];

  if (!page) {
    notFound();
  }

  return <FooterInfoPage {...page} />;
}
