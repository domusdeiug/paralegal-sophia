import { createFileRoute, Link } from "@tanstack/react-router";
import { Scale } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy Policy — Paralegal AI" },
      { name: "description", content: "Privacy Policy for Paralegal AI." },
      { property: "og:title", content: "Privacy Policy — Paralegal AI" },
      { property: "og:url", content: "/privacy" },
      { name: "robots", content: "noindex,follow" },
    ],
    links: [{ rel: "canonical", href: "/privacy" }],
  }),
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <Link to="/" className="flex items-center gap-2 font-bold text-primary">
          <Scale className="h-6 w-6" />
          Paralegal AI
        </Link>
        <Link to="/auth" className="text-sm font-medium text-primary hover:text-accent">
          Sign in
        </Link>
      </header>

      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 w-full">
        <h1 className="text-4xl font-bold text-primary mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: May 2026</p>

        <div className="prose prose-sm max-w-none text-foreground space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">1. Who We Are</h2>
            <p className="text-muted-foreground leading-relaxed">
              Paralegal AI ("we", "us", "our") operates the Paralegal AI platform at paralegalai.app.
              This Privacy Policy explains how we collect, use, and protect your personal information when
              you use our Service. By using the Service, you agree to the practices described here.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">2. Information We Collect</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">We collect the following categories of information:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 leading-relaxed">
              <li><strong className="text-foreground">Account data:</strong> your email address, username, and password (stored securely via Supabase Auth).</li>
              <li><strong className="text-foreground">Case data:</strong> case notes, client information, and documents you enter into the platform.</li>
              <li><strong className="text-foreground">Usage data:</strong> pages visited, features used, and timestamps, collected to improve the Service.</li>
              <li><strong className="text-foreground">Device data:</strong> browser type, operating system, and IP address for security and analytics purposes.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">3. How We Use Your Information</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">We use your information to:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 leading-relaxed">
              <li>Provide, maintain, and improve the Service.</li>
              <li>Process AI requests and generate reports on your behalf.</li>
              <li>Send transactional emails such as account confirmations and password resets.</li>
              <li>Detect and prevent fraud, abuse, or security incidents.</li>
              <li>Comply with legal obligations.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              We do not use your case data or client information to train AI models.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">4. Data Sharing</h2>
            <p className="text-muted-foreground leading-relaxed">
              We do not sell your personal data. We share data only with trusted sub-processors necessary
              to deliver the Service, including Supabase (database and authentication) and our AI
              inference provider. All sub-processors are contractually bound to process data only as
              instructed and to maintain appropriate security standards.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">5. Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed">
              We retain your account and case data for as long as your account is active. If you close
              your account, we will delete your personal data within 30 days, except where we are
              required by law to retain it for longer.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">6. Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We implement industry-standard security measures including encryption in transit (TLS),
              encryption at rest, and access controls to protect your data. However, no system is
              completely secure. Please notify us immediately at{" "}
              <a href="mailto:admin@domusdeiug.com" className="text-accent hover:underline">
                admin@domusdeiug.com
              </a>{" "}
              if you suspect any unauthorised access to your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">7. Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              Depending on your jurisdiction, you may have the right to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 leading-relaxed">
              <li>Access the personal data we hold about you.</li>
              <li>Correct inaccurate or incomplete data.</li>
              <li>Request deletion of your data ("right to be forgotten").</li>
              <li>Object to or restrict certain processing of your data.</li>
              <li>Receive your data in a portable format.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              To exercise any of these rights, contact us at{" "}
              <a href="mailto:admin@domusdeiug.com" className="text-accent hover:underline">
                admin@domusdeiug.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">8. Cookies</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use essential cookies required for authentication and session management. We do not use
              third-party advertising cookies. You can control cookies through your browser settings,
              though disabling essential cookies may prevent the Service from functioning correctly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">9. Changes to This Policy</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of material changes
              via email or an in-app notice at least 14 days before the changes take effect.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-primary mb-3">10. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For any privacy-related questions or requests, contact us at{" "}
              <a href="mailto:admin@domusdeiug.com" className="text-accent hover:underline">
                admin@domusdeiug.com
              </a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-border py-6 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Domus Dei Uganda. All rights reserved.</span>
          <div className="flex gap-4">
            <Link to="/terms" className="hover:text-primary transition-colors">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
