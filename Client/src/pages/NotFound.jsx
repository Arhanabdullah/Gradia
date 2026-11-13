// Hallmark · 404 page — a result sheet that slipped through the cracks.
// Professional, domain-appropriate, one idea per screen.

import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Home, ArrowLeft, Search, RefreshCw, FileText, AlertTriangle } from "lucide-react";

import { useDocumentTitle } from "../lib/useDocumentTitle";
import { microTransition } from "../animations/variants";

const NotFound = () => {
  useDocumentTitle("Page not found · Gradia");

  const headingRef = useRef(null);
  const location = useLocation();
  const fromPath = location.state?.from?.pathname || "/";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid-background flex min-h-screen items-center justify-center bg-(--background) p-6 text-(--foreground)"
    >
      <motion.div
        className="rounded-2xl p-8 text-center sm:p-10 bg-(--surface) border border-(--muted) w-full max-w-md"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Single purposeful illustration — document with warning */}
        <div className="relative mx-auto mb-8 flex h-28 w-28 items-center justify-center" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-16 w-16 text-(--primary)"
          >
            {/* Document outline */}
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            {/* Content lines — static, subtle */}
            <line x1="16" y1="13" x2="8" y2="13" className="text-(--muted-foreground)" />
            <line x1="16" y1="17" x2="8" y2="17" className="text-(--muted-foreground)" />
            {/* Warning triangle — the "lost" signal */}
            <g className="text-(--danger)">
              <circle cx="18" cy="6" r="5" fill="currentColor" fillOpacity={0.1} />
              <path d="M18 4v3M16.5 5.5l1.5 1.5M19.5 5.5l-1.5 1.5" strokeWidth={1.5} />
            </g>
          </svg>
        </div>

        {/* Editorial numeral — the signature moment */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-editorial focus-target text-7xl font-medium text-(--foreground) sm:text-8xl"
        >
          404
        </h1>

        {/* Plain explanation — one sentence */}
        <p className="mt-4 text-sm leading-relaxed text-(--foreground) opacity-70">
          This page doesn&rsquo;t exist. The link may be outdated, or the address may have a typo.
        </p>

        {/* Primary actions — one primary, one secondary */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to={fromPath !== "/login" && fromPath !== "/" ? fromPath : "/"}
            className="flex items-center gap-2 h-12 rounded-xl bg-(--primary) px-6 text-sm font-semibold text-(--background) transition-colors hover:bg-(--primary-hover) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={microTransition}
          >
            <Home className="h-4 w-4" strokeWidth={2} />
            {fromPath !== "/login" && fromPath !== "/" ? "Go back" : "Back to home"}
          </Link>
          <Link
            to="/login"
            className="flex items-center gap-2 h-12 rounded-xl border-2 border-(--muted) px-6 text-sm font-semibold text-(--foreground) transition-colors hover:bg-(--surface-secondary) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={microTransition}
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            Sign in
          </Link>
        </div>

        {/* Secondary actions — quiet, grouped with hairlines */}
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row text-xs text-(--muted-foreground)">
          <button
            className="flex items-center gap-1.5 h-11 rounded-lg px-4 text-(--foreground) opacity-70 hover:opacity-100 hover:bg-(--surface-secondary) transition-colors active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => window.history.back()}
            disabled={window.history.length <= 1}
            aria-disabled={window.history.length <= 1}
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Go back
          </button>
          <span className="hidden sm:inline flex h-6 items-center" aria-hidden="true">
            <span className="w-px h-4 bg-(--border)" />
          </span>
          <a
            href="#"
            className="flex items-center gap-1.5 h-11 rounded-lg px-4 text-(--foreground) opacity-70 hover:text-(--primary) hover:bg-(--primary)/5 transition-colors active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={2} />
            Search
          </a>
          <span className="hidden sm:inline flex h-6 items-center" aria-hidden="true">
            <span className="w-px h-4 bg-(--border)" />
          </span>
          <button
            className="flex items-center gap-1.5 h-11 rounded-lg px-4 text-(--foreground) opacity-70 hover:opacity-100 hover:bg-(--surface-secondary) transition-colors active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
            Refresh
          </button>
        </div>

        {/* Helpful context — collapsible details */}
        <details className="mt-10 rounded-lg bg-(--background) p-6 text-left sm:p-8">
          <summary className="flex items-center gap-2 cursor-pointer select-none text-sm font-medium text-(--foreground) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2">
            <AlertTriangle className="h-4 w-4 text-(--primary)" strokeWidth={2} />
            Common reasons
          </summary>
          <ul className="mt-4 space-y-3 text-sm text-(--foreground) opacity-70 px-2" role="list">
            <li className="flex items-start gap-2">
              <FileText className="h-4 w-4 flex-shrink-0 mt-0.5 text-(--muted-foreground)" strokeWidth={2} />
              <span>The page was moved or deleted during a recent update</span>
            </li>
            <li className="flex items-start gap-2">
              <FileText className="h-4 w-4 flex-shrink-0 mt-0.5 text-(--muted-foreground)" strokeWidth={2} />
              <span>A bookmarked link contains an old URL structure</span>
            </li>
            <li className="flex items-start gap-2">
              <FileText className="h-4 w-4 flex-shrink-0 mt-0.5 text-(--muted-foreground)" strokeWidth={2} />
              <span>Access requires a specific role (admin, teacher, HOD, principal, student)</span>
            </li>
          </ul>
        </details>
      </motion.div>
    </main>
  );
};

export default NotFound;