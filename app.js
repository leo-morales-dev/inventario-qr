/**
 * archivo: app.js
 * Versión: MAESTRA FINAL + HISTORIAL DE MOVIMIENTOS
 */

const express = require('express');
const app = express();
const path = require('path');
const session = require('express-session');
const sequelize = require('./database'); 
const QRCode = require('qrcode');
const ExcelJS = require('exceljs'); 
const { Op } = require('sequelize'); 
const multer = require('multer'); 
const upload = multer({ storage: multer.memoryStorage() }); 

// --- IMPORTAR LIBRERÍA XML ---
const xml2js = require('xml2js'); 

// Importar Modelos
const Product = require('./models/Product');
const Employee = require('./models/Employee');
const Loan = require('./models/Loan');
const User = require('./models/User');
// --- NUEVOS MODELOS ---
const SupplierCode = require('./models/SupplierCode'); 
const DamageLog = require('./models/DamageLog'); 
const InventoryLog = require('./models/InventoryLog'); // <--- 1. NUEVO MODELO HISTORIAL

// Configuración básica
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// --- CONFIGURACIÓN DE SESIÓN ---
app.use(session({
    secret: 'secreto_super_seguro_tooltrack', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } 
}));

// --- RELACIONES DE BASE DE DATOS ---
Employee.hasMany(Loan, { foreignKey: 'employeeId' });
Loan.belongsTo(Employee, { foreignKey: 'employeeId' });

Product.hasMany(Loan, { foreignKey: 'productId' });
Loan.belongsTo(Product, { foreignKey: 'productId' });

// Relación Claves Proveedor
if (!SupplierCode.associations['Product']) {
    SupplierCode.belongsTo(Product, { foreignKey: 'productId' });
}
if (!Product.associations['ExtraCodes']) {
    Product.hasMany(SupplierCode, { foreignKey: 'productId', as: 'ExtraCodes' }); 
}

// Relación Producto - Daños
if (!Product.associations['DamageLogs']) {
    Product.hasMany(DamageLog, { foreignKey: 'productId' });
}
if (!DamageLog.associations['Product']) {
    DamageLog.belongsTo(Product, { foreignKey: 'productId', as: 'Product' });
}

// Relación Producto - Historial (NUEVO)
if (!Product.associations['History']) {
    Product.hasMany(InventoryLog, { foreignKey: 'productId', as: 'History' });
}
if (!InventoryLog.associations['Product']) {
    InventoryLog.belongsTo(Product, { foreignKey: 'productId', as: 'Product' });
}

// --- SINCRONIZACIÓN Y ADMIN ---
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

// --- FUNCIÓN HELPER PARA REGISTRAR HISTORIAL (NUEVO) ---
// --- FUNCIÓN HELPER MEJORADA PARA REGISTRAR HISTORIAL ---
async function registrarLog(productId, action, description, user = 'Administrador') {
    try {
        // 1. Buscamos el producto para tomar su "foto" (Backup)
        const product = await Product.findByPk(productId);
        
        await InventoryLog.create({
            productId,
            action,
            description,
            user,
            // 2. Guardamos los datos de texto por si se borra el producto original
            backup_product: product ? product.description : 'Desconocido',
            backup_code: product ? product.code : '---'
        });
    } catch (e) {
        console.error("Error guardando log:", e);
    }
}

// ==========================================
// RUTAS
// ==========================================

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

// ==========================================
// ENTRADA MASIVA (MODO TEXTO / VUELCO)
// ==========================================

// 1. Mostrar pantalla
app.get('/inventory/audit', requireLogin, (req, res) => {
    res.render('audit', { page: 'inventory' });
});

// 2. Procesar datos del cuadro de texto
// --- RUTA: PROCESAR ESCANEO (VISTA PREVIA) ---
app.post('/inventory/audit-process', requireLogin, async (req, res) => {
    try {
        const { rawData } = req.body;

        // 1. Validación básica
        if (!rawData || rawData.trim() === '') {
            // Si está vacío, recargamos la página avisando
            return res.render('audit', { 
                page: 'inventory', 
                user: req.session.user,
                preview: null, // Importante para que salga "Esperando datos"
                alert: 'empty'
            });
        }

        // 2. Procesar líneas (Separar por Enter)
        // El regex /\r?\n/ maneja saltos de línea de Windows y Linux/Mac
        const lines = rawData.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');

        // 3. Contar ocurrencias y limpiar códigos
        const counts = {};
        lines.forEach(rawCode => {
            // DOBLE SEGURIDAD: Reemplazamos comilla simple por guion aquí también
            // y convertimos a mayúsculas por si acaso
            const code = rawCode.replace(/'/g, '-').replace(/´/g, '-').toUpperCase();
            
            if (code) {
                counts[code] = (counts[code] || 0) + 1;
            }
        });

        const uniqueCodes = Object.keys(counts);

        // 4. Buscar en Base de Datos
        // Buscamos todos los productos que coincidan con los códigos escaneados
        const products = await Product.findAll({
            where: {
                code: { [Op.in]: uniqueCodes }
            }
        });

        // 5. Armar objeto de Vista Previa (Preview)
        // Cruzamos lo escaneado con lo encontrado en BD
        const preview = uniqueCodes.map(code => {
            const product = products.find(p => p.code === code);
            return {
                code: code,
                count: counts[code],
                found: !!product,      // true si existe, false si no
                product: product || null
            };
        });

        // 6. RENDERIZAR LA PANTALLA CON LOS DATOS
        // Aquí estaba el problema: hay que enviar 'preview' a la vista
        res.render('audit', { 
            page: 'inventory', 
            user: req.session.user,
            preview: preview, // <--- ¡ESTA ES LA CLAVE!
            rawData: rawData  // Opcional: por si quieres mantener el texto en el cuadro
        });

    } catch (error) {
        console.error("Error en audit-process:", error);
        res.send("Error al procesar datos: " + error.message);
    }
});

// 3. Confirmar y Guardar en BD
// ==========================================
// RUTA: CONFIRMAR Y GUARDAR STOCK MASIVO
// ==========================================
app.post('/inventory/audit-confirm', requireLogin, async (req, res) => {
    try {
        const { jsonData } = req.body;

        if (!jsonData) {
            throw new Error("No se recibieron datos para procesar.");
        }

        const items = JSON.parse(jsonData);
        let contadorActualizados = 0;

        // Iteramos sobre cada item detectado
        for (const item of items) {
            if (item.found && item.count > 0) {
                const product = await Product.findOne({ where: { code: item.code } });
                
                if (product) {
                    // 1. Sumar al stock
                    const stockAnterior = product.stock;
                    product.stock += item.count;
                    await product.save();

                    // 2. Registrar en el Historial
                    await registrarLog(
                        product.id, 
                        'ENTRADA MASIVA', 
                        `Carga Scanner: +${item.count} unidades (Stock: ${stockAnterior} -> ${product.stock})`, 
                        req.session.user.name
                    );
                    
                    contadorActualizados++;
                }
            }
        }

        // Redirigir al inventario con éxito
        res.redirect(`/inventory?alert=success&msg=Se actualizaron ${contadorActualizados} productos correctamente`);

    } catch (error) {
        console.error("Error en audit-confirm:", error);
        res.send("Error al guardar datos: " + error.message);
    }
});

// --- INVENTARIO ---

app.get('/inventory/export', requireLogin, async (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        let products = await Product.findAll({
            include: [{ model: SupplierCode, as: 'ExtraCodes' }]
        });

        if (filter === 'tools') products = products.filter(p => p.category === 'herramienta');
        else if (filter === 'consumables') products = products.filter(p => p.category === 'consumible');
        else if (filter === 'low') products = products.filter(p => p.stock < 5);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Inventario');

        worksheet.columns = [
            { header: 'CLAVES (Todas)', key: 'short_code', width: 25 }, 
            { header: 'CODIGO', key: 'code', width: 25 },
            { header: 'DESCRIPCIÓN', key: 'description', width: 40 },
            { header: 'EXISTENCIA', key: 'stock', width: 15 },
            { header: 'TIPO', key: 'category', width: 15 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        products.forEach(product => {
            let claves = [];
            if (product.short_code && product.short_code !== '--') claves.push(product.short_code);
            if (product.ExtraCodes && product.ExtraCodes.length > 0) {
                product.ExtraCodes.forEach(ec => claves.push(ec.codigo_proveedor));
            }
            let clavesString = [...new Set(claves)].join(', ');

            worksheet.addRow({
                short_code: clavesString,
                code: product.code,
                description: product.description,
                stock: product.stock,
                category: product.category.toUpperCase()
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Inventario_General.xlsx');
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error(error);
        res.send("Error al exportar");
    }
});

app.get('/inventory', requireLogin, async (req, res) => {
    try {
        const products = await Product.findAll({
            include: [{ model: SupplierCode, as: 'ExtraCodes' }],
            order: [['createdAt', 'DESC']]
        }); 
        res.render('inventory', { products: products, page: 'inventory' }); 
    } catch (error) {
        res.send("Error al cargar inventario: " + error.message);
    }
});

// --- ALTA MANUAL CON LOG ---
app.post('/inventory/add', requireLogin, async (req, res) => {
    try {
        const { short_code, description, stock, category } = req.body;
        const code = limpiarCodigo(req.body.code); 
        
        const newProduct = await Product.create({ code, short_code, description, stock, category });
        
        // LOG
        await registrarLog(newProduct.id, 'ALTA MANUAL', `Producto creado con stock inicial: ${stock}`);

        res.redirect('/inventory?alert=created');
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.redirect('/inventory?alert=duplicate');
        }
        res.send("Error al guardar: " + error.message);
    }
});

app.get('/inventory/edit/:id', requireLogin, async (req, res) => {
    try {
        const product = await Product.findByPk(req.params.id, {
            include: [{ model: SupplierCode, as: 'ExtraCodes' }]
        });
        
        if (!product) return res.redirect('/inventory');
        res.render('edit_product', { product: product, page: 'inventory' });
    } catch (error) {
        console.error(error);
        res.redirect('/inventory');
    }
});

// --- EDICIÓN CON LOG ---
app.post('/inventory/update/:id', requireLogin, async (req, res) => {
    try {
        const { short_code, description, stock, category, extra_ids, extra_values } = req.body;
        const code = limpiarCodigo(req.body.code); 
        
        const currentProduct = await Product.findByPk(req.params.id);
        const oldShortCode = currentProduct.short_code;

        await Product.update(
            { code, short_code, description, stock, category }, 
            { where: { id: req.params.id } }
        );
        
        // LOG
        await registrarLog(req.params.id, 'EDICIÓN', 'Se actualizaron los detalles del producto.');

        if (short_code && oldShortCode && short_code !== oldShortCode) {
            await SupplierCode.update(
                { codigo_proveedor: short_code }, 
                { where: { productId: req.params.id, codigo_proveedor: oldShortCode } }
            );
        }

        if (extra_ids && extra_values) {
            const ids = Array.isArray(extra_ids) ? extra_ids : [extra_ids];
            const vals = Array.isArray(extra_values) ? extra_values : [extra_values];

            for (let i = 0; i < ids.length; i++) {
                if(vals[i] && vals[i].trim() !== '') {
                     await SupplierCode.update(
                        { codigo_proveedor: vals[i] },
                        { where: { id: ids[i] } }
                    );
                }
            }
        }

        res.redirect('/inventory/edit/' + req.params.id + '?alert=updated');
    } catch (error) {
        res.send("Error al actualizar: " + error.message);
    }
});

app.post('/inventory/delete/:id', requireLogin, async (req, res) => {
    try {
        const productId = req.params.id;
        
        // 1. Borramos códigos de proveedor (estos sí se van)
        await SupplierCode.destroy({ where: { productId: productId } });
        
        // 2. ¡IMPORTANTE! YA NO BORRAMOS NI Logs, NI Loans, NI Damages.
        // Solo borramos el producto. El historial quedará huérfano pero visible gracias al backup.
        
        await Product.destroy({ where: { id: productId } });
        res.redirect('/inventory?alert=deleted');
    } catch (error) {
        res.send("Error al eliminar producto: " + error.message);
    }
});

// REEMPLAZA TODA ESTA RUTA EN app.js

app.post('/inventory/delete-bulk', requireLogin, async (req, res) => {
    try {
        const { filter } = req.body; 
        
        const whereClause = {}; 

        // --- LÓGICA COMPLETA DE FILTROS ---
        if (filter === 'tools') {
            whereClause.category = 'herramienta';
        } else if (filter === 'consumables') {
            whereClause.category = 'consumible';
        } else if (filter === 'low') {
            whereClause.stock = { [Op.lt]: 5 }; // Menor a 5
        } 
        // Si el filtro es 'all' o viene vacío, whereClause se queda {} y borra todo (correcto para "Todos")

        const productsToDelete = await Product.findAll({ where: whereClause, attributes: ['id'] });
        const productIds = productsToDelete.map(p => p.id);

        if (productIds.length > 0) {
            // 1. Borrar claves de proveedor
            await SupplierCode.destroy({ where: { productId: productIds } });
            
            // 2. Borrar productos (El historial se mantiene gracias al backup)
            await Product.destroy({ where: { id: productIds } });
        }

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

// ==========================================
// IMPORTACIÓN XML INTELIGENTE
// ==========================================

app.post('/inventory/import-xml', requireLogin, upload.single('xmlFile'), async (req, res) => {
    try {
        if (!req.file) return res.redirect('/inventory');

        const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
        const xmlData = await parser.parseStringPromise(req.file.buffer.toString());

        const comprobante = xmlData['cfdi:Comprobante'];
        const emisor = comprobante['cfdi:Emisor'];
        const rfcProveedor = emisor['$']['Rfc'];
        const conceptosBlock = comprobante['cfdi:Conceptos']['cfdi:Concepto'];
        
        const listaConceptos = Array.isArray(conceptosBlock) ? conceptosBlock : [conceptosBlock];
        const productosDesconocidos = [];

        for (const item of listaConceptos) {
            const codigoProv = item['$']['NoIdentificacion'] || item['$']['ClaveProdServ'];
            const descripcionProv = item['$']['Descripcion'];
            const cantidad = parseFloat(item['$']['Cantidad']);

            if (codigoProv) {
                let mapeo = await SupplierCode.findOne({
                    where: { rfc_proveedor: rfcProveedor, codigo_proveedor: codigoProv },
                    include: [Product]
                });

                if (!mapeo) {
                    const productoManual = await Product.findOne({
                        where: {
                            [Op.or]: [
                                { short_code: codigoProv },
                                { code: codigoProv }
                            ]
                        }
                    });

                    if (productoManual) {
                        mapeo = await SupplierCode.create({
                            rfc_proveedor: rfcProveedor,
                            codigo_proveedor: codigoProv,
                            productId: productoManual.id
                        });
                        mapeo.Product = productoManual;
                    }
                }

                if (mapeo && mapeo.Product) {
                    // Si ya existe y lo encuentra automáticamente, sumamos stock y registramos log
                    await mapeo.Product.increment('stock', { by: cantidad });
                    await registrarLog(mapeo.Product.id, 'ENTRADA XML', `Se sumaron ${cantidad} unidades (Reconocimiento Automático).`);
                } else {
                    productosDesconocidos.push({ 
                        rfc: rfcProveedor, 
                        codigo: codigoProv, 
                        descripcion: descripcionProv, 
                        cantidad: cantidad 
                    });
                }
            }
        }

        if (productosDesconocidos.length > 0) {
            const allProducts = await Product.findAll(); 
            return res.render('match_xml', { items: productosDesconocidos, products: allProducts, page: 'inventory' });
        }

        res.redirect('/inventory?alert=xml_success');

    } catch (error) { res.send("Error procesando XML: " + error.message); }
});

// --- GUARDAR VINCULACIÓN CON LOG ---
app.post('/inventory/save-mapping', async (req, res) => {
    try {
        const toArray = (val) => (Array.isArray(val) ? val : [val]);
        
        const targetProductIds = toArray(req.body.targetProductId);
        const internalIds = toArray(req.body.internal_id || []); 
        const supplierCodes = toArray(req.body.supplier_code || []); 
        const descriptions = toArray(req.body.descripcion_xml);
        const customNames = toArray(req.body.custom_name || []);
        const rfcs = toArray(req.body.rfc);
        const cantidades = toArray(req.body.cantidad);
        const categories = toArray(req.body.category_xml || []); 

        for (let i = 0; i < targetProductIds.length; i++) {
            let action = targetProductIds[i]; 
            if (action === 'SKIP') continue;

            let productId = null;
            const cantidadEntrante = parseFloat(cantidades[i]) || 0; 
            const codigoProveedor = supplierCodes[i];
            const rfc = rfcs[i];

            // Protección anti-duplicados
            if (action === 'NEW' && codigoProveedor) {
                const coincidenciaPrevia = await SupplierCode.findOne({
                    where: { rfc_proveedor: rfc, codigo_proveedor: codigoProveedor }
                });
                if (coincidenciaPrevia) action = coincidenciaPrevia.productId; 
            }

            if (action === 'NEW') {
                let finalDescription = descriptions[i];
                if (customNames[i] && customNames[i].trim() !== '') finalDescription = customNames[i];
                
                const codigoParaGuardar = internalIds[i]; 
                const selectedCategory = categories[i] || 'consumible'; 

                const newProduct = await Product.create({
                    description: finalDescription, 
                    code: codigoParaGuardar, 
                    stock: cantidadEntrante, 
                    short_code: codigoProveedor, 
                    category: selectedCategory 
                });
                productId = newProduct.id;
                
                // LOG
                await registrarLog(newProduct.id, 'ALTA XML', `Importado desde XML. Proveedor: ${codigoProveedor}`);

            } else {
                productId = action;
                const productoExistente = await Product.findByPk(productId);
                if (productoExistente) {
                    await productoExistente.increment('stock', { by: cantidadEntrante });
                    // LOG
                    await registrarLog(productId, 'ENTRADA XML', `Se sumaron ${cantidadEntrante} unidades por vinculación XML.`);
                }
            }

            if (productId && codigoProveedor) {
                const [relation, created] = await SupplierCode.findOrCreate({
                    where: { rfc_proveedor: rfc, codigo_proveedor: codigoProveedor },
                    defaults: { productId: productId }
                });
                if (!created && relation.productId !== productId) {
                    relation.productId = productId;
                    await relation.save();
                }
            }
        }
        res.redirect('/inventory?alert=xml_processed'); 
    } catch (error) { 
        console.error(error);
        res.status(500).send(`Error: ${error.message}`); 
    }
});

app.post('/inventory/import', requireLogin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.redirect('/inventory');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.getWorksheet(1);
        const filas = [];
        worksheet.eachRow((row, n) => { if(n>1) filas.push(row); });

        for (const row of filas) {
            let code = row.getCell(1).value ? row.getCell(1).value.toString() : '';
            let rawClaves = row.getCell(2).value ? row.getCell(2).value.toString() : '';
            let clavesArray = rawClaves.split(',').map(c => c.trim()).filter(c => c !== '');
            let primary = clavesArray[0];
            let extras = clavesArray.slice(1);

            let desc = row.getCell(3).value ? row.getCell(3).value.toString() : 'Sin nombre';
            let stock = parseInt(row.getCell(4).value) || 0;
            code = limpiarCodigo(code);

            if(code) {
                let prod = await Product.findOne({ where: { code } });
                if(prod) {
                    await prod.update({ stock: prod.stock + stock, description: desc });
                    // LOG IMPORTACIÓN
                    await registrarLog(prod.id, 'ENTRADA EXCEL', `Se sumaron ${stock} unidades desde Excel.`);
                } else {
                    prod = await Product.create({ code, description: desc, stock, short_code: primary, category: 'consumible' });
                    // LOG IMPORTACIÓN
                    await registrarLog(prod.id, 'ALTA EXCEL', `Creado masivamente desde Excel.`);
                }
                for(const ex of extras) {
                    await SupplierCode.findOrCreate({ where: { productId: prod.id, codigo_proveedor: ex }, defaults: { rfc_proveedor: 'EXCEL' } });
                }
            }
        }
        res.redirect('/inventory?alert=imported');
    } catch (e) { res.send(e.message); }
});

// ==========================================
// GESTIÓN DE CLAVES EXTRA (SupplierCodes)
// ==========================================

app.post('/code/update/:id', requireLogin, async (req, res) => {
    try {
        const { new_code, product_id } = req.body;
        if (new_code) {
            await SupplierCode.update(
                { codigo_proveedor: new_code },
                { where: { id: req.params.id } }
            );
        }
        res.redirect('/inventory/edit/' + product_id + '?alert=updated');
    } catch (error) {
        res.send("Error al actualizar clave: " + error.message);
    }
});

app.post('/code/delete/:id', requireLogin, async (req, res) => {
    try {
        const { product_id } = req.body;
        await SupplierCode.destroy({ where: { id: req.params.id } });
        res.redirect('/inventory/edit/' + product_id + '?alert=deleted');
    } catch (error) {
        res.send("Error al eliminar clave");
    }
});

// ==========================================
// MÓDULO DE MERMAS / DAÑOS
// ==========================================

app.get('/damages', requireLogin, async (req, res) => {
    try {
        const damages = await DamageLog.findAll({
            include: [{ model: Product, as: 'Product' }],
            order: [['createdAt', 'DESC']]
        });
        
        const history = damages.map(d => {
            const item = d.get({ plain: true });
            item.formattedDate = new Date(item.createdAt).toLocaleString('es-MX', { 
                timeZone: 'America/Mexico_City',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
            return item;
        });

        res.render('damages', { history, page: 'damages' });
    } catch (error) {
        console.error(error);
        res.send("Error cargando historial de daños");
    }
});

app.post('/inventory/report-damage', requireLogin, async (req, res) => {
    try {
        const { productId, quantity, reason, specific_code } = req.body;
        const qty = parseInt(quantity);

        const product = await Product.findByPk(productId);
        
        if (!product) return res.redirect('/inventory?error=noproduct');
        if (product.stock < qty) return res.redirect('/inventory?error=nostock');

        await product.decrement('stock', { by: qty });

        await DamageLog.create({
            quantity: qty,
            reason: reason,
            productId: product.id,
            specific_code: specific_code,
            backup_product: product.description,
            backup_code: product.code
        });
        
        // LOG TAMBIÉN EN EL HISTORIAL GENERAL
        await registrarLog(product.id, 'BAJA/MERMA', `Se reportaron ${qty} unidades dañadas. Motivo: ${reason}`);

        res.redirect('/damages?alert=reported');

    } catch (error) {
        console.error(error);
        res.send("Error reportando daño: " + error.message);
    }
});
app.get('/employees', requireLogin, async (req, res) => {
    try {
        // AGREGAMOS "include: [Loan]" PARA QUE TRAIGA LOS PRÉSTAMOS
        const employees = await Employee.findAll({ 
            include: [Loan], // <--- ESTA ES LA LÍNEA QUE FALTABA
            order: [['name', 'ASC']] 
        });
        
        res.render('employees', { employees: employees, page: 'employees' });
    } catch (error) { 
        console.error(error); // Agregué console.error para ver si falla algo más
        res.send("Error cargando empleados"); 
    }
});
app.post('/employees/add', requireLogin, async (req, res) => {
    await Employee.create({ name: req.body.name.toUpperCase() }); res.redirect('/employees');
});
app.post('/employees/delete/:id', requireLogin, async (req, res) => {
    await Employee.destroy({ where: { id: req.params.id } }); res.redirect('/employees');
});
// BUSCA Y REEMPLAZA ESTA RUTA EN app.js

app.get('/employees/:id', requireLogin, async (req, res) => {
    try {
        const emp = await Employee.findByPk(req.params.id);
        if (!emp) return res.redirect('/employees');

        // 1. Buscamos los préstamos (Datos Crudos / Sequelize Instances)
        const loansRaw = await Loan.findAll({ 
            where: { employeeId: req.params.id }, 
            include: [{ model: Product }], // Incluimos el modelo Producto
            order: [['date_out', 'DESC']] 
        });

        // 2. [CORRECCIÓN CLAVE] Convertir a objetos planos (JSON puro)
        // Esto permite que la vista lea 'loan.Product.code' sin problemas
        const history = loansRaw.map(loan => loan.get({ plain: true }));

        const qrCode = await QRCode.toDataURL(emp.id.toString());
        
        // Usamos la lista 'history' ya limpia para los cálculos
        const active = history.filter(l => l.status === 'prestado').length;
        const returned = history.filter(l => l.status === 'devuelto' || l.status === 'consumido').length;

        res.render('employee_profile', { 
            employee: emp, 
            history: history, // Enviamos la lista limpia a la vista
            page: 'employees', 
            qrCode: qrCode,
            stats: { active, total: history.length, returned } 
        });

    } catch(e) { 
        console.error(e);
        res.redirect('/employees'); 
    }
});

app.get('/loans', requireLogin, async (req, res) => {
    try {
        const allLoansRaw = await Loan.findAll({ order: [['date_out', 'DESC']] });
        const allLoans = allLoansRaw.map(l => l.get({ plain: true }));
        const products = (await Product.findAll()).map(p => p.get({ plain: true }));
        const employees = (await Employee.findAll()).map(e => e.get({ plain: true }));
        allLoans.forEach(loan => {
            loan.Product = products.find(p => p.id === loan.productId);
            loan.Employee = employees.find(e => e.id === loan.employeeId);
        });
        res.render('loans', { loans: allLoans.filter(l => l.status === 'prestado'), history: allLoans.filter(l => l.status === 'devuelto'), page: 'loans' });
    } catch (error) { res.send("Error al cargar préstamos"); }
});
app.post('/loans/add', requireLogin, async (req, res) => {
    try {
        // 1. Recibimos el ID en lugar del Nombre
        const empId = req.body.employeeId.trim(); 
        const productCode = limpiarCodigo(req.body.productCode);
        
        // 2. Buscamos Producto
        const product = await Product.findOne({ where: { code: productCode } });
        if (!product || product.stock <= 0) return res.redirect('/loans?error=stock');

        // 3. CAMBIO: Buscamos Empleado por su ID (Primary Key)
        const employee = await Employee.findByPk(empId);
        
        // Si no existe el ID, error
        if (!employee) return res.redirect('/loans?error=employee');

        // 4. Lógica de préstamo (igual que antes)
        const newStatus = product.category === 'herramienta' ? 'prestado' : 'consumido';
        const returnDate = product.category === 'consumible' ? new Date() : null;

        await Loan.create({
            quantity: 1, 
            status: newStatus, 
            date_out: new Date(), 
            date_return: returnDate,
            productId: product.id, 
            employeeId: employee.id,
            // Respaldos
            backup_product: product.description, 
            backup_employee: employee.name, 
            backup_code: product.code          
        });

        await product.decrement('stock');
        
        // LOG (Usamos el nombre real del empleado encontrado por ID)
        if (product.category === 'consumible') {
            await registrarLog(product.id, 'CONSUMO', `Entregado a ${employee.name}`);
        } else {
            await registrarLog(product.id, 'PRÉSTAMO', `Prestado a ${employee.name}`);
        }

        res.redirect('/loans');

    } catch (error) { 
        console.error(error);
        res.send("Error: " + error.message); 
    }
});
// BUSCA Y REEMPLAZA ESTA RUTA EN app.js

app.post('/loans/return/:id', requireLogin, async (req, res) => {
    try {
        // 1. Buscamos el préstamo INCLUYENDO los datos del Empleado
        const loan = await Loan.findByPk(req.params.id, {
            include: [Employee] 
        });

        if (!loan) return res.redirect('/loans');

        const product = await Product.findByPk(loan.productId);
        
        loan.status = 'devuelto';
        loan.date_return = new Date();
        await loan.save();

        if (product) {
            await product.increment('stock');
            
            // 2. Obtenemos el nombre real (o el respaldo si el empleado se borró)
            const nombreEmpleado = loan.Employee ? loan.Employee.name : (loan.backup_employee || 'Empleado');

            // 3. Guardamos el log con el NOMBRE ESPECÍFICO
            await registrarLog(product.id, 'DEVOLUCIÓN', `Devuelto por ${nombreEmpleado}`);
        }

        res.redirect('/loans');
    } catch (error) { 
        console.error(error);
        res.send("Error al devolver"); 
    }
});

// ==========================================
// RUTA DE HISTORIAL GENERAL (NUEVO)
// ==========================================
app.get('/history', requireLogin, async (req, res) => {
    try {
        const logs = await InventoryLog.findAll({
            include: [{ model: Product, as: 'Product' }],
            order: [['createdAt', 'DESC']]
        });

        const formattedLogs = logs.map(log => {
            const l = log.get({ plain: true });
            l.fechaFormat = new Date(l.createdAt).toLocaleDateString('es-MX');
            l.horaFormat = new Date(l.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
            return l;
        });

        res.render('history', { logs: formattedLogs, page: 'history' });
    } catch (error) {
        res.send("Error al cargar historial: " + error.message);
    }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`--- Servidor corriendo en http://localhost:${PORT} ---`);
});