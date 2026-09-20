import { motion } from "framer-motion";
import { revealVariant } from "../animations/variants";

const Reveal = ({ children, delay = 0, className = "" }) => {
    return (
        <motion.div
            className={className}
            variants={revealVariant}
            initial="hidden"
            whileInView="visible"
            custom={delay}
            viewport={{
                once: true,
                amount: 0.2,
            }}
            custom={delay}
        >
            {children}
        </motion.div>
    );
};

export default Reveal;