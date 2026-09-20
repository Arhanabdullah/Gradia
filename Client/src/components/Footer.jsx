const Footer = () => {
    return (
        <footer className="border-t border-(--border)">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="text-xl font-semibold text-(--foreground)">
                        Gradia
                    </p>
                    <p className="mt-1 text-[10px] text-(--muted-foreground)"></p>
                </div>
                <div className="flex items-center gap-6">
                    <a
                        href="#product"
                        className="text-[10px] text-(--muted) transition-colors duration-200 hover:text-(--foreground)"
                    >
                        Platform
                    </a>
                    <a
                        href="#how-it-works"
                        className="text-[10px] text-(--muted) transition-colors duration-200 hover:text-(--foreground)"
                    >
                        How it works
                    </a>
                    <a
                        href="#features"
                        className="text-[10px] text-(--muted) transition-colors duration-200 hover:text-(--foreground)"
                    >
                        Features
                    </a>
                    <a
                        href="#security"
                        className="text-[10px] text-(--muted) transition-colors duration-200 hover:text-(--foreground)"
                    >
                        Security
                    </a>
                </div>
                <p className="text-[10px] text-(--muted-foreground)">
                    © 2026 Gradia
                </p>
            </div>
        </footer>
    );
};

export default Footer;