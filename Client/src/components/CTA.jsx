const CTA = () => {
    return (
        <section className="mx-auto w-full max-w-7xl px-6 py-24">
            <div className="relative overflow-hidden rounded-2xl border border-(--border) bg-(--surface-secondary) px-6 py-16 text-center md:px-12">
                <div className="hero-glow left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2" />

                <div className="relative z-10 mx-auto max-w-2xl">
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-(--tertiary)">
                        Get started
                    </p>

                    <h2 className="mt-3 font-editorial text-4xl leading-tight text-(--foreground) md:text-5xl">
                        A simpler way to manage
                        <br />
                        <span className="italic text-(--primary)">
                            academic results.
                        </span>
                    </h2>

                    <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-(--muted)">
                        Bring students, faculty, and administrators together
                        in one streamlined academic platform.
                    </p>

                    <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                        <button className="rounded-lg bg-(--primary) px-5 py-3 text-sm font-semibold text-(--background) transition-all duration-200 hover:-translate-y-0.5 hover:bg-(--primary-deep)">
                            Request a demo
                        </button>

                        <button className="rounded-lg border border-(--border) bg-(--surface) px-5 py-3 text-sm font-medium text-(--foreground) transition-colors hover:border-(--primary)">
                            Get started
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default CTA;