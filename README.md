# 📊 Visualizador de Calificaciones

Sistema web profesional para el monitoreo y análisis del desempeño comercial de vendedores, con dashboard interactivo y evaluaciones detalladas.

## 🎯 Características Principales

- **Dashboard Interactivo**: Visualización en tiempo real de métricas clave
- **Ranking de Vendedores**: Top performers con sistema de clasificación
- **Análisis Detallado**: Desglose completo de evaluaciones por lead
- **Filtros Dinámicos**: Filtrado por vendedor o lead específico
- **Interfaz Moderna**: Diseño responsivo con UX/UI profesional
- **API RESTful**: Backend robusto con endpoints optimizados

## 🚀 Tecnologías Utilizadas

### Backend
- **Node.js** - Entorno de ejecución
- **Express.js** - Framework web
- **MySQL2** - Base de datos y conexión
- **CORS** - Manejo de políticas de origen cruzado
- **dotenv** - Gestión de variables de entorno

### Frontend
- **HTML5** - Estructura semántica
- **CSS3** - Estilos modernos con variables CSS
- **JavaScript ES6+** - Funcionalidad interactiva
- **Fetch API** - Comunicación con backend

### Desarrollo
- **Nodemon** - Recarga automática en desarrollo

## 📋 Requisitos Previos

- **Node.js** >= 14.0.0
- **MySQL** >= 8.0
- **npm** >= 6.0.0

## ⚙️ Instalación

### 1. Clonar el Repositorio
```bash
git clone <url-del-repositorio>
cd Visualizador-de-calificaciones
```

### 2. Instalar Dependencias
```bash
npm install
```

### 3. Configurar Base de Datos

#### Crear archivo `.env`
```env
# Configuración de Base de Datos
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=tu_password
DB_NAME=seller_evaluation

# Configuración del Servidor
PORT=3005
```

#### Estructura de Base de Datos Requerida

```sql
-- Tabla de vendedores
CREATE TABLE sellers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL
);

-- Tabla de evaluaciones
CREATE TABLE evaluations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lead_id VARCHAR(100) NOT NULL,
    sellers_id INT NOT NULL,
    fecha DATE NOT NULL,
    calificacion JSON,
    FOREIGN KEY (sellers_id) REFERENCES sellers(id)
);
```

## 🏃‍♂️ Ejecución

### Modo Desarrollo
```bash
npm run dev
# o
nodemon server.js
```

### Modo Producción
```bash
node server.js
```

El servidor estará disponible en: `http://localhost:3005`

## 📡 API Endpoints

### Dashboard Principal
```http
GET /api/dashboard
```
**Respuesta:**
```json
{
  "stats": {
    "totalLeads": 150,
    "avgResponseTime": 1847,
    "avgScore": 75.5
  },
  "topSellers": [...],
  "sellers": [...],
  "leads": [...]
}
```

### Detalles de Vendedor
```http
GET /api/seller/:id
```

### Evaluación Específica
```http
GET /api/evaluation/:leadId
```

## 📊 Formato de Datos de Evaluación

El sistema procesa evaluaciones con el siguiente formato JSON:

```json
{
  "final_score": 85,
  "tiempo_promedio": "02:15:30",
  "label": "EXCELENTE",
  "breakdown": {
    "criterio_1": {
      "score": 8,
      "max": 10,
      "notes": "Observaciones del criterio"
    }
  },
  "justification": "Justificación detallada de la calificación"
}
```

## 🎨 Características de la Interfaz

### Dashboard
- **Métricas Globales**: Total leads, tiempo promedio, calificación promedio
- **Ranking Visual**: Top vendedores con medallas y clasificaciones
- **Filtros Inteligentes**: Selección automática y filtrado dinámico

### Sistema de Clasificación
- 🥇 **EXCELENTE** (≥80): Oro
- 🥈 **BUENO** (60-79): Plata  
- 🥉 **REGULAR** (<60): Bronce

### Responsive Design
- Adaptable a dispositivos móviles
- Interfaz optimizada para tablets
- Experiencia consistente en desktop

## 🔧 Estructura del Proyecto

```
Visualizador-de-calificaciones/
├── server.js              # Servidor principal y API
├── package.json           # Dependencias y scripts
├── .env                   # Variables de entorno (crear)
├── .gitignore            # Archivos ignorados por Git
├── public/
│   └── index.html        # Frontend completo
└── README.md             # Documentación
```

## 🛠️ Funcionalidades Técnicas

### Patrón MVC Implementado
- **Modelo**: Gestión de datos y lógica de negocio en server.js
- **Vista**: Interfaz de usuario en public/index.html
- **Controlador**: Coordinación entre modelo y vista

### Características Avanzadas
- **Pool de Conexiones**: Gestión eficiente de conexiones MySQL
- **Manejo de Errores**: Sistema robusto de captura de errores
- **Validación de Datos**: Filtrado y validación de evaluaciones
- **Parsing Inteligente**: Procesamiento de JSON con regex para mayor robustez
- **Logs Detallados**: Sistema de logging para debugging

## 🚨 Solución de Problemas

### Error de Conexión a BD
```bash
# Verificar configuración en .env
# Asegurar que MySQL esté ejecutándose
# Validar credenciales de acceso
```

### Datos No Aparecen
```bash
# Verificar estructura de tablas
# Confirmar datos de ejemplo en BD
# Revisar logs del servidor en consola
```

### Puerto en Uso
```bash
# Cambiar PORT en .env o
# Terminar proceso existente
lsof -ti:3005 | xargs kill -9  # Mac/Linux
netstat -ano | findstr :3005   # Windows
```

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

## 👨‍💻 Autor

Desarrollado siguiendo principios de **Clean Code** y arquitectura **MVC**.

---

### 🔍 Estado del Proyecto: ✅ **Funcional y Listo para Producción**

*Sistema completo de visualización de calificaciones con dashboard interactivo y análisis detallado de rendimiento comercial.*
