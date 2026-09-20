const features = [
    {
        number: "01",
        title: "Centralized results",
        description:
            "Manage student records, marks, grades, and academic results from one organized workspace.",
    },
    {
        number: "02",
        title: "Role-based access",
        description:
            "Give administrators, teachers, and students the right level of access to academic information.",
    },
    {
        number: "03",
        title: "Simple publishing",
        description:
            "Review results before publishing them and make academic information available when it is ready.",
    },
    {
        number: "04",
        title: "Performance insights",
        description:
            "Understand student and subject performance through clear analytics and visual reports.",
    },
    {
        number: "05",
        title: "Secure by design",
        description:
            "Keep academic data protected with authentication and controlled access across the platform.",
    },
    {
        number: "06",
        title: "Built for institutions",
        description:
            "Designed to support the everyday workflow of students, faculty, and academic administrators.",
    },
];

const Features = () => {
    return (
        <section
            id="features"
            className="mx-auto w-full max-w-7xl px-6 py-24"
        >
            {/* Section heading */}
            <div className="max-w-2xl">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-(--tertiary)">
                    Everything in one place
                </p>
                <h2 className="mt-3 font-editorial text-4xl leading-tight text-(--foreground) md:text-5xl">
                    Less administration.
                    <br />
                    <span className="italic text-(--primary)">
                        More clarity.
                    </span>
                </h2>
                <p className="mt-5 text-base leading-7 text-(--muted)">
                    Gradia simplifies the entire academic results workflow,
                    giving every role the tools they need without unnecessary
                    complexity.
                </p>
            </div>
            {/* Feature grid */}
            <div className="mt-14 grid border-t border-(--border) sm:grid-cols-2 lg:grid-cols-3">
                {features.map((feature) => (
                    <div
                        key={feature.number}
                        className="border-b border-(--border) p-6 sm:odd:border-r lg:nth-[3n+1]:border-r lg:nth-[3n+2]:border-r"
                    >
                        <span className="text-[10px] tabular text-(--muted-foreground)">
                            {feature.number}
                        </span>

                        <h3 className="mt-8 text-base font-semibold text-(--foreground)">
                            {feature.title}
                        </h3>

                        <p className="mt-3 max-w-sm text-sm leading-6 text-(--muted)">
                            {feature.description}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default Features;