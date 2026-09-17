
function authorize(roles) {
    return async (req, res, next) => {
        const user = req.user;
        if (!roles.includes(user.role)) {
            return res.status(403).json({ message: 'Access denied' });
        }
        next();
    };
}

module.exports = { authorize };