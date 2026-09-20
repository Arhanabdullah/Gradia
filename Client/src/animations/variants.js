export const revealVariant = {
    hidden: {
        opacity: 0,
        y: 12,
    },

    visible: (delay = 0) => ({
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.9,
            delay,
            ease: [0.16, 1, 0.3, 1],
        },
    }),
};

export const buttonHover = {
    scale: 1.05,
};

export const buttonTap = {
    scale: 0.92,
};

export const microTransition = {
    duration: 0.2,
    ease: "easeOut",
};