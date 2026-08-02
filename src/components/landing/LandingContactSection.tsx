import { motion } from "framer-motion";
import { Building2, Mail, MapPin, Phone } from "lucide-react";
import { companyContact, companyFullAddress, companyTelHref, hasPublicAddress, hasPublicPhone } from "@/lib/companyContact";

export function LandingContactSection() {
  return (
    <section id="contact" className="container py-20 md:py-28">
      <motion.div
        className="landing-reveal rounded-[2rem] border border-white/10 bg-[#0f1016] p-8 md:p-12"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
          <div className="space-y-4">
            <p className="text-primary font-semibold">Contact</p>
            <h2 className="landing-display text-4xl md:text-5xl text-white uppercase leading-none">
              Get in touch
            </h2>
            <p className="text-white/70 text-lg leading-relaxed max-w-md">
              {companyContact.productName} is operated by {companyContact.legalName}. Reach us for
              support, partnerships, or business enquiries.
            </p>
          </div>

          <div className="space-y-5">
            <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-black/30 p-5">
              <Building2 className="h-5 w-5 shrink-0 text-primary mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white/55 uppercase tracking-wide">Company</p>
                <p className="mt-1 text-lg font-bold text-white">{companyContact.legalName}</p>
                <p className="text-sm text-white/60">{companyContact.productName}</p>
              </div>
            </div>

            <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-black/30 p-5">
              <Mail className="h-5 w-5 shrink-0 text-primary mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white/55 uppercase tracking-wide">Email</p>
                <a
                  href={`mailto:${companyContact.email}`}
                  className="mt-1 block text-lg font-semibold text-primary hover:underline"
                >
                  {companyContact.email}
                </a>
              </div>
            </div>

            <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-black/30 p-5">
              <Phone className="h-5 w-5 shrink-0 text-primary mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white/55 uppercase tracking-wide">Phone</p>
                {hasPublicPhone() ? (
                  <a
                    href={companyTelHref()}
                    className="mt-1 block text-lg font-semibold text-white hover:text-primary transition-colors"
                  >
                    {companyContact.phone}
                  </a>
                ) : (
                  <p className="mt-1 text-white/45">Phone number configured at deploy time</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-black/30 p-5">
              <MapPin className="h-5 w-5 shrink-0 text-primary mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white/55 uppercase tracking-wide">
                  Business address
                </p>
                {hasPublicAddress() ? (
                  <>
                    {companyContact.address.line1 ? (
                      <p className="mt-1 text-lg text-white leading-relaxed">{companyContact.address.line1}</p>
                    ) : null}
                    {companyContact.address.line2 ? (
                      <p className="text-white/70">{companyContact.address.line2}</p>
                    ) : null}
                    <p className="mt-2 text-sm text-white/50">{companyFullAddress()}</p>
                  </>
                ) : (
                  <p className="mt-1 text-white/45">Business address configured at deploy time</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
