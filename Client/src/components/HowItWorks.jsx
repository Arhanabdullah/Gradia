const steps = [
    {
        number: "01",
        title: "Set up your institution",
        description:
            "Create your academic structure, add departments, courses, subjects, and student records.",
    },
    {
        number: "02",
        title: "Enter and review results",
        description:
            "Faculty members can enter marks and grades while administrators review everything in one place.",
    },
    {
        number: "03",
        title: "Publish with confidence",
        description:
            "Once results are verified, publish them so students can securely access their academic performance.",
    },
];

const HowItWorks = () => {
    return (
        <section
            id="how-it-works"
            className="mx-auto w-full max-w-7xl px-6 py-24"
        >
            {/* Heading */}
            <div className="max-w-2xl">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-(--tertiary)">
                    How it works
                </p>

                <h2 className="mt-3 font-editorial text-4xl leading-tight text-(--foreground) md:text-5xl">
                    From marks to results,
                    <br />
                    <span className="italic text-(--primary)">
                        without the friction.
                    </span>
                </h2>
            </div>

            {/* Steps */}
            <div className="mt-16 grid gap-0 border-y border-(--border) md:grid-cols-3">
                {steps.map((step, index) => (
                    <div
                        key={step.number}
                        className={`relative p-7 md:p-8 ${index !== 2
                            ? "border-b border-(--border) md:border-b-0 md:border-r"
                            : ""
                            }`}
                    >
                        <span className="text-[11px] tabular text-(--primary)">
                            {step.number}
                        </span>

                        <div className="mt-12">
                            <h3 className="text-base font-semibold text-(--foreground)">
                                {step.title}
                            </h3>

                            <p className="mt-3 text-sm leading-6 text-(--muted)">
                                {step.description}
                            </p>
                        </div>

                        {/* Connector */}
                        {index !== 2 && (
                            <div className="absolute right-1.25 top-8 z-10 hidden h-2.5 w-2.5 rounded-full border border-(--border) bg-(--background) md:block" />
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
};

export default HowItWorks;