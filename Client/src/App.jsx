import { useEffect, useState } from "react";

import Navbar from "./components/Navbar/Navbar";
import Hero from "./components/HeroSection/Hero";
import ProductPreview from "./components/ProductPreview";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import Security from "./components/Security";
import CTA from "./components/CTA";
import Footer from "./components/Footer";

const App = () => {
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme) {
      return savedTheme;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  return (
    <div className="grid-background relative min-h-screen bg-(--background) text-(--foreground)">
      {/* Ambient lighting layer */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="ambient-light ambient-light-primary"
          style={{
            width: "700px",
            height: "500px",
            left: "50%",
            top: "-180px",
            transform: "translateX(-50%)",
          }}
        />
        <div
          className="ambient-light ambient-light-secondary"
          style={{
            width: "500px",
            height: "450px",
            left: "-180px",
            top: "35%",
          }}
        />
        <div
          className="ambient-light ambient-light-primary"
          style={{
            width: "550px",
            height: "500px",
            right: "-200px",
            top: "60%",
          }}
        />
      </div>
      {/* Actual page content */}
      <div className="relative z-10">
        <Navbar theme={theme} setTheme={setTheme} />
        <main>
          <Hero />
          <ProductPreview />
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

export default App;