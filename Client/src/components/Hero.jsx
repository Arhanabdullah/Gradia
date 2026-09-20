

const Hero = () => {
    return (
        <section className="relative overflow-hidden pt-40">

            {/* Ambient background glow */}
            <div
                className="
                hero-glow
                pointer-events-none
                absolute
                left-1/2
                top-20
                -z-10
                h-105
                w-155
                -translate-x-1/2
                "
            />

            {/* Hero content */}
            <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 text-center">

                {/* Eyebrow */}
                <div
                    className="
            mb-6
            inline-flex
            items-center
            gap-2
            border
            border-(--border)
            bg-(--surface)
            px-3
            py-1.5
            text-[10px]
            font-medium
            uppercase
            tracking-[0.12em]
            text-(--muted)
            "
                >
                    <span
                        className="
                        h-1.5
                        w-1.5
                        bg-(--tertiary)
                        "
                    />

                    Academic results platform
                </div>

                {/* Heading */}
                <h1
                    className="
                    font-editorial
                    text-5xl
                    leading-[1.05]
                    tracking-[-0.03em]
                    text-(--foreground)
                    sm:text-6xl
                    md:text-7xl
                    "
                >
                    Academic results,{" "}
                    <span className="italic text-(--primary)">
                        without the complexity.
                    </span>
                </h1>

                {/* Description */}
                <p
                    className="
                    mt-7
                    max-w-2xl
                    text-base
                    leading-7
                    text-(--muted)
                    sm:text-lg
                    "
                >
                    Gradia brings students, teachers, and academic administrators
                    together in one streamlined platform for managing, reviewing,
                    and publishing academic results.
                </p>

                {/* CTA */}
                <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
                    <button
                        className="
                        rounded-lg
                        bg-(--primary)
                        px-5
                        py-3
                        text-sm
                        font-semibold
                        text-(--background)
                        shadow-[0_8px_24px_rgba(79,70,229,0.18)]
                        transition-all
                        duration-200
                        hover:-translate-y-0.5
                        hover:bg-(--primary-deep)
                        hover:shadow-[0_10px_30px_rgba(79,70,229,0.24)]
                        "
                    >
                        Get started
                    </button>

                    <button
                        className="
                        rounded-lg
                        border
                        border-(--border)
                        bg-(--surface)
                        px-5
                        py-3
                        text-sm
                        font-medium
                        text-(--foreground)
                        transition-all
                        duration-200
                        hover:-translate-y-0.5
                        hover:border-(--primary)
                        hover:bg-(--surface-secondary)
                        "
                    >
                        See how it works
                    </button>
                </div>
            </div>

        </section>
    );
};

export default Hero;