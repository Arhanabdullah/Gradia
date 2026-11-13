import Reveal from "../Reveal";
const HeroContent = () => {
    return (
        <div className="flex flex-col items-center text-center">
            <Reveal delay={0.1}>
                <h1 className="max-w-4xl font-editorial text-5xl leading-[1.02] tracking-[-0.035em] text-(--foreground) sm:text-6xl md:text-7xl lg:text-[5.25rem]">
                    Academic results,
                    <br />
                    <span className="italic text-(--primary)">
                        without the complexity.
                    </span>
                </h1>
            </Reveal>
            <Reveal delay={0.2}>
                <p className="mt-7 max-w-2xl text-sm leading-7 text-(--muted) sm:text-base">
                    Students, teachers, and administrators share one
                    clean workflow: marks go in, results come out, and
                    everyone stays in sync.
                </p>
            </Reveal>
        </div>
    );
};

export default HeroContent;