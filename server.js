// server.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3005;

const corsOptions = {
    origin: function (origin, callback) {
        const environment = process.env.NODE_ENV || 'development';
        
        let allowedOrigins;
        
        if (environment === 'production') {
            allowedOrigins = [
                process.env.FRONTEND_URL,
                process.env.RAILWAY_STATIC_URL,
                'https://evaluation-frontend-production.up.railway.app'
            ].filter(Boolean);
            
            if (allowedOrigins.length === 0) {
                const railwayPattern = /^https:\/\/.*\.railway\.app$/;
                if (origin && railwayPattern.test(origin)) {
                    allowedOrigins.push(origin);
                }
            }
        } else {
            allowedOrigins = [
                'http://localhost:3005',
                'http://127.0.0.1:3005',
                'http://localhost:3000',
                'http://127.0.0.1:3000',
            ];
        }
        
        if (!origin) {
            return callback(null, true);
        }
        
        if (allowedOrigins.includes(origin)) {
            console.log(`✅ CORS: Permitido desde ${origin}`);
            callback(null, true);
        } else {
            console.warn(`❌ CORS: Bloqueado desde ${origin}`);
            console.warn(`   Orígenes permitidos: ${allowedOrigins.join(', ')}`);
            callback(new Error('Acceso bloqueado por política CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};

// Rate limiting para login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // máximo 5 intentos por IP
    message: {
        error: 'Demasiados intentos de login',
        message: 'Has excedido el límite de intentos. Intenta nuevamente en 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Configuración de sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || 'tu-clave-secreta-muy-segura-cambiala-en-produccion',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS en producción
        httpOnly: true, // Prevenir XSS
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// app.use('/api', networkRestrictionMiddleware); // Comentado para permitir acceso desde cualquier IP

const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('ERROR: Variables de entorno faltantes:', missingVars.join(', '));
    console.error('Configura estas variables en Railway Dashboard o en tu archivo .env');
    process.exit(1);
}

// Verificar si hay configuración para BigCenter DB
const bigCenterEnvVars = ['BIGCENTER_DB_HOST', 'BIGCENTER_DB_USER', 'BIGCENTER_DB_PASSWORD', 'BIGCENTER_DB_NAME'];
const hasBigCenterConfig = bigCenterEnvVars.every(varName => process.env[varName]);

if (!hasBigCenterConfig) {
    console.warn('⚠️ WARNING: Configuración de BigCenter DB no encontrada. Solo se usará la BD principal.');
    console.warn('   Variables faltantes:', bigCenterEnvVars.filter(varName => !process.env[varName]).join(', '));
}


const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Configuración para BigCenter DB
const bigCenterDbConfig = hasBigCenterConfig ? {
    host: process.env.BIGCENTER_DB_HOST,
    user: process.env.BIGCENTER_DB_USER,
    password: process.env.BIGCENTER_DB_PASSWORD,
    database: process.env.BIGCENTER_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
} : null;

// Debug: Mostrar configuración de BD (sin password)
console.log('🔗 Configuración de Base de Datos Principal:');
console.log(`   Host: ${dbConfig.host}`);
console.log(`   Usuario: ${dbConfig.user}`);
console.log(`   Base de Datos: ${dbConfig.database}`);
console.log(`   Password: ${dbConfig.password ? '[CONFIGURADO]' : '[NO CONFIGURADO]'}`);

if (bigCenterDbConfig) {
    console.log('🔗 Configuración de BigCenter DB:');
    console.log(`   Host: ${bigCenterDbConfig.host}`);
    console.log(`   Usuario: ${bigCenterDbConfig.user}`);
    console.log(`   Base de Datos: ${bigCenterDbConfig.database}`);
    console.log(`   Password: ${bigCenterDbConfig.password ? '[CONFIGURADO]' : '[NO CONFIGURADO]'}`);
}

const pool = mysql.createPool(dbConfig);
const bigCenterPool = bigCenterDbConfig ? mysql.createPool(bigCenterDbConfig) : null;

function isIPInNetwork(clientIP, networkCIDR) {
    const [network, prefixLength] = networkCIDR.split('/');
    const prefix = parseInt(prefixLength);
    
    const ipToNumber = (ip) => {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
    };
    
    const clientIPNum = ipToNumber(clientIP);
    const networkNum = ipToNumber(network);
    const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
    
    return (clientIPNum & mask) === (networkNum & mask);
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           req.ip;
}

function networkRestrictionMiddleware(req, res, next) {
    const clientIP = getClientIP(req);
    
    // Redes permitidas - CONFIGURADO PARA TU UBICACIÓN
    const allowedNetworks = [
        '192.168.0.0/24',    // Tu red WiFi (192.168.0.1 - 192.168.0.254)
        '127.0.0.0/8',       // Localhost (para desarrollo)
        '::1',               // IPv6 localhost
    ];
    
    let isAllowed = false;
    let matchedNetwork = null;
    
    for (const network of allowedNetworks) {
        if (network.includes(':')) {
            // IPv6 - permitir localhost IPv6
            if (clientIP === '::1' && network === '::1') {
                isAllowed = true;
                matchedNetwork = network;
                break;
            }
        } else if (network.includes('/')) {
            // CIDR notation
            if (isIPInNetwork(clientIP, network)) {
                isAllowed = true;
                matchedNetwork = network;
                break;
            }
        } else {
            // IP exacta
            if (clientIP === network) {
                isAllowed = true;
                matchedNetwork = network;
                break;
            }
        }
    }
    
    if (isAllowed) {
        console.log(`✅ RED: Acceso permitido desde ${clientIP} (red: ${matchedNetwork})`);
        next();
    } else {
        console.warn(`❌ RED: Acceso denegado desde ${clientIP}`);
        console.warn(`   Redes permitidas: ${allowedNetworks.join(', ')}`);
        console.warn(`   💡 Solo el equipo en la red local puede acceder`);
        
        return res.status(403).json({
            error: 'Acceso denegado por restricción de red',
            message: 'Solo se permite el acceso desde la red local autorizada',
            clientIP: clientIP,
            hint: 'Conéctate a la red WiFi de la oficina para acceder'
        });
    }
}

function validatePositiveInteger(value, fieldName = 'campo') {
    const num = parseInt(value);
    if (isNaN(num) || num <= 0 || !Number.isInteger(num)) {
        throw new Error(`${fieldName} debe ser un número entero positivo`);
    }
    return num;
}

function validateLeadId(leadId) {
    if (!leadId || typeof leadId !== 'string') {
        throw new Error('Lead ID es requerido');
    }
    
    const leadIdPattern = /^[a-zA-Z0-9\-_.]{1,100}$/;
    if (!leadIdPattern.test(leadId)) {
        throw new Error('Lead ID contiene caracteres no válidos o es demasiado largo');
    }
    
    return leadId.trim();
}

function handleValidationError(error, res, operation = 'operación') {
    console.error(`❌ Error de validación en ${operation}:`, error.message);
    return res.status(400).json({ 
        error: 'Datos de entrada no válidos',
        details: error.message 
    });
}

// Helper function to parse time string to seconds
function timeToSeconds(timeStr) {
    if (!timeStr || timeStr === '00:00:00') return 0;
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
}

// Helper function to format seconds to HH:MM:SS
function secondsToTime(seconds) {
    if (!seconds) return '00:00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Helper function to fix malformed JSON from database
function fixJsonString(jsonString) {
    if (!jsonString) return jsonString;
    
    let fixed = jsonString;
    
    // Remove carriage returns and extra whitespace
    fixed = fixed.replace(/\r/g, '').replace(/\n/g, '');
    
    // Fix time values that are not quoted (e.g., 00:21:56 -> "00:21:56")
    fixed = fixed.replace(/:\s*(\d{1,2}:\d{1,2}:\d{1,2})/g, ': "$1"');
    
    // Fix boolean values that might not be quoted properly
    fixed = fixed.replace(/:\s*true\b/g, ': true');
    fixed = fixed.replace(/:\s*false\b/g, ': false');
    fixed = fixed.replace(/:\s*null\b/g, ': null');
    
    // Fix numeric values that might have issues
    fixed = fixed.replace(/:\s*(\d+)([,}])/g, ': $1$2');
    
    return fixed;
}

// Sistema de permisos por ruta
const ROUTE_PERMISSIONS = {
    '/Daniela Berdejo': {
        allowedSellers: [
            'María Calle',        // Nombre unificado
            'María Isabel Calle', // Nombre original en BD (se unifica a María Calle)
            'Geraldin Cardona'
        ]
    },
    '/Katherine López': {
        allowedSellers: [
            'Erick Ponce',
            'Camila Muñoz',       // Nombre unificado
            'María Camila Muñoz'  // Nombre original en BD (se unifica a Camila Muñoz)
        ]
    }
};

// Función para obtener permisos según la ruta
function getRoutePermissions(req) {
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers.referer || '';
    
    // Detectar ruta desde el referer o un header personalizado
    let routePath = req.headers['x-route-path'] || '';
    
    // Si no hay header, intentar extraer de referer
    if (!routePath && referer) {
        const urlParts = referer.split('/');
        if (urlParts.length > 3) {
            const possibleRoute = '/' + decodeURIComponent(urlParts.slice(3).join('/'));
            console.log('🔍 Extrayendo ruta de referer:', possibleRoute);
            
            // Normalizar nombres para coincidir con permisos
            if (possibleRoute.includes('Daniela') || possibleRoute.includes('Berdejo')) {
                routePath = '/Daniela Berdejo';
            } else if (possibleRoute.includes('Katherine') || possibleRoute.includes('López') || possibleRoute.includes('Lopez')) {
                routePath = '/Katherine López';
            }
        }
    }
    
    console.log('🔐 Ruta final detectada:', routePath);
    return ROUTE_PERMISSIONS[routePath] || null;
}

// Middleware de autenticación
function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ 
            error: 'No autorizado', 
            message: 'Debe iniciar sesión para acceder',
            redirectToLogin: true 
        });
    }
    
    console.log(`✅ Usuario autenticado: ${req.session.user.email}`);
    next();
}

// Middleware para verificar permisos de ruta específica
function requireRouteAccess(routeName) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ 
                error: 'No autorizado', 
                message: 'Debe iniciar sesión para acceder',
                redirectToLogin: true 
            });
        }

        const userRoute = getUserRoute(req.session.user.email);
        if (userRoute !== routeName) {
            return res.status(403).json({ 
                error: 'Acceso denegado', 
                message: 'No tiene permisos para acceder a esta sección' 
            });
        }

        next();
    };
}

// Función para determinar la ruta del usuario basada en su email
function getUserRoute(email) {
    const routeMapping = {
        'daniela.berdejo@ejemplo.com': '/Daniela Berdejo',
        'katherine.lopez@ejemplo.com': '/Katherine López'
        // Agregar más usuarios según sea necesario
    };
    
    return routeMapping[email] || null;
}

// Función para obtener URL de redirección del usuario
function getUserRedirectUrl(email) {
    const route = getUserRoute(email);
    if (!route) return '/';
    
    // Codificar la URL para manejar caracteres especiales
    return encodeURIComponent(route);
}

// Función para ejecutar queries en ambas BDs y combinar resultados
async function queryBothDatabases(query, params = []) {
    const results = [];
    
    // Query BD principal
    try {
        const connection = await pool.getConnection();
        const [mainResults] = await connection.execute(query, params);
        // Agregar origen a cada resultado
        const mainResultsWithOrigin = mainResults.map(row => ({
            ...row,
            origen_bd: 'Distrito Cafetero'
        }));
        results.push(...mainResultsWithOrigin);
        connection.release();
        console.log(`📊 BD Principal (Distrito Cafetero): ${mainResults.length} registros`);
    } catch (error) {
        console.error('❌ Error en BD Principal:', error);
        throw error;
    }
    
    // Query BD BigCenter si está configurada
    if (bigCenterPool) {
        try {
            const connection = await bigCenterPool.getConnection();
            const [bigCenterResults] = await connection.execute(query, params);
            // Agregar origen a cada resultado
            const bigCenterResultsWithOrigin = bigCenterResults.map(row => ({
                ...row,
                origen_bd: 'Big Center'
            }));
            results.push(...bigCenterResultsWithOrigin);
            connection.release();
            console.log(`📊 BD BigCenter: ${bigCenterResults.length} registros`);
        } catch (error) {
            console.error('❌ Error en BD BigCenter:', error);
            // No lanzar error, continuar con solo la BD principal
        }
    }
    
    console.log(`📊 Total combinado: ${results.length} registros`);
    return results;
}

// Mapa de unificación de vendedores (misma persona con nombres diferentes)
const SELLER_UNIFICATION = {
    'María Isabel Calle': 'María Calle',  // Unificar María Isabel Calle -> María Calle
    'María Camila Muñoz': 'Camila Muñoz'  // Por si aparece con nombre completo
};

// Función para unificar nombre de vendedor
function getUnifiedSellerName(sellerName) {
    return SELLER_UNIFICATION[sellerName] || sellerName;
}

// Función para filtrar vendedores según permisos
function filterSellersByPermissions(sellers, permissions) {
    if (!permissions || !permissions.allowedSellers) {
        return sellers;
    }
    
    return sellers.filter(seller => {
        const unifiedName = getUnifiedSellerName(seller.nombre);
        
        // Buscar coincidencia exacta con nombre unificado
        if (permissions.allowedSellers.includes(unifiedName) || 
            permissions.allowedSellers.includes(seller.nombre)) {
            return true;
        }
        
        // Buscar coincidencias parciales para casos especiales
        return permissions.allowedSellers.some(allowedName => {
            const sellerNameLower = seller.nombre.toLowerCase();
            const allowedNameLower = allowedName.toLowerCase();
            
            // Si contiene las palabras principales
            const sellerWords = sellerNameLower.split(' ');
            const allowedWords = allowedNameLower.split(' ');
            
            // Verificar si al menos 2 palabras coinciden
            const matchingWords = sellerWords.filter(word => 
                allowedWords.some(allowedWord => 
                    allowedWord.includes(word) || word.includes(allowedWord)
                )
            );
            
            return matchingWords.length >= 2;
        });
    });
}

// ============ RUTAS DE AUTENTICACIÓN ============

// Verificar estado de autenticación
app.get('/api/auth/check', (req, res) => {
    if (req.session && req.session.user) {
        const redirectUrl = getUserRedirectUrl(req.session.user.email);
        res.json({ 
            authenticated: true,
            user: {
                email: req.session.user.email,
                nombre: req.session.user.nombre
            },
            redirectUrl: redirectUrl
        });
    } else {
        res.status(401).json({ 
            authenticated: false,
            message: 'No hay sesión activa'
        });
    }
});

// Ruta de login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log(`🔐 Intento de login para: ${email}`);
        
        // Validaciones básicas
        if (!email || !password) {
            return res.status(400).json({
                error: 'Datos incompletos',
                message: 'Email y contraseña son requeridos'
            });
        }

        // Buscar usuario en la tabla admin
        const connection = await pool.getConnection();
        const [users] = await connection.execute(
            'SELECT * FROM admin WHERE email = ? LIMIT 1',
            [email]
        );
        connection.release();

        if (users.length === 0) {
            console.log(`❌ Usuario no encontrado: ${email}`);
            return res.status(401).json({
                error: 'Credenciales inválidas',
                message: 'Email o contraseña incorrectos',
                field: 'email'
            });
        }

        const user = users[0];
        
        // Verificar contraseña
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            console.log(`❌ Contraseña incorrecta para: ${email}`);
            return res.status(401).json({
                error: 'Credenciales inválidas',
                message: 'Email o contraseña incorrectos',
                field: 'password'
            });
        }

        // Verificar si el usuario tiene acceso a alguna ruta
        const userRoute = getUserRoute(email);
        if (!userRoute) {
            console.log(`❌ Usuario sin permisos de ruta: ${email}`);
            return res.status(403).json({
                error: 'Sin permisos',
                message: 'Su cuenta no tiene permisos para acceder al sistema'
            });
        }

        // Crear sesión
        req.session.user = {
            id: user.id,
            email: user.email,
            nombre: user.nombre,
            loginTime: new Date()
        };

        console.log(`✅ Login exitoso para: ${email} -> ${userRoute}`);

        // Responder con éxito
        res.json({
            success: true,
            message: 'Login exitoso',
            user: {
                email: user.email,
                nombre: user.nombre
            },
            redirectUrl: userRoute
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({
            error: 'Error interno',
            message: 'Error del servidor. Intente nuevamente.'
        });
    }
});

// Ruta de logout
app.post('/api/auth/logout', (req, res) => {
    if (req.session) {
        const userEmail = req.session.user?.email || 'Usuario desconocido';
        
        req.session.destroy((err) => {
            if (err) {
                console.error('❌ Error al cerrar sesión:', err);
                return res.status(500).json({
                    error: 'Error al cerrar sesión'
                });
            }
            
            console.log(`🔓 Sesión cerrada para: ${userEmail}`);
            res.clearCookie('connect.sid'); // Limpiar cookie de sesión
            res.json({
                success: true,
                message: 'Sesión cerrada exitosamente'
            });
        });
    } else {
        res.json({
            success: true,
            message: 'No había sesión activa'
        });
    }
});

// ============ RUTAS PROTEGIDAS ============

// Get dashboard data
app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        console.log('🔍 Iniciando consulta /api/dashboard...');
        
        // Obtener permisos según la ruta
        const routePermissions = getRoutePermissions(req);
        console.log('🔐 Permisos de ruta:', routePermissions);
        
        // Get all evaluations from both databases
        console.log('📊 Ejecutando consulta de evaluaciones en ambas BDs...');
        const allEvals = await queryBothDatabases(`
            SELECT e.*, s.nombre as seller_name
            FROM evaluations e
            JOIN sellers s ON e.sellers_id = s.id
            WHERE e.calificacion IS NOT NULL AND e.calificacion != ''
        `);
        
        console.log(`📈 Total evaluaciones con calificacion: ${allEvals.length}`);
        
        // Filtrar evaluaciones por permisos de vendedor si es necesario
        let filteredEvals = allEvals;
        if (routePermissions) {
            filteredEvals = allEvals.filter(eval => 
                routePermissions.allowedSellers.includes(eval.seller_name)
            );
            console.log(`🔐 Evaluaciones filtradas por permisos: ${filteredEvals.length}`);
        }
        
        // Filter manually for evaluations with valid final_score
        const evaluations = [];
        filteredEvals.forEach((eval, index) => {
            try {
                // Simple check - look for final_score in the string that's not null
                const calStr = eval.calificacion;
                if (calStr.includes('"final_score": null') || calStr.includes('"final_score":null')) {
                    console.log(`   ⚠️ ${eval.lead_id}: final_score is null`);
                    return; // Skip this one
                }
                
                // Look for a numeric final_score
                const scoreMatch = calStr.match(/"final_score":\s*(\d+)/);
                if (scoreMatch) {
                    const score = parseInt(scoreMatch[1]);
                    console.log(`   ✅ ${eval.lead_id}: final_score = ${score}`);
                    evaluations.push(eval);
                } else {
                    console.log(`   ❌ ${eval.lead_id}: no valid final_score found`);
                }
            } catch (error) {
                console.log(`   ❌ ${eval.lead_id}: Error processing - ${error.message}`);
            }
        });
        
        console.log(`📈 Evaluaciones válidas encontradas: ${evaluations.length}`);
        console.log(`📈 Evaluaciones con final_score válido: ${evaluations.length}`);
        
        // Calculate global stats
        let totalLeads = 0;
        let totalResponseTime = 0;
        let totalScore = 0;
        let validTimeCount = 0;
        
        const sellerStats = {};
        
        console.log(`🔍 Procesando ${evaluations.length} evaluaciones...`);
        
        evaluations.forEach((eval, index) => {
            try {
                const calStr = eval.calificacion;
                
                const scoreMatch = calStr.match(/"final_score":\s*(\d+)/);
                const final_score = scoreMatch ? parseInt(scoreMatch[1]) : null;
                
                const timeMatch = calStr.match(/"tiempo_promedio":\s*"(\d{1,2}:\d{1,2}:\d{1,2})"/);
                const tiempo_promedio = timeMatch ? timeMatch[1] : null;
                
                console.log(`📊 Evaluación ${index + 1}:`, {
                    lead_id: eval.lead_id,
                    final_score: final_score,
                    tiempo_promedio: tiempo_promedio
                });
                
                if (final_score !== null && !isNaN(final_score)) {
                    totalLeads++;
                    totalScore += final_score;
                    
                    // Process response time
                    if (tiempo_promedio && tiempo_promedio !== '00:00:00') {
                        const seconds = timeToSeconds(tiempo_promedio);
                        if (seconds > 0) {
                            totalResponseTime += seconds;
                            validTimeCount++;
                        }
                    }
                } else {
                    console.log(`Evaluación ${index + 1} ignorada: final_score inválido`);
                }
                
                // Aggregate by seller (solo si tiene final_score válido)
                if (final_score !== null && !isNaN(final_score)) {
                    // Usar nombre unificado para agrupar estadísticas
                    const unifiedName = getUnifiedSellerName(eval.seller_name);
                    const statsKey = unifiedName; // Usar nombre unificado como clave
                    
                    if (!sellerStats[statsKey]) {
                        sellerStats[statsKey] = {
                            id: eval.sellers_id, // Usar el ID del primer registro encontrado
                            nombre: unifiedName,  // Usar nombre unificado
                            totalScore: 0,
                            count: 0,
                            totalTime: 0,
                            timeCount: 0
                        };
                    }
                    
                    sellerStats[statsKey].totalScore += final_score;
                    sellerStats[statsKey].count++;
                    
                    if (tiempo_promedio && tiempo_promedio !== '00:00:00') {
                        const seconds = timeToSeconds(tiempo_promedio);
                        if (seconds > 0) {
                            sellerStats[statsKey].totalTime += seconds;
                            sellerStats[statsKey].timeCount++;
                        }
                    }
                }
            } catch (error) {
                console.error(`❌ Error parsing calificacion para evaluación ${index + 1}:`, error);
            }
        });
        
        console.log(`📈 Estadísticas calculadas:`);
        console.log(`   Total Leads: ${totalLeads}`);
        console.log(`   Total Score: ${totalScore}`);
        console.log(`   Promedio Score: ${totalLeads > 0 ? totalScore / totalLeads : 0}`);
        console.log(`   Total Response Time: ${totalResponseTime} segundos`);
        console.log(`   Valid Time Count: ${validTimeCount}`);
        console.log(`   Promedio Response Time: ${validTimeCount > 0 ? totalResponseTime / validTimeCount : 0} segundos`);
        
        // Calculate top sellers
        const topSellers = Object.values(sellerStats)
            .map(seller => ({
                ...seller,
                avgScore: seller.count > 0 ? seller.totalScore / seller.count : 0,
                avgTime: seller.timeCount > 0 ? seller.totalTime / seller.timeCount : 0
            }))
            .sort((a, b) => b.avgScore - a.avgScore);
        
        // Get all sellers for filter from both databases
        console.log('👥 Ejecutando consulta de vendedores en ambas BDs...');
        const allSellers = await queryBothDatabases('SELECT id, nombre FROM sellers ORDER BY nombre');
        
        // Debug: mostrar todos los vendedores encontrados
        console.log('📋 Vendedores en BD:');
        allSellers.forEach((seller, index) => {
            console.log(`   ${index + 1}. ID: ${seller.id}, Nombre: "${seller.nombre}"`);
        });
        
        // Filtrar vendedores por permisos si es necesario
        const filteredSellers = filterSellersByPermissions(allSellers, routePermissions);
        
        // Unificar vendedores (eliminar duplicados de nombres unificados)
        const unifiedSellersMap = new Map();
        filteredSellers.forEach(seller => {
            const unifiedName = getUnifiedSellerName(seller.nombre);
            if (!unifiedSellersMap.has(unifiedName)) {
                unifiedSellersMap.set(unifiedName, {
                    id: seller.id,
                    nombre: unifiedName
                });
            }
        });
        
        const sellers = Array.from(unifiedSellersMap.values());
        
        if (routePermissions) {
            console.log(`🔐 Vendedores permitidos para esta ruta:`, routePermissions.allowedSellers);
            console.log(`👤 Vendedores filtrados: ${filteredSellers.length}`);
            filteredSellers.forEach((seller, index) => {
                console.log(`   ${index + 1}. ID: ${seller.id}, Nombre: "${seller.nombre}"`);
            });
            console.log(`👤 Vendedores unificados: ${sellers.length}`);
            sellers.forEach((seller, index) => {
                console.log(`   ${index + 1}. ID: ${seller.id}, Nombre: "${seller.nombre}" (UNIFICADO)`);
            });
        } else {
            console.log(`👤 Vendedores encontrados (sin filtros): ${sellers.length}`);
        }
        
        // Get all leads for filter (only those with valid scores)
        console.log('📋 Ejecutando consulta de leads...');
        const leadsList = evaluations.map(eval => ({
            lead_id: eval.lead_id,
            seller_name: eval.seller_name,
            sellers_id: eval.sellers_id,
            fecha: eval.fecha,
            origen_bd: eval.origen_bd
        })).sort((a, b) => b.fecha.localeCompare(a.fecha)); // Sort by date, newest first
        
        console.log(`📋 Leads encontrados: ${leadsList.length}`);
        
        res.json({
            stats: {
                totalLeads,
                avgResponseTime: validTimeCount > 0 ? totalResponseTime / validTimeCount : 0,
                avgScore: totalLeads > 0 ? totalScore / totalLeads : 0
            },
            topSellers,
            sellers,
            leads: leadsList
        });
    } catch (error) {
        console.error('Error in /api/dashboard:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get seller details
app.get('/api/seller/:id', requireAuth, async (req, res) => {
    try {
        const sellerId = validatePositiveInteger(req.params.id, 'Seller ID');
        
        // Obtener permisos según la ruta
        const routePermissions = getRoutePermissions(req);
        
        const allEvals = await queryBothDatabases(`
            SELECT e.*, s.nombre as seller_name
            FROM evaluations e
            JOIN sellers s ON e.sellers_id = s.id
            WHERE e.sellers_id = ? AND e.calificacion IS NOT NULL AND e.calificacion != ''
        `, [sellerId]);
        
        // Verificar permisos si están configurados
        if (routePermissions && allEvals.length > 0) {
            const sellerName = allEvals[0].seller_name;
            const unifiedSellerName = getUnifiedSellerName(sellerName);
            
            console.log(`🔐 Verificando permisos para vendedor:`);
            console.log(`   Nombre original: "${sellerName}"`);
            console.log(`   Nombre unificado: "${unifiedSellerName}"`);
            console.log(`   Vendedores permitidos:`, routePermissions.allowedSellers);
            
            // Verificar tanto nombre original como unificado
            const isAllowed = routePermissions.allowedSellers.includes(sellerName) || 
                            routePermissions.allowedSellers.includes(unifiedSellerName);
            
            if (!isAllowed) {
                console.log(`❌ Acceso denegado para "${sellerName}"`);
                return res.status(403).json({ 
                    error: 'Acceso denegado', 
                    message: 'No tienes permisos para ver este vendedor' 
                });
            } else {
                console.log(`✅ Acceso permitido para "${sellerName}"`);
            }
        }
        
        // Filter manually for evaluations with valid final_score
        const evaluations = allEvals.filter(eval => {
            const calStr = eval.calificacion;
            if (calStr.includes('"final_score": null') || calStr.includes('"final_score":null')) {
                return false;
            }
            const scoreMatch = calStr.match(/"final_score":\s*(\d+)/);
            return scoreMatch !== null;
        });
        
        let totalLeads = 0;
        let totalResponseTime = 0;
        let totalScore = 0;
        let validTimeCount = 0;
        
        evaluations.forEach(eval => {
            try {
                // Extract data using regex to avoid JSON parsing issues
                const calStr = eval.calificacion;
                
                // Extract final_score
                const scoreMatch = calStr.match(/"final_score":\s*(\d+)/);
                const final_score = scoreMatch ? parseInt(scoreMatch[1]) : null;
                
                const timeMatch = calStr.match(/"tiempo_promedio":\s*"(\d{1,2}:\d{1,2}:\d{1,2})"/);
                const tiempo_promedio = timeMatch ? timeMatch[1] : null;
                
                if (final_score !== null && !isNaN(final_score)) {
                    totalLeads++;
                    totalScore += final_score;
                    
                    if (tiempo_promedio && tiempo_promedio !== '00:00:00') {
                        const seconds = timeToSeconds(tiempo_promedio);
                        if (seconds > 0) {
                            totalResponseTime += seconds;
                            validTimeCount++;
                        }
                    }
                }
            } catch (error) {
                console.error('Error parsing calificacion:', error);
            }
        });
        
        res.json({
            stats: {
                totalLeads,
                avgResponseTime: validTimeCount > 0 ? totalResponseTime / validTimeCount : 0,
                avgScore: totalLeads > 0 ? totalScore / totalLeads : 0
            },
            evaluations
        });
    } catch (error) {
        if (error.message.includes('debe ser un número entero positivo') || 
            error.message.includes('caracteres no válidos')) {
            return handleValidationError(error, res, '/api/seller/:id');
        }
        
        console.error('Error in /api/seller/:id:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get evaluation details
app.get('/api/evaluation/:leadId', requireAuth, async (req, res) => {
    try {
        const leadId = validateLeadId(req.params.leadId);
        
        // Obtener permisos según la ruta
        const routePermissions = getRoutePermissions(req);
        
        const results = await queryBothDatabases(`
            SELECT e.*, s.nombre as seller_name
            FROM evaluations e
            JOIN sellers s ON e.sellers_id = s.id
            WHERE e.lead_id = ?
            LIMIT 1
        `, [leadId]);
        
        if (results.length === 0) {
            return res.status(404).json({ error: 'Evaluation not found' });
        }
        
        const evaluation = results[0];
        
        // Verificar permisos si están configurados
        if (routePermissions) {
            const sellerName = evaluation.seller_name;
            const unifiedSellerName = getUnifiedSellerName(sellerName);
            
            console.log(`🔐 Verificando permisos para evaluación:`);
            console.log(`   Lead: ${evaluation.lead_id}`);
            console.log(`   Vendedor original: "${sellerName}"`);
            console.log(`   Vendedor unificado: "${unifiedSellerName}"`);
            console.log(`   Vendedores permitidos:`, routePermissions.allowedSellers);
            
            // Verificar tanto nombre original como unificado
            const isAllowed = routePermissions.allowedSellers.includes(sellerName) || 
                            routePermissions.allowedSellers.includes(unifiedSellerName);
            
            if (!isAllowed) {
                console.log(`❌ Acceso denegado para lead ${evaluation.lead_id} del vendedor "${sellerName}"`);
                return res.status(403).json({ 
                    error: 'Acceso denegado', 
                    message: 'No tienes permisos para ver este lead' 
                });
            } else {
                console.log(`✅ Acceso permitido para lead ${evaluation.lead_id} del vendedor "${sellerName}"`);
            }
        }
        try {
            const fixedJson = fixJsonString(evaluation.calificacion);
            evaluation.calificacion = JSON.parse(fixedJson);
        } catch (error) {
            console.error('Error parsing calificacion:', error);
            return res.status(500).json({ error: 'Invalid calificacion format' });
        }
        
        res.json(evaluation);
    } catch (error) {
        if (error.message.includes('Lead ID') || 
            error.message.includes('caracteres no válidos') ||
            error.message.includes('es requerido')) {
            return handleValidationError(error, res, '/api/evaluation/:leadId');
        }
        
        console.error('Error in /api/evaluation/:leadId:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Ruta de debug para verificar configuración
app.get('/api/debug', requireAuth, async (req, res) => {
    try {
        console.log('🔍 DEBUG: Verificando configuración...');
        
        const routePermissions = getRoutePermissions(req);
        console.log('🔐 Permisos detectados:', routePermissions);
        
        // Obtener vendedores de ambas BDs
        const allSellers = await queryBothDatabases('SELECT id, nombre FROM sellers ORDER BY nombre');
        const filteredSellers = filterSellersByPermissions(allSellers, routePermissions);
        
        // Obtener evaluaciones
        const allEvals = await queryBothDatabases(`
            SELECT e.lead_id, s.nombre as seller_name, e.fecha
            FROM evaluations e
            JOIN sellers s ON e.sellers_id = s.id
            WHERE e.calificacion IS NOT NULL AND e.calificacion != ''
            ORDER BY e.fecha DESC
            LIMIT 10
        `);
        
        res.json({
            route: req.headers['x-route-path'] || 'No route header',
            permissions: routePermissions,
            allSellers: allSellers,
            filteredSellers: filteredSellers,
            sampleEvaluations: allEvals,
            bigCenterEnabled: !!bigCenterPool
        });
    } catch (error) {
        console.error('Error in debug route:', error);
        res.status(500).json({ error: error.message });
    }
});

// Middleware para verificar autenticación en rutas protegidas
function requireAuthPage(req, res, next) {
    if (!req.session || !req.session.user) {
        console.log(`🔒 Acceso no autorizado a: ${req.path} - Redirigiendo a login`);
        return res.redirect('/login.html');
    }
    next();
}

// Middleware para verificar permisos específicos de ruta
function requireSpecificRoute(routeName) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.redirect('/login.html');
        }

        const userRoute = getUserRoute(req.session.user.email);
        if (userRoute !== routeName) {
            console.log(`🚫 Usuario ${req.session.user.email} intentó acceder a ${routeName} pero solo tiene acceso a ${userRoute}`);
            return res.status(403).send(`
                <html>
                    <head><title>Acceso Denegado</title></head>
                    <body style="font-family: Arial; text-align: center; margin-top: 100px;">
                        <h1>🚫 Acceso Denegado</h1>
                        <p>No tiene permisos para acceder a esta sección.</p>
                        <a href="javascript:history.back()">← Volver</a>
                    </body>
                </html>
            `);
        }
        next();
    };
}

// Rutas específicas para diferentes usuarios - PROTEGIDAS
app.get('/Daniela%20Berdejo', requireAuthPage, requireSpecificRoute('/Daniela Berdejo'), (req, res) => {
    console.log(`✅ Acceso autorizado a Daniela Berdejo para: ${req.session.user.email}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/Daniela Berdejo', requireAuthPage, requireSpecificRoute('/Daniela Berdejo'), (req, res) => {
    console.log(`✅ Acceso autorizado a Daniela Berdejo para: ${req.session.user.email}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Katherine López - múltiples variantes de codificación - PROTEGIDAS
app.get('/Katherine%20López', requireAuthPage, requireSpecificRoute('/Katherine López'), (req, res) => {
    console.log(`✅ Acceso autorizado a Katherine López para: ${req.session.user.email}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/Katherine%20L%C3%B3pez', requireAuthPage, requireSpecificRoute('/Katherine López'), (req, res) => {
    console.log(`✅ Acceso autorizado a Katherine López para: ${req.session.user.email}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/Katherine López', requireAuthPage, requireSpecificRoute('/Katherine López'), (req, res) => {
    console.log(`✅ Acceso autorizado a Katherine López para: ${req.session.user.email}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rutas genéricas para capturar cualquier variante - PROTEGIDAS
app.get(/^\/Katherine.*L.*pez$/i, requireAuthPage, requireSpecificRoute('/Katherine López'), (req, res) => {
    console.log(`✅ Ruta genérica Katherine López capturada: ${req.path} para: ${req.session.user.email}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get(/^\/Daniela.*Berdejo$/i, requireAuthPage, requireSpecificRoute('/Daniela Berdejo'), (req, res) => {
    console.log(`✅ Ruta genérica Daniela Berdejo capturada: ${req.path} para: ${req.session.user.email}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta raíz - redirigir según usuario autenticado
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        const userRoute = getUserRoute(req.session.user.email);
        if (userRoute) {
            console.log(`🔄 Redirigiendo usuario ${req.session.user.email} a su ruta: ${userRoute}`);
            return res.redirect(userRoute);
        }
    }
    
    console.log('🔒 Usuario no autenticado, redirigiendo a login');
    res.redirect('/login.html');
});

// Start server
app.listen(PORT, () => {
    const environment = process.env.NODE_ENV || 'development';
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🌍 Entorno: ${environment}`);
    
    if (environment === 'production') {
        const frontendUrl = process.env.FRONTEND_URL;
        const railwayUrl = process.env.RAILWAY_STATIC_URL;
        
        console.log(`🛡️ CORS configurado para producción:`);
        if (frontendUrl) console.log(`   ✅ Frontend URL: ${frontendUrl}`);
        if (railwayUrl) console.log(`   ✅ Railway URL: ${railwayUrl}`);
        if (!frontendUrl && !railwayUrl) {
            console.log(`   ⚠️ Sin URLs específicas - usando patrón *.railway.app`);
        }
    } else {
        console.log(`🛡️ CORS configurado para desarrollo:`);
        console.log(`   ✅ http://localhost:3005`);
        console.log(`   ✅ http://127.0.0.1:3005`);
        console.log(`   ✅ http://localhost:3000`);
        console.log(`🔗 Accede en: http://localhost:${PORT}`);
    }
    
    console.log(`🌐 RESTRICCIÓN DE RED ACTIVADA:`);
    console.log(`   ✅ Red permitida: 192.168.0.0/24 (IPs: 192.168.0.1 - 192.168.0.254)`);
    console.log(`   ✅ Localhost: 127.0.0.1 (para desarrollo)`);
    console.log(`   ❌ Cualquier otra IP será bloqueada`);
    console.log(`   💡 Solo el equipo conectado a tu WiFi puede acceder`);
});