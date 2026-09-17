const router = require('express').Router(); 
const authController = require('../controllers/auth.controller');
const authenticate = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');
const { registerUserValidationRules, validateResults, loginUserValidationRules } = require('../validators/user.validation');

router.post('/register',registerUserValidationRules,validateResults,  authController.register);
router.post('/login', loginUserValidationRules,validateResults, authController.login);
router.post('/logout',authenticate, authController.logout);

module.exports = router;