// models/SupplierCode.js
const { DataTypes } = require('sequelize');
const sequelize = require('../database');

const SupplierCode = sequelize.define('SupplierCode', {
    rfc_proveedor: {
        type: DataTypes.STRING,
        allowNull: false
    },
    codigo_proveedor: {
        type: DataTypes.STRING,
        allowNull: false
    },
    // Esta columna es vital para que funcione el "include"
    productId: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});

module.exports = SupplierCode;