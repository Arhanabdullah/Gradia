import Reveal from "../Reveal";
const HeroBadge = () => {
    return (
        <Reveal delay={0}>
            <div className="glass-inner inline-flex items-center gap-2 rounded-full px-3.5 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-(--tertiary)" />
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted)">
                    Academic results platform
                </span>
            </div>
        </Reveal>
    );
};

export default HeroBadge;