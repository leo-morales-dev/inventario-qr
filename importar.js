const fs = require('fs');
const csv = require('csv-parser');
const Product = require('./models/Product');
const sequelize = require('./database');

// Palabras clave para detectar si es herramienta automáticamente
const keywordsHerramienta = ['TALADRO', 'PULIDOR', 'ESMERIL', 'SOLDADORA', 'MAQUINA', 'EXTENSION', 'PINZA', 'LLAVE', 'MARTILLO'];

async function importarDatos() {
    try {
        await sequelize.sync(); // Asegurar conexión a DB
        console.log("--- Iniciando Importación Masiva ---");

        const results = [];

        // Leer el archivo CSV
        fs.createReadStream('datos.csv')
            .pipe(csv())
            .on('data', (data) => {
                // Mapear las columnas de tu Excel a la Base de Datos
                // Ajusta los nombres de la derecha según la cabecera de tu CSV
                results.push({
                    code: data.CODIGO || data.codigo,          // Columna Excel: CODIGO
                    short_code: data.CLAVE || data.clave,      // Columna Excel: CLAVE
                    description: data.DESCRIPCIÓN || data.descripcion || 'Sin descripción', // Columna Excel: DESCRIPCIÓN
                    stock: parseInt(data.EXISTENCIA) || 0      // Columna Excel: EXISTENCIA
                });
            })
            .on('end', async () => {
                console.log(`Se encontraron ${results.length} registros. Procesando...`);

                let count = 0;
                for (const item of results) {
                    if (!item.code) continue; // Saltar si no tiene código

                    // Lógica para adivinar categoría
                    let category = 'consumible';
                    const descUpper = item.description.toUpperCase();
                    if (keywordsHerramienta.some(key => descUpper.includes(key))) {
                        category = 'herramienta';
                    }

                    // Insertar o actualizar si ya existe
                    const [product, created] = await Product.findOrCreate({
                        where: { code: item.code },
                        defaults: {
                            short_code: item.short_code,
                            description: item.description,
                            stock: item.stock,
                            category: category
                        }
                    });

                    if (!created) {
                        // Si ya existe, actualizamos el stock
                        product.stock = item.stock;
                        await product.save();
                    }
                    count++;
                    if(count % 50 === 0) process.stdout.write("."); // Barra de progreso simple
                }

                console.log("\n\n✅ ¡Importación completada con éxito!");
                console.log("Ya puedes abrir la app y ver tus productos.");
            });

    } catch (error) {
        console.error("Error fatal:", error);
    }
}

importarDatos();