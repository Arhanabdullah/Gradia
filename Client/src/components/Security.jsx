const Security = () => {
    return (
        <section
            id="security"
            className="mx-auto w-full max-w-7xl px-6 py-24"
        >
            <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-center">
                {/* Heading */}
                <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-(--tertiary)">
                        Security
                    </p>

                    <h2 className="mt-3 font-editorial text-4xl leading-tight text-(--foreground) md:text-5xl">
                        Academic data,
                        <br />
                        <span className="italic text-(--primary)">
                            handled carefully.
                        </span>
                    </h2>

                    <p className="mt-5 max-w-md text-sm leading-6 text-(--muted)">
                        Gradia keeps access to academic information controlled
                        and organized, so every role only sees what it needs.
                    </p>
                </div>
                {/* Security points */}
                <div className="border-y border-(--border)">
                    <div className="border-b border-(--border) p-6">
                        <div className="flex items-start gap-5">
                            <span className="text-xs tabular text-(--primary)">
                                01
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-(--foreground)">
                                    Role-based access
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-(--muted)">
                                    Administrators, faculty, and students can
                                    have different permissions based on their
                                    role.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="border-b border-(--border) p-6">
                        <div className="flex items-start gap-5">
                            <span className="text-xs tabular text-(--primary)">
                                02
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-(--foreground)">
                                    Authenticated access
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-(--muted)">
                                    Access to protected academic workflows is
                                    limited to authenticated users.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="p-6">
                        <div className="flex items-start gap-5">
                            <span className="text-xs tabular text-(--primary)">
                                03
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-(--foreground)">
                                    Controlled publishing
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-(--muted)">
                                    Results can be reviewed before they become
                                    available to students.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Security;