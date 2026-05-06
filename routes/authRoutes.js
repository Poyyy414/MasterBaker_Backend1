const express = require('express');
const router  = express.Router();
const { register, login, refresh } = require('../controllers/authController.js');

router.post('/register', register); // POST /api/auth/register
router.post('/login',    login);    // POST /api/auth/login
router.post('/refresh',  refresh);  // POST /api/auth/refresh

module.exports = router;