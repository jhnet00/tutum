import { notFound } from "next/navigation";

import FooterInfoPage from "@/components/FooterInfoPage";
import { companyPages } from "@/lib/footer-pages";

export function generateStaticParams() {
  return Object.keys(companyPages).map((slug) => ({ slug }));
}

export default function CompanyInfoPage({ params }: { params: { slug: string } }) {
  const page = companyPages[params.slug];

  if (!page) {
    notFound();
  }

  return <FooterInfoPage {...page} />;
}
