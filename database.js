const Sequelize = require('sequelize');

// Creamos la conexión a un archivo local llamado 'database.sqlite'
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './database.sqlite', // Aquí se guardarán todos tus datos
    logging: false // Para que no llene la consola de texto técnico
});

module.exports = sequelize;