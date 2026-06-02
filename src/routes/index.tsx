import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Scale, MessageSquare, FileSpreadsheet, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")(({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Paralegal AI - Case Management for Lawyers" },
      { name: "description", content: "Log cases in seconds and generate monthly reports, activity briefs, and court submissions with an AI agent built for legal practitioners." },
      { property: "og:title", content: "Paralegal AI - AI Case Management for Lawyers" },
      { property: "og:description", content: "Log cases in seconds and generate monthly reports, activity briefs, and court submissions with an AI agent built for legal practitioners." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Paralegal AI",
        applicationCategory: "BusinessApplication",
        description: "AI-powered case management for lawyers.",
        offers: { "@type": "Offer", price: "0" },
      }),
    }],
  }),
}));

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && user) navigate({ to: "/app" });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2 font-bold text-primary">
          <Scale className="h-6 w-6" />
          Paralegal AI
        </div>
        <Link to="/auth" className="text-sm font-medium text-primary hover:text-accent">Sign in</Link>
      </header>

      <main className="flex-1 max-w-3xl mx-auto px-6 pt-16 pb-24 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent mb-6">
          A Paralegal AI Agent
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-primary">
          Case management,<br />reimagined for legal aid.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
          Log cases in seconds. Generate monthly reports, activity briefs, and court submissions
          with an AI agent that learns your style.
        </p>
        <Link
          to="/auth"
          className="mt-10 inline-block rounded-md bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground shadow-lg hover:bg-accent transition-colors"
        >
          Get started
        </Link>
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

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">{icon}</div>
      <h3 className="mt-3 font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
