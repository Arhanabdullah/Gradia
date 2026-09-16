const mongoose = require('mongoose')
const config = require('./config')

const connectDB = async () => {
    try {
        await mongoose.connect(config.mongoURI)
        console.log('MongoDB connected')
    } catch (error) {
        console.error('Error connecting to MongoDB:', error)
        process.exit(1)
    }
}

const disconnectDB = async () => {
    try {
        await mongoose.disconnect()
        console.log('MongoDB disconnected')
    } catch (error) {
        console.error('Error disconnecting from MongoDB:', error)
        process.exit(1)
    }
}

module.exports = { connectDB, disconnectDB }