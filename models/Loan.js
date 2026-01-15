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
        allowNull: false, 
        defaultValue: 1 
    },
    status: { 
        type: DataTypes.STRING, 
        defaultValue: 'prestado' // Puede ser: 'prestado', 'devuelto', 'consumido'
    },
    date_out: { 
        type: DataTypes.DATE, 
        defaultValue: DataTypes.NOW 
    },
    date_return: { 
        type: DataTypes.DATE 
    },
    
    // --- COLUMNAS DE RESPALDO (PERSISTENCIA DE DATOS) ---
    // Guardan el nombre textual al momento del préstamo.
    // Útil si el producto o empleado original se elimina de la base de datos.
    
    backup_product: { 
        type: DataTypes.STRING,
        allowNull: true 
    },
    
    backup_code: { // Guarda el código del producto (ej: TAL-001)
        type: DataTypes.STRING,
        allowNull: true
    },
    
    backup_employee: { // Guarda el nombre del empleado
        type: DataTypes.STRING,
        allowNull: true 
    }
});

module.exports = Loan;