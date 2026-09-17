const jwt = require('jsonwebtoken');
const config = require('../config/config');
const userModel = require('../models/user.model');

const authenticate = async (req, res, next) => {
    try {
        const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token is required'
            });
        }
        const decoded = jwt.verify(token, config.jwtSecretKey);
        if (!decoded || !decoded.userId) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
        const user = await userModel
            .findById(decoded.userId)
            .select("-password");

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found"
            });
        }
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "User account is inactive"
            });
        }
        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized',
            error: error.message
        });
    }
}

module.exports = authenticate;