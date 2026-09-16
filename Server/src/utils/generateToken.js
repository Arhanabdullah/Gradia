const jwt = require('jsonwebtoken');
const config = require('../config/config');

function generateToken(userId){
    try {
        const token = jwt.sign({ userId: userId },
            config.jwtSecretKey,
            { expiresIn: config.jwtExpiresIn });
        return token;
    } catch (error) {
        throw new Error('Error generating token: ' + error.message);
    }
}

module.exports = generateToken;