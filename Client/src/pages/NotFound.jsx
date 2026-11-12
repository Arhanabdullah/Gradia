// Custom 404: editorial numeral on a glass card, with routes back home.
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

import { useDocumentTitle } from "../lib/useDocumentTitle";

const NotFound = () => {
  useDocumentTitle("Page not found");

  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid-background flex min-h-screen items-center justify-center bg-(--background) p-6 text-(--foreground)"
    >
      <div className="glass-panel w-full max-w-md rounded-2xl p-8 text-center sm:p-10">
        <p className="text-xs font-medium text-(--muted-foreground)">Lost page</p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-editorial focus-target mt-2 text-7xl text-(--foreground) sm:text-8xl"
        >
          404
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-(--muted-foreground)">
          This page doesn't exist. The link may be outdated, or the address may
          have a typo.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <Link
            to="/"
            className="rounded-xl bg-(--primary) px-4 py-2.5 text-sm font-semibold text-(--background) transition-colors hover:bg-(--primary-hover)"
          >
            Back to home
          </Link>
          <Link
            to="/login"
            className="rounded-xl border border-(--border) px-4 py-2.5 text-sm font-semibold text-(--foreground) transition-colors hover:bg-(--surface-secondary)"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
};

export default NotFound;
