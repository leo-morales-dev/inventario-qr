const { DataTypes } = require('sequelize');
const sequelize = require('../database');

const Loan = sequelize.define('Loan', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    quantity: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    status: {
        type: DataTypes.STRING, 
    },
    date_out: {
        type: DataTypes.DATE
    },
    date_return: {
        type: DataTypes.DATE
    },
    // --- ESTAS SON LAS COLUMNAS QUE FALTAN ---
    backup_product: {
        type: DataTypes.STRING,
        allowNull: true
    },
    backup_employee: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

module.exports = Loan;