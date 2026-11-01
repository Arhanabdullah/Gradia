import HeroContent from "./HeroContent";
import HeroActions from "./HeroActions";

const Hero = () => {
    return (
        <section className="relative overflow-hidden pb-12 pt-16 md:pb-14 md:pt-20">
            <div className="hero-glow left-1/2 top-0 -z-10 -translate-x-1/2" />
            <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
                <div className="mt-7">
                    <HeroContent />
                </div>
                <HeroActions />
            </div>
        </section>
    );
};

export default Hero;