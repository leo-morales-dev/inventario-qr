/**
 * archivo: app.js
 * descripción: Lógica principal con corrección en importación de Excel (Suma de Stock y validación de duplicados)
 */

const express = require('express');
const app = express();
const path = require('path');
const session = require('express-session');
const sequelize = require('./database'); 
const QRCode = require('qrcode');
const ExcelJS = require('exceljs'); // Librería para Excel
const { Op } = require('sequelize'); // OPERADORES LOGICOS
const multer = require('multer'); // Manejo de subida de archivos
const upload = multer({ storage: multer.memoryStorage() }); // Guardar en memoria RAM temporalmente

// Importar Modelos
const Product = require('./models/Product');
const Employee = require('./models/Employee');
const Loan = require('./models/Loan');
const User = require('./models/User');

// Configuración básica
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURACIÓN DE SESIÓN ---
app.use(session({
    secret: 'secreto_super_seguro_tooltrack', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // 1 hora
}));

// --- RELACIONES DE BASE DE DATOS ---
Employee.hasMany(Loan, { foreignKey: 'employeeId' });
Loan.belongsTo(Employee, { foreignKey: 'employeeId' });

Product.hasMany(Loan, { foreignKey: 'productId' });
Loan.belongsTo(Product, { foreignKey: 'productId' });

// --- SINCRONIZACIÓN Y ADMIN ---
// ¡IMPORTANTE! Usamos { alter: true } para proteger los datos
sequelize.sync({ alter: true })
    .then(async () => {
        console.log("--- Base de Datos Sincronizada ---");
        const userCount = await User.count();
        if (userCount === 0) {
            await User.create({
                name: 'Administrador',
                username: 'admin',
                password: 'password123'
            });
            console.log(">>> USUARIO ADMIN CREADO: admin / password123 <<<");
        }
    })
    .catch(error => console.error("Error BD:", error));

// --- MIDDLEWARES ---
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
};

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

function limpiarCodigo(codigo) {
    if (!codigo) return "";
    return codigo.toUpperCase().replace(/'/g, '-').replace(/´/g, '-').trim();
}

// ==========================================
// RUTAS
// ==========================================

// --- LOGIN / LOGOUT ---
app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ where: { username: username } });
        if (user && user.password === password) {
            req.session.userId = user.id;
            req.session.user = user;
            return res.redirect('/');
        } else {
            return res.render('login', { error: 'Usuario o contraseña incorrectos' });
        }
    } catch (error) {
        res.render('login', { error: 'Error del sistema' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// --- DASHBOARD ---
app.get('/', requireLogin, async (req, res) => {
    try {
        const products = await Product.findAll();
        const activeLoansCount = await Loan.count({ where: { status: 'prestado' } });
        const employeesCount = await Employee.count(); 
        const totalTools = products.filter(p => p.category === 'herramienta').length;
        const totalConsumables = products.filter(p => p.category === 'consumible').length;
        const lowStock = products.filter(p => p.stock < 5).length;
        const recentLoans = await Loan.findAll({
            limit: 5,
            order: [['date_out', 'DESC']],
            include: [Product, Employee]
        });

        res.render('dashboard', { 
            page: 'dashboard',
            stats: {
                totalProducts: products.length,
                activeLoans: activeLoansCount,
                totalTools,
                totalConsumables,
                lowStock,
                totalEmployees: employeesCount
            },
            recentLoans: recentLoans
        });

    } catch (error) {
        res.send("Error al cargar dashboard: " + error.message);
    }
});

// --- INVENTARIO ---

// 1. Exportar Excel (Inventario INTELIGENTE)
app.get('/inventory/export', requireLogin, async (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        let products = await Product.findAll();

        if (filter === 'tools') {
            products = products.filter(p => p.category === 'herramienta');
        } else if (filter === 'consumables') {
            products = products.filter(p => p.category === 'consumible');
        } else if (filter === 'low') {
            products = products.filter(p => p.stock < 5);
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Inventario');

        worksheet.columns = [
            { header: 'CLAVE', key: 'short_code', width: 15 },
            { header: 'CODIGO', key: 'code', width: 25 },
            { header: 'DESCRIPCIÓN', key: 'description', width: 40 },
            { header: 'EXISTENCIA', key: 'stock', width: 15 },
            { header: 'TIPO', key: 'category', width: 15 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        products.forEach(product => {
            worksheet.addRow({
                short_code: product.short_code,
                code: product.code,
                description: product.description,
                stock: product.stock,
                category: product.category.toUpperCase()
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        
        let filename = 'Inventario_General.xlsx';
        if(filter === 'tools') filename = 'Inventario_Herramientas.xlsx';
        if(filter === 'consumables') filename = 'Inventario_Consumibles.xlsx';
        if(filter === 'low') filename = 'Inventario_StockBajo.xlsx';

        res.setHeader('Content-Disposition', 'attachment; filename=' + filename);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error(error);
        res.send("Error al exportar");
    }
});

app.get('/inventory', requireLogin, async (req, res) => {
    try {
        const products = await Product.findAll(); 
        res.render('inventory', { products: products, page: 'inventory' }); 
    } catch (error) {
        res.send("Error al cargar inventario");
    }
});

app.post('/inventory/add', requireLogin, async (req, res) => {
    try {
        const { short_code, description, stock, category } = req.body;
        const code = limpiarCodigo(req.body.code); 
        await Product.create({ code, short_code, description, stock, category });
        res.redirect('/inventory?alert=created');
    } catch (error) {
        res.send("Error al guardar: " + error.message);
    }
});

app.get('/inventory/edit/:id', requireLogin, async (req, res) => {
    try {
        const product = await Product.findByPk(req.params.id);
        if (!product) return res.redirect('/inventory');
        res.render('edit_product', { product: product, page: 'inventory' });
    } catch (error) {
        res.redirect('/inventory');
    }
});

app.post('/inventory/update/:id', requireLogin, async (req, res) => {
    try {
        const { short_code, description, stock, category } = req.body;
        const code = limpiarCodigo(req.body.code); 
        await Product.update({ code, short_code, description, stock, category }, { where: { id: req.params.id } });
        res.redirect('/inventory/edit/' + req.params.id + '?alert=updated');
    } catch (error) {
        res.send("Error al actualizar: " + error.message);
    }
});

app.post('/inventory/delete/:id', requireLogin, async (req, res) => {
    try {
        await Product.destroy({ where: { id: req.params.id } });
        res.redirect('/inventory?alert=deleted');
    } catch (error) {
        res.send("Error al eliminar producto");
    }
});

// BORRADO MASIVO INTELIGENTE
app.post('/inventory/delete-bulk', requireLogin, async (req, res) => {
    try {
        const { filter } = req.body; 
        let whereClause = {};

        if (filter === 'tools') {
            whereClause = { category: 'herramienta' };
        } else if (filter === 'consumables') {
            whereClause = { category: 'consumible' };
        } else if (filter === 'low') {
            whereClause = { stock: { [Op.lt]: 5 } };
        } else if (filter === 'all') {
            whereClause = {};
        } else {
            return res.redirect('/inventory');
        }

        await Product.destroy({ where: whereClause });
        res.redirect('/inventory?alert=bulk_deleted');

    } catch (error) {
        console.error(error);
        res.send("Error al borrar datos masivos: " + error.message);
    }
});

app.get('/inventory/toggle/:id', requireLogin, async (req, res) => {
    try {
        const product = await Product.findByPk(req.params.id);
        if (product) {
            product.category = product.category === 'herramienta' ? 'consumible' : 'herramienta';
            await product.save();
        }
        res.redirect('/inventory');
    } catch (error) {
        res.redirect('/inventory');
    }
});

app.get('/inventory/qr/:id', requireLogin, async (req, res) => {
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

// --- PRÉSTAMOS ---

app.get('/loans/export', requireLogin, async (req, res) => {
    try {
        const loans = await Loan.findAll({
            include: [Product, Employee],
            order: [['date_out', 'DESC']]
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Control de Herramienta');

        worksheet.mergeCells('A1:F1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'CONTROL DE HERRAMIENTA';
        titleCell.font = { bold: true, size: 14 };
        titleCell.alignment = { horizontal: 'center' };

        worksheet.getRow(3).values = ['NOMBRE', 'DESCRIPCION', 'REGISTRO (CÓDIGO)', 'FECHA SALIDA', 'FECHA ENTREGA', 'ESTATUS'];
        worksheet.getRow(3).font = { bold: true };
        worksheet.columns = [
            { key: 'name', width: 30 },
            { key: 'desc', width: 30 },
            { key: 'code', width: 20 },
            { key: 'out', width: 20 },
            { key: 'return', width: 20 },
            { key: 'status', width: 15 }
        ];

        loans.forEach(loan => {
            const row = worksheet.addRow({
                name: loan.employee ? loan.employee.name : 'Desconocido',
                desc: loan.product ? loan.product.description : 'Eliminado',
                code: loan.product ? loan.product.code : '--',
                out: new Date(loan.date_out).toLocaleDateString(),
                return: loan.date_return ? new Date(loan.date_return).toLocaleDateString() : '',
                status: loan.status === 'prestado' ? 'RESGUARDO' : 'DEVUELTO'
            });

            if (loan.status === 'prestado') {
                row.getCell('status').font = { color: { argb: 'FFFF0000' }, bold: true };
            }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=' + 'Reporte_Prestamos.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error(error);
        res.send("Error al exportar reporte");
    }
});

// --- PRÉSTAMOS (CORRECCIÓN DE DATOS FALTANTES) ---
app.get('/loans', requireLogin, async (req, res) => {
    try {
        const allLoansRaw = await Loan.findAll({ order: [['date_out', 'DESC']] });
        const allLoans = allLoansRaw.map(l => l.get({ plain: true }));

        const productsRaw = await Product.findAll();
        const employeesRaw = await Employee.findAll();
        
        const products = productsRaw.map(p => p.get({ plain: true }));
        const employees = employeesRaw.map(e => e.get({ plain: true }));

        allLoans.forEach(loan => {
            loan.Product = products.find(p => p.id === loan.productId);
            loan.Employee = employees.find(e => e.id === loan.employeeId);
        });

        const activeLoans = allLoans.filter(l => l.status === 'prestado');
        const historyLoans = allLoans.filter(l => l.status === 'devuelto');

        res.render('loans', { 
            loans: activeLoans, 
            history: historyLoans, 
            page: 'loans' 
        });

    } catch (error) {
        console.error("Error cargando préstamos:", error);
        res.send("Error al cargar préstamos");
    }
});

app.post('/loans/add', requireLogin, async (req, res) => {
    try {
        const employeeName = req.body.employeeName.trim().toUpperCase();
        const productCode = limpiarCodigo(req.body.productCode);
        const currentLoans = await Loan.findAll({ where: { status: 'prestado' }, include: [Product, Employee] });
        
        const product = await Product.findOne({ where: { code: productCode } });
        if (!product || product.stock <= 0) {
            return res.render('loans', { 
                loans: currentLoans,
                page: 'loans',
                error: !product ? `❌ Producto no encontrado` : "⚠️ Sin stock disponible"
            });
        }

        const employee = await Employee.findOne({ where: { name: employeeName } });
        if (!employee) {
            return res.render('loans', { 
                loans: currentLoans,
                page: 'loans',
                error: `🚫 Empleado no registrado.`
            });
        }

        const newStatus = product.category === 'herramienta' ? 'prestado' : 'consumido';
        const returnDate = product.category === 'consumible' ? new Date() : null;

        await Loan.create({
            quantity: 1,
            status: newStatus,
            date_out: new Date(),
            date_return: returnDate,
            productId: product.id,
            employeeId: employee.id,
            
            // --- GUARDAMOS LA FOTO (SNAPSHOT) DEL MOMENTO ---
            backup_product: product.description,     
            backup_employee: employee.name           
        });

        await product.decrement('stock');
        res.redirect('/loans');

    } catch (error) {
        res.send("Error al procesar: " + error.message);
    }
});

app.post('/loans/return/:id', requireLogin, async (req, res) => {
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
        res.send("Error al devolver");
    }
});

// --- EMPLEADOS (SOLUCIÓN INFALIBLE) ---
app.get('/employees', requireLogin, async (req, res) => {
    try {
        const employeesRaw = await Employee.findAll({ order: [['name', 'ASC']] });
        const employees = employeesRaw.map(e => e.get({ plain: true }));

        const activeLoans = await Loan.findAll({ where: { status: 'prestado' } });

        employees.forEach(emp => {
            emp.Loans = activeLoans.filter(loan => loan.employeeId === emp.id);
        });

        res.render('employees', { employees: employees, page: 'employees' });
    } catch (error) {
        console.error(error);
        res.send("Error al cargar empleados");
    }
});

app.post('/employees/add', requireLogin, async (req, res) => {
    try {
        await Employee.create({ name: req.body.name.toUpperCase() });
        res.redirect('/employees');
    } catch (error) {
        res.send("Error al crear empleado");
    }
});

// --- PERFIL DE EMPLEADO (Unión Manual corregida) ---
app.get('/employees/:id', requireLogin, async (req, res) => {
    try {
        const id = req.params.id;
        // 1. Buscamos al empleado
        const employeeRaw = await Employee.findByPk(id);
        if (!employeeRaw) return res.redirect('/employees');
        const employee = employeeRaw.get({ plain: true });
        
        const qrCode = await QRCode.toDataURL(employee.name);

        // 2. Buscamos SU historial (Crudo)
        const historyRaw = await Loan.findAll({
            where: { employeeId: id },
            order: [['date_out', 'DESC']]
        });
        const history = historyRaw.map(h => h.get({ plain: true }));

        // 3. Traemos los productos para la UNIÓN MANUAL
        const productsRaw = await Product.findAll();
        const products = productsRaw.map(p => p.get({ plain: true }));

        // 4. Conectamos los datos (Aseguramos que 'Product' exista con mayúscula)
        history.forEach(loan => {
            loan.Product = products.find(p => p.id === loan.productId);
        });

        // 5. Calculamos estadísticas
        const activeLoans = history.filter(h => h.status === 'prestado');
        const totalLoans = history.length;
        const returnedLoans = history.filter(h => h.status === 'devuelto').length;

        res.render('employee_profile', {
            page: 'employees',
            employee,
            qrCode,
            history,
            stats: { active: activeLoans.length, total: totalLoans, returned: returnedLoans }
        });
    } catch (error) {
        console.error(error);
        res.send("Error al cargar perfil");
    }
});

app.post('/employees/update/:id', requireLogin, async (req, res) => {
    try {
        await Employee.update({ name: req.body.name.toUpperCase() }, { where: { id: req.params.id } });
        res.redirect('/employees/' + req.params.id + '?alert=updated');
    } catch (error) {
        res.redirect('/employees');
    }
});

app.post('/employees/delete/:id', requireLogin, async (req, res) => {
    try {
        await Employee.destroy({ where: { id: req.params.id } });
        res.redirect('/employees');
    } catch (error) {
        res.send("Error al eliminar");
    }
});

// ==========================================
// MÓDULO DE ENTRADA MASIVA (AUDITORÍA/STOCK)
// ==========================================

// 1. Mostrar la pantalla
app.get('/inventory/audit', requireLogin, (req, res) => {
    res.render('audit', { page: 'inventory' }); 
});

// 2. Procesar el "Vuelco" (Análisis previo)
app.post('/inventory/audit-process', requireLogin, async (req, res) => {
    try {
        const rawData = req.body.rawData;
        if (!rawData) return res.redirect('/inventory/audit');

        // Limpiar datos
        const codes = rawData.split(/\r?\n/).map(c => c.trim()).filter(c => c !== "");

        // Contar ocurrencias
        const counts = {};
        codes.forEach(code => {
            counts[code] = (counts[code] || 0) + 1;
        });

        // Buscar en BD
        const scannedItems = [];
        let found = 0;
        let unknown = 0;

        const allProducts = await Product.findAll(); 
        
        for (const [code, count] of Object.entries(counts)) {
            // Buscamos coincidencia
            const product = allProducts.find(p => p.code === code || p.short_code === code);
            
            if (product) found++;
            else unknown++;

            scannedItems.push({
                code: code,
                count: count,
                product: product ? product.get({ plain: true }) : null
            });
        }

        res.render('audit', { 
            page: 'inventory',
            scannedItems: scannedItems,
            stats: { found, unknown }
        });

    } catch (error) {
        console.error(error);
        res.send("Error al procesar lectura");
    }
});

// 3. CONFIRMAR INGRESO (Sumar Stock)
app.post('/inventory/audit-confirm', requireLogin, async (req, res) => {
    try {
        const items = JSON.parse(req.body.validItems);

        for (const item of items) {
            if (item.product && item.product.id) {
                const productDb = await Product.findByPk(item.product.id);
                if (productDb) {
                    await productDb.increment('stock', { by: item.count });
                }
            }
        }

        res.redirect('/inventory?alert=stock_updated');

    } catch (error) {
        console.error(error);
        res.send("Error al actualizar el stock: " + error.message);
    }
});

// --- IMPORTACIÓN DESDE EXCEL ---

// 1. Descargar Plantilla Vacía (Para que el usuario sepa cómo llenar los datos)
app.get('/inventory/template', requireLogin, async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Plantilla de Carga');

    // Definimos las columnas exactas que el sistema espera
    worksheet.columns = [
        { header: 'CÓDIGO (Obligatorio)', key: 'code', width: 25 },
        { header: 'CLAVE CORTA (Opcional)', key: 'short_code', width: 15 },
        { header: 'DESCRIPCIÓN', key: 'description', width: 40 },
        { header: 'STOCK INICIAL', key: 'stock', width: 15 },
        { header: 'TIPO (Herramienta/Consumible)', key: 'category', width: 25 }
    ];

    // Ejemplo de ayuda en la primera fila (opcional, pero útil)
    worksheet.addRow({
        code: 'EJ-001',
        short_code: 'A-1',
        description: 'Ejemplo: Martillo (Borrar esta fila)',
        stock: 10,
        category: 'Herramienta'
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Plantilla_Inventario.xlsx');

    await workbook.xlsx.write(res);
    res.end();
});

// 2. Procesar el Excel subido
app.post('/inventory/import', requireLogin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.redirect('/inventory');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);

        const worksheet = workbook.getWorksheet(1);
        let importados = 0;
        let errores = 0;

        // --- CAMBIO IMPORTANTE: PREPARAMOS DATOS PRIMERO ---
        // Extraemos las filas a un array simple para poder iterarlas con 'await' (pausa) una por una.
        const filasParaProcesar = [];
        
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Saltar encabezado
            filasParaProcesar.push({ row, rowNumber });
        });

        // --- PROCESAMIENTO SECUENCIAL (UNO POR UNO) ---
        // Usamos un bucle for...of que respeta el 'await'. 
        // Esto evita que dos filas intenten escribirse al mismo tiempo.
        for (const item of filasParaProcesar) {
            const row = item.row;
            const rowNumber = item.rowNumber;

            // Lectura de celdas
            let code = row.getCell(1).value ? row.getCell(1).value.toString() : ''; 
            let short_code = row.getCell(2).value ? row.getCell(2).value.toString() : null;
            let description = row.getCell(3).value ? row.getCell(3).value.toString() : '';
            let stock = row.getCell(4).value ? parseInt(row.getCell(4).value) : 0;
            let categoryRaw = row.getCell(5).value ? row.getCell(5).value.toString().toLowerCase() : '';

            // Limpieza
            code = limpiarCodigo(code);
            if (!description) description = 'Sin descripción';
            
            // Categoría
            let category = 'consumible'; 
            if (categoryRaw.includes('herramienta') || categoryRaw.includes('fijo')) {
                category = 'herramienta';
            }

            if (code) {
                try {
                    // 1. Buscamos (Esperamos a que la BD responda)
                    const productoExistente = await Product.findOne({ where: { code: code } });

                    if (productoExistente) {
                        // 2. Si existe, actualizamos
                        const stockActual = parseInt(productoExistente.stock) || 0;
                        const stockEntrante = stock || 0;
                        const nuevoTotal = stockActual + stockEntrante;

                        console.log(`Fila ${rowNumber}: Actualizando ${code} (Stock ${stockActual} + ${stockEntrante} = ${nuevoTotal})`);
                        
                        await productoExistente.update({
                            description: description, 
                            stock: nuevoTotal, 
                            category: category,
                            // Solo actualizamos short_code si el del excel trae dato
                            short_code: short_code ? short_code : productoExistente.short_code 
                        });
                    } else {
                        // 3. Si no existe, creamos
                        console.log(`Fila ${rowNumber}: Creando nuevo ${code}`);
                        await Product.create({
                            code, short_code, description, stock, category
                        });
                    }
                    importados++;
                } catch (error) {
                    // Si falla, mostramos el error pero no detenemos el bucle
                    console.error(`Error crítico en fila ${rowNumber} (Código: ${code}):`, error.message);
                    errores++;
                }
            } else {
                errores++;
            }
        } // Fin del bucle for

        console.log(`--- Importación Finalizada: ${importados} procesados, ${errores} errores ---`);
        res.redirect('/inventory?alert=imported');

    } catch (error) {
        console.error("Error general importando Excel:", error);
        res.send("Error en el archivo: " + error.message);
    }
});

// INICIAR
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`--- Servidor corriendo en http://localhost:${PORT} ---`);
});