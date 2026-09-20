import { motion } from "framer-motion";
import { useState } from "react";
import NavLink from "./NavLink";
import ThemeToggle from "./ThemeToggle";
import NavButton from "./NavButton";

const Navbar = ({ theme, setTheme }) => {
    const toggleTheme = () => {
        setTheme(theme === "dark" ? "light" : "dark");
    };

    return (
        <nav className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-7xl -translate-x-1/2">
            <div className="nav-glass flex h-14 items-center justify-between px-4 md:px-5">
                {/* Brand */}
                <div className="flex flex-row justify-center items-center gap-4.5">
                    <a href="#" className="flex items-center gap-2.5 cursor-pointer">
                        <p className="font-ui text-2xl font-semibold tracking-[-0.02em] text-(--foreground)">
                            Gradia
                        </p>
                    </a>
                    <p className="text-[7px] uppercase tracking-[0.18em] text-(--muted-foreground)">
                        Academic Suite
                    </p>
                </div>
                {/* Navigation */}
                <div className="hidden items-center gap-7 md:flex">
                    <NavLink label="Product" href="#product" />
                    <NavLink label="How it works" href="#how-it-works" />
                    <NavLink label="Features" href="#features" />
                    <NavLink label="Security" href="#security" />
                </div>
                {/* Actions */}
                <div className="flex items-center gap-2">
                    {/* Theme */}
                    <ThemeToggle theme={theme} setTheme={setTheme} />
                    {/* Sign in */}
                    <NavButton variant="secondary" >
                        Sign in
                    </NavButton>

                    <NavButton>
                        Request Demo
                    </NavButton>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;