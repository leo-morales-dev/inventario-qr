const express = require('express');
const app = express();
const path = require('path');
const sequelize = require('./database'); // Importamos la conexión
const QRCode = require('qrcode'); // Importar librería de QR

// Importar Modelos
const Product = require('./models/Product');
const Employee = require('./models/Employee');
const Loan = require('./models/Loan');

// Configuración básica
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --- RELACIONES DE BASE DE DATOS ---
Employee.hasMany(Loan);
Loan.belongsTo(Employee);
Product.hasMany(Loan);
Loan.belongsTo(Product);

// --- SINCRONIZACIÓN ---
sequelize.sync()
    .then(() => console.log("--- Base de Datos Sincronizada ---"))
    .catch(error => console.error("Error al crear base de datos:", error));

// ==========================================
// 🛠️ FUNCIÓN PARA CORREGIR ERRORES DEL ESCÁNER
// ==========================================
function limpiarCodigo(codigo) {
    if (!codigo) return "";
    // Reemplaza comillas simples (') por guiones (-)
    // Reemplaza también el signo de interrogación de cierre (?) que a veces sale en lugar de guion bajo
    return codigo.toUpperCase().replace(/'/g, '-').replace(/´/g, '-').trim();
}

// --- RUTAS ---

// 1. Dashboard Principal
app.get('/', async (req, res) => {
    try {
        const products = await Product.findAll();
        const activeLoans = await Loan.count({ where: { status: 'prestado' } });
        
        const totalTools = products.filter(p => p.category === 'herramienta').length;
        const totalConsumables = products.filter(p => p.category === 'consumible').length;
        const lowStock = products.filter(p => p.stock < 5).length;

        res.render('dashboard', { 
            page: 'dashboard',
            stats: { totalProducts: products.length, activeLoans, totalTools, totalConsumables, lowStock }
        });
    } catch (error) {
        console.error(error);
        res.send("Error al cargar dashboard");
    }
});

// -----------------------------------------------------
// MÓDULO DE INVENTARIO
// -----------------------------------------------------

app.get('/inventory', async (req, res) => {
    try {
        const products = await Product.findAll(); 
        res.render('inventory', { products: products, page: 'inventory' }); 
    } catch (error) {
        console.error(error);
        res.send("Error al cargar inventario");
    }
});

// Ruta para agregar (Con corrección de código)
app.post('/inventory/add', async (req, res) => {
    try {
        const { short_code, description, stock, category } = req.body;
        
        // 🧼 APLICAMOS LA LIMPIEZA AQUÍ TAMBIÉN
        const code = limpiarCodigo(req.body.code); 

        await Product.create({ code, short_code, description, stock, category });
        res.redirect('/inventory');
    } catch (error) {
        console.error(error);
        res.send("Error al guardar: " + error.message);
    }
});

// --- RUTAS NUEVAS PARA EDITAR Y ELIMINAR ---

// A. Mostrar formulario de edición
app.get('/inventory/edit/:id', async (req, res) => {
    try {
        const product = await Product.findByPk(req.params.id);
        if (!product) {
            return res.redirect('/inventory');
        }
        res.render('edit_product', { product: product, page: 'inventory' });
    } catch (error) {
        console.error(error);
        res.redirect('/inventory');
    }
});

// B. Guardar los cambios (Update)
app.post('/inventory/update/:id', async (req, res) => {
    try {
        const { short_code, description, stock, category } = req.body;
        // Importante: Usamos la misma limpieza de código por si lo cambian con el escáner
        const code = limpiarCodigo(req.body.code); 

        await Product.update({
            code,
            short_code,
            description,
            stock,
            category
        }, {
            where: { id: req.params.id }
        });

        res.redirect('/inventory');
    } catch (error) {
        console.error(error);
        res.send("Error al actualizar: " + error.message);
    }
});

// C. Eliminar producto
app.post('/inventory/delete/:id', async (req, res) => {
    try {
        await Product.destroy({
            where: { id: req.params.id }
        });
        res.redirect('/inventory');
    } catch (error) {
        console.error(error);
        res.send("Error al eliminar producto");
    }
});

// Ruta para cambiar categoría (Herramienta <-> Consumible)
app.get('/inventory/toggle/:id', async (req, res) => {
    try {
        const product = await Product.findByPk(req.params.id);
        if (product) {
            product.category = product.category === 'herramienta' ? 'consumible' : 'herramienta';
            await product.save();
        }
        res.redirect('/inventory');
    } catch (error) {
        console.error(error);
        res.redirect('/inventory');
    }
});

// Generar QR
app.get('/inventory/qr/:id', async (req, res) => {
    try {
        const product = await Product.findByPk(req.params.id);
        if (!product) return res.send("Producto no encontrado");

        const qrImage = await QRCode.toDataURL(product.code);
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family: Arial;">
                <h1>${product.description}</h1>
                <img src="${qrImage}" style="width:300px; height:300px;"/>
                <h2>${product.code}</h2>
                <button onclick="window.print()" style="padding:10px 20px; font-size:16px; cursor:pointer;">Imprimir</button>
            </div>
        `);
    } catch (error) {
        res.send("Error generando QR");
    }
});

// -----------------------------------------------------
// MÓDULO DE PRÉSTAMOS
// -----------------------------------------------------

app.get('/loans', async (req, res) => {
    try {
        const loans = await Loan.findAll({
            where: { status: 'prestado' },
            include: [Product, Employee],
            order: [['date_out', 'DESC']]
        });
        res.render('loans', { loans: loans, page: 'loans' });
    } catch (error) {
        console.error(error);
        res.send("Error al cargar préstamos");
    }
});

// REGISTRAR SALIDA (Con validación estricta de Empleado)
app.post('/loans/add', async (req, res) => {
    try {
        // Obtenemos los datos del formulario y limpiamos espacios
        const employeeName = req.body.employeeName.trim().toUpperCase();
        const productCode = limpiarCodigo(req.body.productCode);

        console.log(`Intento de préstamo: ${employeeName} -> ${productCode}`);

        // Cargamos la lista actual por si tenemos que volver a mostrar la página con un error
        const currentLoans = await Loan.findAll({ where: { status: 'prestado' }, include: [Product, Employee] });

        // 1. Validar Producto
        const product = await Product.findOne({ where: { code: productCode } });
        
        if (!product || product.stock <= 0) {
            return res.render('loans', { 
                loans: currentLoans,
                page: 'loans',
                error: !product ? `❌ Producto no encontrado (Leído: ${productCode})` : "⚠️ Sin stock disponible"
            });
        }

        // 2. Validar Empleado (CAMBIO PRINCIPAL AQUÍ)
        // Antes usábamos findOrCreate (buscar o crear). Ahora solo findOne (buscar).
        const employee = await Employee.findOne({
            where: { name: employeeName } 
        });

        // Si el empleado NO existe, mandamos error y no prestamos nada
        if (!employee) {
            return res.render('loans', { 
                loans: currentLoans,
                page: 'loans',
                error: `🚫 ACCESO DENEGADO: El empleado "${employeeName}" no está registrado en la base de datos.`
            });
        }

        // 3. Si todo está bien, creamos el Préstamo
        const newStatus = product.category === 'herramienta' ? 'prestado' : 'consumido';
        const returnDate = product.category === 'consumible' ? new Date() : null;

        await Loan.create({
            quantity: 1,
            status: newStatus,
            date_out: new Date(),
            date_return: returnDate,
            productId: product.id,
            employeeId: employee.id
        });

        await product.decrement('stock');
        res.redirect('/loans');

    } catch (error) {
        console.error(error);
        res.send("Error al procesar: " + error.message);
    }
});

// REGISTRAR DEVOLUCIÓN
app.post('/loans/return/:id', async (req, res) => {
    try {
        const loan = await Loan.findByPk(req.params.id);
        if (!loan) return res.send("Préstamo no encontrado");

        const product = await Product.findByPk(loan.productId);

        loan.status = 'devuelto';
        loan.date_return = new Date();
        await loan.save();

        if (product) await product.increment('stock');

        res.redirect('/loans');
    } catch (error) {
        res.send("Error al devolver: " + error.message);
    }
});

// INICIAR SERVIDOR
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`--- Servidor corriendo en http://localhost:${PORT} ---`);
});

// -----------------------------------------------------
// MÓDULO DE EMPLEADOS
// -----------------------------------------------------

// 9. Ver Lista de Empleados
app.get('/employees', async (req, res) => {
    try {
        // Traemos empleados y sus préstamos para contar cuántos tiene activos
        const employees = await Employee.findAll({
            include: [Loan],
            order: [['name', 'ASC']]
        });
        res.render('employees', { employees: employees, page: 'employees' });
    } catch (error) {
        console.error(error);
        res.send("Error al cargar empleados");
    }
});

// 10. Agregar Empleado Manualmente
app.post('/employees/add', async (req, res) => {
    try {
        await Employee.create({ name: req.body.name.toUpperCase() });
        res.redirect('/employees');
    } catch (error) {
        res.send("Error al crear empleado: " + error.message);
    }
});

// 11. Ver Perfil de Empleado (Historial y Gafete)
app.get('/employees/:id', async (req, res) => {
    try {
        const employee = await Employee.findByPk(req.params.id, {
            include: [
                { 
                    model: Loan, 
                    include: [Product] // Para ver qué producto se llevó
                }
            ],
            order: [[Loan, 'date_out', 'DESC']] // Ordenar préstamos del más reciente al viejo
        });

        if (!employee) return res.send("Empleado no encontrado");

        // Generamos el QR con EL NOMBRE del empleado. 
        // Así, al escanear este QR en la caja de texto "Empleado", se escribirá el nombre solo.
        const qrImage = await QRCode.toDataURL(employee.name);

        res.render('employee_profile', { 
            employee: employee, 
            qrImage: qrImage,
            page: 'employees'
        });

    } catch (error) {
        console.error(error);
        res.send("Error al cargar perfil");
    }
});