// models/DamageLog.js
const { DataTypes } = require('sequelize');
const sequelize = require('../database');

const DamageLog = sequelize.define('DamageLog', {
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    reason: {
        type: DataTypes.STRING,
        allowNull: false
    },
    specific_code: {
        type: DataTypes.STRING, 
        allowNull: true // Puede ser nulo si no seleccionaron una clave específica
    },
    date: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    backup_product: { type: DataTypes.STRING },
    backup_code: { type: DataTypes.STRING }
});

module.exports = DamageLog;