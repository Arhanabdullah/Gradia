// Public marketing page: unchanged design, previously inline in App.jsx.
import { useEffect, useState } from "react";

import Navbar from "../components/Navbar/Navbar";
import Hero from "../components/HeroSection/Hero";
import ProductPreview from "../components/ProductPreview";
import HowItWorks from "../components/HowItWorks";
import Features from "../components/Features";
import Security from "../components/Security";
import CTA from "../components/CTA";
import Footer from "../components/Footer";
import { setTheme, getTheme } from "../lib/theme";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const Landing = () => {
  const [theme, setThemeState] = useState(() => getTheme());

  useDocumentTitle("Results, minus the chaos");

  useEffect(() => {
    const next = theme === "dark" ? "dark" : "light";
    setTheme(next);
  }, [theme]);

  const toggle = (next) => {
    setThemeState(next);
    setTheme(next);
  };

  return (
    <div className="relative min-h-screen bg-(--background) text-(--foreground)">
      {/* Page content */}
      <div className="relative z-10 flex flex-col">
        <a
        href="#main-content"
        className="sr-only rounded-xl bg-(--primary) px-4 py-2.5 text-sm font-semibold text-(--background) focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>
      <Navbar theme={theme} setTheme={toggle} />
        <main id="main-content" tabIndex={-1} className="focus-target flex-1">
          <Hero />
          <div className="mx-auto w-full max-w-7xl px-6 py-12 md:py-16">
            <ProductPreview />
          </div>
          <HowItWorks />
          <Features />
          <Security />
          <CTA />
        </main>
        <Footer />
      </div>
    </div>
  );
};

export default Landing;
