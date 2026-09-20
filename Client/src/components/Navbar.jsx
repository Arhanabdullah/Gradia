const Navbar = ({ theme, setTheme }) => {
    const toggleTheme = () => {
        setTheme(theme === "dark" ? "light" : "dark");
    };

    return (
        <nav className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-7xl -translate-x-1/2">
            <div className="nav-glass flex h-14 items-center justify-between px-4 md:px-5">

                {/* Brand */}
                <a href="#" className="flex items-center gap-2.5">
                    <div>
                        <p className="font-ui text-lg font-semibold tracking-[-0.02em] text-(--foreground)">
                            Gradia
                        </p>

                        <p className="text-[7px] uppercase tracking-[0.18em] text-(--muted-foreground)">
                            Academic Suite
                        </p>
                    </div>
                </a>

                {/* Navigation */}
                <div className="hidden items-center gap-7 md:flex">
                    <a
                        href="#product"
                        className="text-xs text-(--muted) transition-colors hover:text-(--foreground)"
                    >
                        Product
                    </a>

                    <a
                        href="#how-it-works"
                        className="text-xs text-(--muted) transition-colors hover:text-(--foreground)"
                    >
                        How it works
                    </a>

                    <a
                        href="#features"
                        className="text-xs text-(--muted) transition-colors hover:text-(--foreground)"
                    >
                        Features
                    </a>

                    <a
                        href="#security"
                        className="text-xs text-(--muted) transition-colors hover:text-(--foreground)"
                    >
                        Security
                    </a>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">

                    {/* Theme */}
                    <button
                        onClick={toggleTheme}
                        aria-label="Toggle theme"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--border) text-sm text-(--muted) transition-all hover:border-(--primary) hover:text-(--foreground)"
                    >
                        {theme === "dark" ? "☼" : "☾"}
                    </button>

                    {/* Sign in */}
                    <button className="hidden rounded-lg border border-(--border) px-3 py-2 text-xs text-(--foreground) transition-all hover:border-(--primary) md:block">
                        Sign in
                    </button>

                    {/* CTA */}
                    <button className="rounded-lg bg-(--primary) px-3.5 py-2 text-xs font-semibold text-(--background) transition-all hover:bg-(--primary-deep)">
                        Request Demo
                    </button>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;