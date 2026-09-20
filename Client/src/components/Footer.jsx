const Footer = () => {
    return (
        <footer className="border-t border-(--border)">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="font-ui text-sm font-semibold text-(--foreground)">
                        Gradia
                    </p>
                    <p className="mt-1 text-xs text-(--muted-foreground)">
                        Academic Suite
                    </p>
                </div>
                <div className="flex items-center gap-6">
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
                <p className="text-xs text-(--muted-foreground)">
                    © 2026 Gradia
                </p>
            </div>
        </footer>
    );
};

export default Footer;