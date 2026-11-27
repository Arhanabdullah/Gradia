// Shared Framer Motion variants. Timing is kept consistent with the CSS motion
// tokens in index.css (--motion-fast/--motion-normal + --ease-out) and stays
// subtle; reduced-motion users are handled by <MotionConfig reducedMotion="user">.
export const EASE_OUT = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT = [0.65, 0, 0.35, 1];
export const EASE_SPRING = [0.34, 1.2, 0.64, 1];

export const revealVariant = {
    hidden: {
        opacity: 0,
        y: 12,
    },

    visible: (delay = 0) => ({
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.6,
            delay,
            ease: EASE_OUT,
        },
    }),
};

export const buttonHover = {
    scale: 1.02,
};

export const buttonTap = {
    scale: 0.98,
};

export const microTransition = {
    duration: 0.2,
    ease: EASE_OUT,
};

// List rows: enter/exit + reorder smoothly (use with AnimatePresence).
export const listItemVariant = {
    hidden: { opacity: 0, y: 6 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98 },
};
