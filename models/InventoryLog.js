// models/InventoryLog.js
const { DataTypes } = require('sequelize');
const sequelize = require('../database');

const InventoryLog = sequelize.define('InventoryLog', {
    action: {
        type: DataTypes.STRING, // Ej: 'ALTA', 'ACTUALIZACION', 'CARGA_XML', 'ENTRADA_STOCK'
        allowNull: false
    },
    description: {
        type: DataTypes.STRING, // Ej: "Se cambió el stock de 5 a 10"
        allowNull: true
    },
    user: {
        type: DataTypes.STRING, // Quién lo hizo (Si usas login, sino pondremos 'Sistema')
        defaultValue: 'Administrador'
    },
    date: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    backup_product: { type: DataTypes.STRING }, // Guardará el nombre
    backup_code: { type: DataTypes.STRING }
});

module.exports = InventoryLog;