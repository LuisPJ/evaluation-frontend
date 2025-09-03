// server.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

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

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

app.use('/api', networkRestrictionMiddleware);

const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('ERROR: Variables de entorno faltantes:', missingVars.join(', '));
    console.error('Configura estas variables en Railway Dashboard o en tu archivo .env');
    process.exit(1);
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

// Debug: Mostrar configuración de BD (sin password)
console.log('🔗 Configuración de Base de Datos:');
console.log(`   Host: ${dbConfig.host}`);
console.log(`   Usuario: ${dbConfig.user}`);
console.log(`   Base de Datos: ${dbConfig.database}`);
console.log(`   Password: ${dbConfig.password ? '[CONFIGURADO]' : '[NO CONFIGURADO]'}`);

const pool = mysql.createPool(dbConfig);

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

// Get dashboard data
app.get('/api/dashboard', async (req, res) => {
    try {
        console.log('🔍 Iniciando consulta /api/dashboard...');
        const connection = await pool.getConnection();
        console.log('✅ Conexión a BD establecida');
        
        // Get all evaluations 
        console.log('📊 Ejecutando consulta de evaluaciones (todas)...');
        const [allEvaluations] = await connection.execute(`
            SELECT e.*, s.nombre as seller_name
            FROM evaluations e
            JOIN sellers s ON e.sellers_id = s.id
        `);
        console.log(`📈 Total evaluaciones en BD: ${allEvaluations.length}`);
        
        // Show sample data (only first 3)
        if (allEvaluations.length > 0) {
            console.log('📋 Muestra de primeras 3 evaluaciones:');
            allEvaluations.slice(0, 3).forEach((eval, index) => {
                console.log(`   Evaluación ${index + 1}:`, {
                    lead_id: eval.lead_id,
                    sellers_id: eval.sellers_id,
                    seller_name: eval.seller_name,
                    calificacion_preview: eval.calificacion ? eval.calificacion.substring(0, 80) + '...' : 'NULL'
                });
            });
        }
        
        // Let's get all evaluations and filter manually (simple approach)
        console.log('📊 Obteniendo todas las evaluaciones para filtrar manualmente...');
        const [allEvals] = await connection.execute(`
            SELECT e.*, s.nombre as seller_name
            FROM evaluations e
            JOIN sellers s ON e.sellers_id = s.id
            WHERE e.calificacion IS NOT NULL AND e.calificacion != ''
        `);
        
        console.log(`📈 Total evaluaciones con calificacion: ${allEvals.length}`);
        
        // Filter manually for evaluations with valid final_score
        const evaluations = [];
        allEvals.forEach((eval, index) => {
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
                    if (!sellerStats[eval.sellers_id]) {
                        sellerStats[eval.sellers_id] = {
                            id: eval.sellers_id,
                            nombre: eval.seller_name,
                            totalScore: 0,
                            count: 0,
                            totalTime: 0,
                            timeCount: 0
                        };
                    }
                    
                    sellerStats[eval.sellers_id].totalScore += final_score;
                    sellerStats[eval.sellers_id].count++;
                    
                    if (tiempo_promedio && tiempo_promedio !== '00:00:00') {
                        const seconds = timeToSeconds(tiempo_promedio);
                        if (seconds > 0) {
                            sellerStats[eval.sellers_id].totalTime += seconds;
                            sellerStats[eval.sellers_id].timeCount++;
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
        
        // Get all sellers for filter
        console.log('👥 Ejecutando consulta de vendedores...');
        const [sellers] = await connection.execute('SELECT id, nombre FROM sellers ORDER BY nombre');
        console.log(`👤 Vendedores encontrados: ${sellers.length}`);
        
        // Get all leads for filter (only those with valid scores)
        console.log('📋 Ejecutando consulta de leads...');
        const leadsList = evaluations.map(eval => ({
            lead_id: eval.lead_id,
            seller_name: eval.seller_name,
            sellers_id: eval.sellers_id,
            fecha: eval.fecha
        })).sort((a, b) => b.fecha.localeCompare(a.fecha)); // Sort by date, newest first
        
        console.log(`📋 Leads encontrados: ${leadsList.length}`);
        
        connection.release();
        
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
app.get('/api/seller/:id', async (req, res) => {
    try {
        const sellerId = validatePositiveInteger(req.params.id, 'Seller ID');
        const connection = await pool.getConnection();
        
        const [allEvals] = await connection.execute(`
            SELECT e.*, s.nombre as seller_name
            FROM evaluations e
            JOIN sellers s ON e.sellers_id = s.id
            WHERE e.sellers_id = ? AND e.calificacion IS NOT NULL AND e.calificacion != ''
        `, [sellerId]);
        
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
        
        connection.release();
        
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
app.get('/api/evaluation/:leadId', async (req, res) => {
    try {
        const leadId = validateLeadId(req.params.leadId);
        const connection = await pool.getConnection();
        
        const [results] = await connection.execute(`
            SELECT e.*, s.nombre as seller_name
            FROM evaluations e
            JOIN sellers s ON e.sellers_id = s.id
            WHERE e.lead_id = ?
            LIMIT 1
        `, [leadId]);
        
        connection.release();
        
        if (results.length === 0) {
            return res.status(404).json({ error: 'Evaluation not found' });
        }
        
        const evaluation = results[0];
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