const Sequelize = require('sequelize');
const sequelize = require('../database');

const Employee = sequelize.define('employee', {
    name: {
        type: Sequelize.STRING,
        allowNull: false
    },
    // Podríamos agregar un ID de empleado si quieres hacer credenciales luego
    employee_number: {
        type: Sequelize.STRING
    }
});

module.exports = Employee;