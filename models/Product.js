const Sequelize = require('sequelize');
const sequelize = require('../database');

const Product = sequelize.define('product', {
    // 1. El código largo para el QR (Ej: ABR-1000001)
    code: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
    },
    // 2. La clave corta interna (Ej: FLAP2610)
    short_code: {
        type: Sequelize.STRING
    },
    // 3. Descripción (Ej: DISCO DESBASTE 4-1/2...)
    description: {
        type: Sequelize.STRING,
        allowNull: false
    },
    // 4. Cantidad en inventario
    stock: {
        type: Sequelize.INTEGER,
        defaultValue: 0
    },
    // 5. Categoría: Importante para saber si se "presta" o se "consume"
    category: {
        type: Sequelize.STRING, // Valores: 'consumible' o 'herramienta'
        defaultValue: 'consumible'
    }
});

module.exports = Product;