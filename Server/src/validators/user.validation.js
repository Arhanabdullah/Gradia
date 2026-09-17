const { body, validationResult } = require('express-validator')

async function validateResults(req, res, next) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
    }
    next()
}
const registerUserValidationRules = [
    body("username")
        .trim()
        .notEmpty()
        .withMessage("Username is required")
        .isString()
        .withMessage("Username must be a string")
        .isLength({ min: 3, max: 20 })
        .withMessage("Username must be between 3 and 20 characters"),
    body("email")
        .trim()
        .notEmpty()
        .withMessage("Email is required")
        .isEmail()
        .withMessage("Email must be a valid email address"),
    body("password")
        .notEmpty()
        .withMessage("Password is required")
        .isLength({ min: 6 })
        .withMessage("Password must be at least 6 characters long"),
    body("name")
        .trim()
        .notEmpty()
        .withMessage("Name is required")
        .isString()
        .withMessage("Name must be a string")
        .isLength({ min: 3, max: 50 })
        .withMessage("Name must be between 3 and 50 characters"),
    validateResults,
];

const loginUserValidationRules = [
    body("email")
        .trim()
        .notEmpty()
        .withMessage("Email is required")
        .isEmail()
        .withMessage("Email must be a valid email address"),
    body("password")
        .notEmpty()
        .withMessage("Password is required")
        .isLength({ min: 6 })
        .withMessage("Password must be at least 6 characters long"),
    validateResults,
];


module.exports = {
    validateResults,
    registerUserValidationRules,
    loginUserValidationRules,
};