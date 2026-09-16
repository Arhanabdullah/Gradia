const userModel = require('../models/user.model');
const bcrypt = require("bcrypt");
const config = require('../config/config');
const { connectDB, disconnectDB } = require('../config/database');

async function seedAdmin() {
    try {
        await connectDB();
        const existingUser = await userModel.findOne({
            $or: [
                { username: config.admin.username },
                { email: config.admin.email },
                { role: "admin" }
            ]
        });
        if (existingUser) {
            console.log(" Admin already exists. Skipping seed.");
            return;
        }
        const hashedPassword = await bcrypt.hash(config.admin.password, 10);
        await userModel.create({
            username: config.admin.username,
            email: config.admin.email,
            password: hashedPassword,
            role: "admin",
        });
        console.log(" Admin user created successfully.");
    } catch (error) {
        console.error(" Error while seeding admin:", error);
        process.exitCode = 1;
    } finally {
        await disconnectDB();
    }
}

seedAdmin();