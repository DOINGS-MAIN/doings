import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { LandingContactSection } from "@/components/landing/LandingContactSection";
import { companyContact, companyFullAddress } from "@/lib/companyContact";

export default function ContactPage() {
  return (
    <div className="landing-page min-h-dvh bg-[#0a0b0f] text-foreground">
      <header className="border-b border-white/10">
        <div className="container flex h-16 items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
          <Link to="/" className="landing-display text-2xl text-primary tracking-wide">
            DOINGS
          </Link>
        </div>
      </header>

      <main>
        <LandingContactSection />
      </main>

      <footer className="border-t border-white/10 py-8 bg-[#0a0b0f]">
        <div className="container text-center text-sm text-white/45 space-y-2">
          <p>
            {companyContact.legalName} · {companyContact.email} · {companyContact.phone}
          </p>
          <p>{companyFullAddress()}</p>
          <p>© {new Date().getFullYear()} {companyContact.productName}</p>
        </div>
      </footer>
    </div>
  );
}
