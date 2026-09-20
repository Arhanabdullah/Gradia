import Reveal from "./Reveal";
import { motion } from "framer-motion";
const steps = [
    {
        number: "01",
        title: "Set up your institution",
        description:
            "Create your academic structure, subjects, classes, and student records in one place.",
    },
    {
        number: "02",
        title: "Manage results",
        description:
            "Enter, review, and organize academic results with a streamlined workflow.",
    },
    {
        number: "03",
        title: "Publish with confidence",
        description:
            "Review final results and make them available to students through a clear, centralized system.",
    },
];

const HowItWorks = () => {
    return (
        <section
            id="how-it-works"
            className="mx-auto w-full max-w-7xl px-6 py-20 md:py-24"
        >
            <div className="max-w-2xl">
                <Reveal>
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-(--muted-foreground)">
                        How it works
                    </p>
                </Reveal>
                <Reveal delay={0.1}>
                    <h2 className="mt-3 font-editorial text-4xl leading-tight tracking-tight text-(--foreground) sm:text-5xl">
                        From academic data
                        <br />
                        <span className="italic text-(--primary)">
                            to meaningful results.
                        </span>
                    </h2>
                </Reveal>
                <Reveal delay={0.2}>
                    <p className="mt-5 max-w-xl text-sm leading-7 text-(--muted)">
                        Gradia simplifies the entire results workflow, giving institutions
                        a structured way to manage academic information from setup to
                        publication.
                    </p>
                </Reveal>
            </div>
            <div className="relative mt-14 grid gap-4 md:grid-cols-3">
                <div className="pointer-events-none absolute left-[16.67%] right-[16.67%] top-3.5 z-0 hidden h-px -translate-y-1/2 bg-(--border) md:block" />
                {steps.map((step, index) => (
                    <Reveal
                        key={step.number}
                        delay={0.15 + index * 0.1}
                        className="relative z-10"
                    >
                        <motion.div
                            className="glass-panel group h-full rounded-2xl p-6"
                            whileHover={{ y: -4, borderColor: "var(--primary)" }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                        >
                            <div className="glass-inner flex h-7 w-7 items-center justify-center rounded-md">
                                <span className="text-[9px] font-medium tracking-[0.08em] text-(--primary)">
                                    {step.number}
                                </span>
                            </div>
                            <h3 className="mt-7 text-base font-semibold text-(--foreground)">
                                {step.title}
                            </h3>
                            <p className="mt-3 text-sm leading-6 text-(--muted)">
                                {step.description}
                            </p>
                        </motion.div>
                    </Reveal>
                ))}
            </div>
        </section>
    );
};

export default HowItWorks;