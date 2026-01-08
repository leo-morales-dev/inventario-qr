const Sequelize = require('sequelize');
const sequelize = require('../database');

const Loan = sequelize.define('loan', {
    quantity: {
        type: Sequelize.INTEGER,
        defaultValue: 1
    },
    status: {
        type: Sequelize.STRING, // 'prestado', 'devuelto'
        defaultValue: 'prestado'
    },
    date_out: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
    },
    date_return: {
        type: Sequelize.DATE // Se llena cuando regresan la herramienta
    }
});

module.exports = Loan;