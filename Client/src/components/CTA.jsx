import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import Reveal from "./Reveal";
import {
    buttonHover,
    buttonTap,
    microTransition,
} from "../animations/variants";
const CTA = () => {
    const navigate = useNavigate();
    return (
        <section
            id="request-demo"
            className="mx-auto w-full max-w-7xl px-6 py-24 md:py-28"
        >
            <Reveal>
                <div className="glass-floating relative overflow-hidden rounded-2xl px-6 py-16 text-center sm:px-10 md:py-20">
                    <div
                        className="pointer-events-none absolute left-1/2 top-0 h-64 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--primary)/8 blur-3xl"
                    />
                    <div className=" relative z-10 mx-auto max-w-2xl">
                        <h2 className="font-editorial text-4xl leading-tight tracking-tight text-(--foreground) sm:text-5xl">
                            Make academic results
                            <br />
                            <span className="italic text-(--primary)">
                                simpler for everyone.
                            </span>
                        </h2>
                        <p className="mx-auto mt-5 max-w-lg text-sm leading-7 text-(--muted)">
                            Bring your academic workflows together with a
                            platform designed for students, faculty, and
                            administrators.
                        </p>
                        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                            <motion.button
                                onClick={() => navigate("/login")}
                                className="whitespace-nowrap rounded-lg bg-(--primary) px-5 py-3 text-sm font-semibold text-(--background)"
                                whileHover={{
                                    ...buttonHover,
                                    backgroundColor: "var(--primary-deep)",
                                }}
                                whileTap={buttonTap}
                                transition={microTransition}
                            >
                                Request a demo
                            </motion.button>
                            <motion.a
                                href="#product"
                                className="whitespace-nowrap rounded-lg border border-(--muted) bg-(--surface-secondary) px-5 py-3 text-sm font-medium text-(--foreground) transition-colors hover:border-(--primary) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
                                whileHover={{
                                    ...buttonHover,
                                    borderColor: "var(--primary)",
                                }}
                                whileTap={buttonTap}
                                transition={microTransition}
                            >
                                Explore platform
                            </motion.a>
                        </div>
                    </div>
                </div>
            </Reveal>
        </section>
    );
};

export default CTA;