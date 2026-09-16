if(!process.env.MONGO_URI){
    throw new Error("MONGO_URI is not defined in environment variables")

}
if(!process.env.JWT_SECRET_KEY){
    throw new Error("JWT_SECRET_KEY is not defined in environment variables")
}
if(!process.env.PORT){
    throw new Error("PORT is not defined in environment variables, using default port 3000")
}
if(process.env.NODE_ENV === 'production' && !process.env.SECURE_COOKIE){
    throw new Error("SECURE_COOKIE is not defined in environment variables for production environment")
}
if(!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_EMAIL){
    throw new Error("Admin credentials are not defined in environment variables")
}


const config = {
    mongoURI: process.env.MONGO_URI,
    port: process.env.PORT || 3000,
    jwtSecretKey: process.env.JWT_SECRET_KEY,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1h",
    secureCookie: process.env.SECURE_COOKIE === "true",
    admin: {
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD,
        email: process.env.ADMIN_EMAIL
    }
};


module.exports = config