const express = require('express');
require('dotenv').config({quiet: true});
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();
app.use(helmet());
app.use(morgan('dev'));
app.use(cookieParser());

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
}));
app.use(express.json());


module.exports = app;