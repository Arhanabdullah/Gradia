import { useEffect, useState } from "react";
import Navbar from "./components/Navbar/Navbar";
import Hero from "./components/HeroSection/Hero";
import ProductPreview from "./components/ProductPreview";
import Features from "./components/Features";
import HowItWorks from "./components/HowItWorks";
import Security from "./components/Security";
import CTA from "./components/CTA";
import Footer from "./components/Footer";
function App() {
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
        document.documentElement.classList.toggle(
            "dark",
            theme === "dark"
        );
        localStorage.setItem("theme", theme);
    }, [theme]);

    return (
        <div className="min-h-screen grid-background">
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
    );
}

export default App;