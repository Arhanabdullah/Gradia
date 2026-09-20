import Reveal from "./Reveal";

const securityPoints = [
    {
        title: "Role-based access",
        description:
            "Keep academic information organized around the responsibilities of students, faculty, and administrators.",
    },
    {
        title: "Protected academic records",
        description:
            "Keep sensitive result information within a structured platform designed for controlled access.",
    },
    {
        title: "Clear accountability",
        description:
            "Give institutions a consistent workflow for reviewing and publishing academic results.",
    },
];
const Security = () => {
    return (
        <section
            id="security"
            className="mx-auto w-full max-w-7xl px-6 py-20 md:py-24"
        >
            <div className="glass-panel overflow-hidden rounded-2xl">
                <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="p-8 md:p-12">
                        <Reveal>
                            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-(--muted-foreground)">
                                Security
                            </p>
                        </Reveal>
                        <Reveal delay={0.1}>
                            <h2 className="mt-4 max-w-lg font-editorial text-4xl leading-tight tracking-tight text-(--foreground) sm:text-5xl">
                                Academic data,
                                <br />
                                <span className="italic text-(--primary)">
                                    handled with care.
                                </span>
                            </h2>
                        </Reveal>
                        <Reveal delay={0.2}>
                            <p className="mt-5 max-w-md text-sm leading-7 text-(--muted)">
                                Gradia is designed around controlled access,
                                structured workflows, and responsible handling
                                of academic information.
                            </p>
                        </Reveal>
                        <Reveal delay={0.3}>
                            <div className="glass-inner inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-(--foreground)">
                                <span className="h-1.5 w-1.5 rounded-full bg-(--tertiary)" />
                                <span className="text-[10px] font-medium text-(--muted)">
                                    Structured access by design
                                </span>
                            </div>
                        </Reveal>
                    </div>
                    <div className="border-t border-(--border) lg:border-l lg:border-t-0">
                        {securityPoints.map((point, index) => (
                            <Reveal
                                key={point.title}
                                delay={0.15 + index * 0.1}
                            >
                                <div className="border-b border-(--border) p-7 last:border-b-0">
                                    <div className="flex items-start gap-4">
                                        <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-(--border) text-[9px] font-medium text-(--primary)">
                                            {String(index + 1).padStart(2, "0")}
                                        </span>
                                        <div>
                                            <h3 className="text-sm font-semibold text-(--foreground)">
                                                {point.title}
                                            </h3>
                                            <p className="mt-2 max-w-lg text-sm leading-6 text-(--muted)">
                                                {point.description}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </Reveal>
                        ))}
                    </div>
                </div>
            </div >
        </section >
    );
};

export default Security;