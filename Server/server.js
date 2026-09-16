const app = require('./src/app');
const config = require('./src/config/config');
const {connectDB} = require('./src/config/db');


const PORT = config.port || 3000;

app.listen(PORT, () => {
    try {
        connectDB();
        console.log(`Server is running on port ${PORT}`);
    } catch (error) {
        console.error('Error occurred while starting the server:', error);
    }
});
