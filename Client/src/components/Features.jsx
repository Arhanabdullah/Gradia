import Reveal from "./Reveal";
import { motion } from "framer-motion";
const features = [
    {
        number: "01",
        title: "Centralized academic data",
        description:
            "Keep students, subjects, classes, and academic results organized in one structured platform.",
    },
    {
        number: "02",
        title: "Streamlined result management",
        description:
            "Manage, review, and publish results through a workflow designed to reduce administrative complexity.",
    },
    {
        number: "03",
        title: "Clear academic insights",
        description:
            "Turn academic records into clear performance insights that are easy to review and understand.",
    },
    {
        number: "04",
        title: "Built for every role",
        description:
            "Give students, faculty, and administrators the tools and information relevant to their role.",
    },
];
const Features = () => {
    return (
        <section
            id="features"
            className="mx-auto w-full max-w-7xl px-6 py-20 md:py-24"
        >
            <div className="max-w-2xl">
                <Reveal>
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-(--muted-foreground)">
                        Platform
                    </p>
                </Reveal>
                <Reveal delay={0.1}>
                    <h2 className="mt-3 font-editorial text-4xl leading-tight tracking-tight text-(--foreground) sm:text-5xl">
                        Everything you need
                        <br />
                        <span className="italic text-(--primary)">
                            to manage results.
                        </span>
                    </h2>
                </Reveal>
                <Reveal delay={0.2}>
                    <p className="mt-5 max-w-xl text-sm leading-7 text-(--muted)">
                        A focused academic management experience built around
                        the workflows that matter most.
                    </p>
                </Reveal>
            </div>
            <div className="glass-panel mt-14 grid overflow-hidden rounded-2xl sm:grid-cols-2">
                {features.map((feature, index) => (
                    <Reveal
                        key={feature.number}
                        delay={0.15 + index * 0.08}
                    >
                        <motion.div
                            className="group h-full p-7"
                            whileHover={{ backgroundColor: "rgba(255,255,255,0.04)" }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                        >
                            <span className="text-[10px] font-medium tracking-[0.12em] text-(--primary)">
                                {feature.number}
                            </span>
                            <h3 className="mt-8 text-base font-semibold text-(--foreground)">
                                {feature.title}
                            </h3>
                            <p className="mt-3 max-w-md text-sm leading-6 text-(--muted)">
                                {feature.description}
                            </p>
                        </motion.div>
                    </Reveal>
                ))}
            </div>
        </section>
    );
};

export default Features;