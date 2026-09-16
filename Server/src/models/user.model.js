const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
    },
    name:{
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
        select: false, // Exclude password from query results by default
    },
    role: {
        type: String,
        enum: ['student','teacher','hod','principal'],
        default: 'student',
    },
    isActive: {
        type: Boolean,
        default: true,
    }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

module.exports = User;