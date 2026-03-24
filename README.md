# PadelSys — Backend API

Sistema integral de gestión para canchas de pádel. Construido con **NestJS**, **TypeORM** y **PostgreSQL**. Provee autenticación JWT, control de reservas con anti-overbooking, punto de venta, caja registradora y reportes financieros.

---

## Tabla de contenidos

1. [Tecnologías](#tecnologías)
2. [Arquitectura general](#arquitectura-general)
3. [Estructura de carpetas](#estructura-de-carpetas)
4. [Variables de entorno](#variables-de-entorno)
5. [Levantar el proyecto](#levantar-el-proyecto)
6. [Módulos y endpoints](#módulos-y-endpoints)
   - [Auth](#auth)
   - [Users](#users)
   - [Courts](#courts)
   - [Bookings](#bookings)
   - [Products](#products)
   - [POS (Ventas)](#pos-ventas)
   - [Cash Register (Caja)](#cash-register-caja)
   - [Reports](#reports)
   - [System Config](#system-config)
7. [Modelo de datos](#modelo-de-datos)
8. [Seguridad y autenticación](#seguridad-y-autenticación)
9. [Patrones arquitectónicos clave](#patrones-arquitectónicos-clave)
10. [Documentación Swagger](#documentación-swagger)

---

## Tecnologías

| Categoría | Tecnología |
|-----------|------------|
| Framework | NestJS v10 |
| Lenguaje | TypeScript v5 |
| Base de datos | PostgreSQL 15 |
| ORM | TypeORM v0.3 |
| Auth | JWT (HS256) + Passport |
| Hashing | bcrypt (10 rounds) |
| Validación | class-validator + Joi |
| Documentación | Swagger / OpenAPI |
| Rate limiting | @nestjs/throttler |
| Proceso prod | PM2 |

---

## Arquitectura general

```
┌────────────────────────────────────────────────────────────┐
│                        Cliente (Frontend)                  │
└──────────────────────────┬─────────────────────────────────┘
                           │ HTTP  (Bearer JWT)
┌──────────────────────────▼─────────────────────────────────┐
│                    NestJS API  /api/v1                     │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  JwtAuthGuard│  │  RolesGuard  │  │  ThrottlerGuard  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐    │
│  │   Auth   │ │  Users   │ │  Courts  │ │  Bookings   │    │
│  ├──────────┤ ├──────────┤ ├──────────┤ ├─────────────┤    │
│  │ Products │ │   POS    │ │  Cash    │ │   Reports   │    │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘    │
│                                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │                SystemConfig Module                 │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────────────┬─────────────────────────────────┘
                           │ TypeORM
┌──────────────────────────▼─────────────────────────────────┐
│                     PostgreSQL 15                          │
└────────────────────────────────────────────────────────────┘
```

### Roles del sistema

| Rol | Descripción |
|-----|-------------|
| `ADMIN` | Acceso total: usuarios, productos, reportes, cancelaciones |
| `EMPLOYEE` | Acceso operativo: reservas, ventas, consultas |

---

## Estructura de carpetas

```
src/
├── main.ts                        # Bootstrap, CORS, prefijo global, Swagger
├── app.module.ts                  # Módulo raíz: throttler, config, TypeORM
├── config/
│   ├── database.config.ts         # Configuración TypeORM
│   └── env.validation.ts          # Esquema Joi de variables de entorno
├── common/
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── roles.decorator.ts
│   ├── filters/
│   │   └── http-exception.filter.ts   # Respuestas de error uniformes
│   └── guards/
│       ├── jwt-auth.guard.ts
│       └── roles.guard.ts
├── database/
│   ├── data-source.ts             # DataSource para migraciones CLI
│   ├── migrations/
│   │   ├── 1000000000001-AddIdempotencyKeyToSales.ts
│   │   ├── 1000000000002-AddSessionVersionToUsers.ts
│   │   └── 1000000000003-DropUniqueDateCashSessions.ts
│   └── seed.ts                    # Seed inicial (admin + config)
└── modules/
    ├── auth/
    ├── users/
    ├── courts/
    ├── bookings/
    ├── products/
    ├── pos/
    ├── cash-register/
    ├── reports/
    └── system-config/
```

---

## Variables de entorno

Copiar `.env.example` como `.env` y completar:

```env
NODE_ENV=development

# Servidor
PORT=3000
CORS_ORIGIN=http://localhost:4200

# Base de datos
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=padelsys

# JWT
JWT_SECRET=<mínimo 32 caracteres>
JWT_EXPIRES_IN=8h
JWT_REFRESH_SECRET=<mínimo 32 caracteres, diferente al anterior>
JWT_REFRESH_EXPIRES_IN=7d
```

---

## Levantar el proyecto

### Desarrollo

Requisito previo: tener **PostgreSQL instalado localmente** y una base de datos creada (por ejemplo `padelsys`).

```bash
# 1. Instalar dependencias
npm install

# 2. Ejecutar seed inicial (crea usuario admin)
npm run seed

# 3. Iniciar en modo watch
npm run start:dev
```

### Producción

```bash
npm run build
pm2 start ecosystem.config.js
```

### URLs útiles

| Servicio | URL |
|----------|-----|
| API | `http://localhost:3000/api/v1` |
| Swagger | `http://localhost:3000/api/docs` |

---

## Módulos y endpoints

> **Base URL:** `/api/v1`
> Todos los endpoints (excepto login y refresh) requieren `Authorization: Bearer <token>`.

---

### Auth

Gestión de sesión y tokens JWT.

| Método | Endpoint | Acceso | Descripción |
|--------|----------|--------|-------------|
| POST | `/auth/login` | Público | Login con username/password |
| POST | `/auth/refresh` | Público | Renovar par de tokens |
| GET | `/auth/me` | Autenticado | Perfil del usuario actual |
| PATCH | `/auth/me/password` | Autenticado | Cambiar contraseña propia |

**Rate limits:** login → 5 req/min · refresh → 20 req/min

**Flujo de autenticación:**

```
Login → access_token (8h) + refresh_token (7d)
         ↓ expira
Refresh → nuevo access_token + nuevo refresh_token (rotación)
```

**Respuesta de login:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": { "id": "uuid", "username": "admin", "role": "ADMIN" }
}
```

**Cambio de contraseña propia (`PATCH /auth/me/password`):**
- Requiere la contraseña actual para verificar identidad
- Limpia el flag `mustChangePassword` al completar
- Invalida todas las sesiones anteriores (incrementa `sessionVersion`)

---

### Users

Gestión de usuarios del sistema. Solo **ADMIN**.

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/users` | Listar todos los usuarios |
| GET | `/users/:id` | Detalle de un usuario |
| POST | `/users` | Crear usuario (ADMIN o EMPLOYEE) |
| PATCH | `/users/:id` | Actualizar nombre o estado |
| PATCH | `/users/:id/reset-password` | Restablecer contraseña (admin fuerza nueva clave) |
| DELETE | `/users/:id` | Desactivar usuario (soft delete) |

**Reglas de negocio:**
- No se puede desactivar la propia cuenta
- No se puede desactivar al último administrador activo
- `reset-password` activa el flag `mustChangePassword` → el usuario deberá cambiarla en su próximo login
- Las contraseñas se guardan con bcrypt (10 rounds), nunca en texto plano

---

### Courts

Gestión de canchas de pádel.

| Método | Endpoint | Acceso | Descripción |
|--------|----------|--------|-------------|
| GET | `/courts?onlyActive=true` | Todos | Listar canchas |
| GET | `/courts/:id` | Todos | Detalle de cancha |
| POST | `/courts` | Admin | Crear cancha |
| PATCH | `/courts/:id` | Admin | Actualizar cancha |

---

### Bookings

Módulo más complejo del sistema. Gestiona reservas con **anti-overbooking de dos capas**.

| Método | Endpoint | Acceso | Descripción |
|--------|----------|--------|-------------|
| GET | `/bookings?date=YYYY-MM-DD&courtId=uuid` | Todos | Agenda del día |
| GET | `/bookings/:id` | Todos | Detalle de reserva |
| POST | `/bookings` | Todos | Crear reserva |
| PATCH | `/bookings/:id` | Todos | Actualizar reserva |
| POST | `/bookings/:id/move` | Todos | Mover reserva a otro slot |
| POST | `/bookings/:id/duplicate` | Todos | Duplicar reserva en otro slot |
| DELETE | `/bookings/:id` | Admin | Cancelar reserva |

**Máquina de estados:**

```
BOOKED ──► PLAYING ──► COMPLETED  (terminal)
   │
   └──► CANCELLED  (terminal, solo ADMIN)
```

**Anti-overbooking (dos capas):**
1. **Advisory Lock PostgreSQL** — `pg_advisory_xact_lock()` sobre el hash del slot (cancha + fecha + hora), serializa solicitudes concurrentes
2. **Constraint UNIQUE** en DB — `(court_id, date, hour)`, segunda red de seguridad a nivel base de datos

**Mover turno (`POST /bookings/:id/move`):**
- Traslada la reserva a otra cancha / fecha / hora
- Verifica disponibilidad del slot destino con anti-overbooking
- Conserva todos los datos originales (cliente, productos, pago)

**Duplicar turno (`POST /bookings/:id/duplicate`):**
- Crea una nueva reserva en otro slot copiando `clientName`, `priceType`, `durationMinutes` e items
- El pago del nuevo turno comienza en $0
- El slot original permanece sin cambios

**Flujo transaccional de creación:**
```
1. Advisory lock en slot
2. Verificar cancha activa
3. Verificar superposición de horarios (cálculo por minutos)
4. SELECT FOR UPDATE en productos (stock)
5. Crear Booking con snapshot de precios
6. Crear BookingItems (snapshot unitPrice)
7. Crear BookingPayment
8. Registrar transacción en caja
9. COMMIT — o ROLLBACK total en cualquier error
```

**Entidades:**

- `Booking` — reserva principal con estado, precio, duración y cliente
- `BookingItem` — productos consumidos en la reserva (con snapshot de precio)
- `BookingPayment` — registro de pago (efectivo / transferencia)

---

### Products

Gestión de inventario y catálogo de productos.

| Método | Endpoint | Acceso | Descripción |
|--------|----------|--------|-------------|
| GET | `/products` | Todos | Listar con filtros |
| GET | `/products/featured` | Todos | Productos destacados (agenda) |
| GET | `/products/low-stock` | Todos | Alertas de stock mínimo |
| GET | `/products/categories` | Todos | Categorías disponibles |
| GET | `/products/summary` | Admin | Estadísticas de inventario |
| GET | `/products/:id` | Todos | Detalle de producto |
| POST | `/products` | Admin | Crear producto |
| PATCH | `/products/:id` | Admin | Actualizar / ajustar stock |
| DELETE | `/products/:id` | Admin | Desactivar producto (soft delete) |

**Query params de `/products`:**

| Param | Tipo | Descripción |
|-------|------|-------------|
| `search` | string | Busca por nombre |
| `categoryId` | uuid | Filtra por categoría |
| `lowStock` | boolean | Solo productos bajo mínimo |
| `onlyActive` | boolean | Solo activos (default: false) |

**Reglas de negocio:**
- El stock nunca puede quedar negativo (CHECK constraint en DB)
- `isFeatured = true` expone el producto en los botones rápidos de la agenda
- Las categorías se cargan automáticamente (eager loading)

---

### POS (Ventas)

Punto de venta directa de productos (sin reserva).

| Método | Endpoint | Acceso | Descripción |
|--------|----------|--------|-------------|
| GET | `/sales?date=YYYY-MM-DD` | Todos | Ventas del día |
| POST | `/sales` | Todos | Registrar venta |

**Header de idempotencia:**

```
X-Idempotency-Key: <uuid-generado-por-el-cliente>
```

El frontend genera un UUID por intento de venta. Si la misma clave llega dos veces (doble clic, retry por red lenta), el backend retorna la venta ya creada sin volver a descontar stock ni registrar en caja.

**Flujo transaccional:**
```
1. Verificar clave de idempotencia (si existe → retornar venta original)
2. SELECT FOR UPDATE en cada producto
3. Validar stock disponible
4. Snapshot de precio (unitPrice)
5. Crear Sale + SaleItems (con idempotency_key)
6. Decrementar stock atómicamente
7. Registrar en caja
8. COMMIT — o ROLLBACK total
```

**Validaciones:**
- Se requiere caja abierta (si no hay sesión activa → 503)
- El total pagado debe cubrir el total de la venta
- El precio capturado al momento de la venta no se ve afectado por cambios futuros al producto

---

### Cash Register (Caja)

Gestión de sesiones de caja diaria. Todas las operaciones (reservas y ventas) registran sus transacciones aquí automáticamente.

| Método | Endpoint | Acceso | Descripción |
|--------|----------|--------|-------------|
| GET | `/cash/current?date=YYYY-MM-DD` | Todos | Estado y totales de la caja |
| POST | `/cash/open` | Todos | Apertura manual de jornada |
| POST | `/cash/close` | Todos | Cierre Z (cierre del día) |

**Flujo de sesión:**
```
POST /cash/open  (empleado declara fondo inicial)
        │
        ▼
   CashSession OPEN  ◄─── Bookings y Sales registran transacciones
        │
        ▼ POST /cash/close (Cierre Z)
   CashSession CLOSED ──► No se permiten más operaciones (503)
```

**Apertura de caja (`POST /cash/open`):**
- El empleado declara el fondo inicial (cambio/vuelto disponible)
- El fondo es solo referencia operativa, no entra en el arqueo
- Falla con 409 si ya existe una sesión abierta

**Sesiones múltiples por día:**
- Se eliminó el constraint UNIQUE en `date` de `cash_sessions`
- La unicidad real es "solo una sesión OPEN a la vez" (validado a nivel de aplicación)
- Permite turnos mañana/tarde con sesiones independientes

**GET `/cash/current`:**
- Sin `?date` → devuelve la sesión OPEN activa (aunque haya cruzado la medianoche)
- Con `?date` → consulta histórica de ese día comercial
- Si no hay sesión → `session: null` (frontend muestra pantalla de apertura)

**Entidades:**

- `CashSession` — sesión diaria con fondo inicial, totales, diferencia de caja y notas de cierre
- `Transaction` — registro polimórfico de cada movimiento (tipo: `BOOKING` | `SALE`)

**Respuesta de `/cash/current`:**
```json
{
  "session": { "id": "uuid", "date": "2026-03-10", "status": "OPEN" },
  "totals": {
    "totalCash": 15000,
    "totalTransfer": 8500,
    "grandTotal": 23500
  },
  "transactions": [...]
}
```

---

### Reports

Reportes financieros y operacionales. Solo **ADMIN**.

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/reports/summary?dateFrom=&dateTo=` | Cards del dashboard |
| GET | `/reports/revenue?dateFrom=&dateTo=&groupBy=day\|week\|month` | Ingresos en el tiempo |
| GET | `/reports/payment-methods` | Distribución efectivo / transferencia |
| GET | `/reports/products-ranking` | Top 20 productos por unidades vendidas |
| GET | `/reports/transactions/export` | Datos para exportar a CSV |

**Detalles técnicos:**
- Usa SQL crudo con parámetros seguros (sin riesgo de inyección)
- Timezone: `America/Argentina/Buenos_Aires`
- `getProductsRanking()` realiza un `UNION` entre `sale_items` y `booking_items`
- Agrupación temporal con `DATE_TRUNC` de PostgreSQL

---

### System Config

Configuración global del sistema. Solo **ADMIN**.

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/config` | Obtener toda la configuración |
| PATCH | `/config/:key` | Actualizar un valor |
| PUT | `/config/bulk` | Actualizar múltiples valores |

**Claves predefinidas:**

| Clave | Descripción |
|-------|-------------|
| `precio_estandar` | Precio de hora estándar |
| `precio_profesor` | Precio de hora para profesor |
| `hora_apertura` | Hora de apertura del club |
| `hora_cierre` | Hora de cierre del club |
| `nombre_club` | Nombre del club |

---

## Modelo de datos

```
User ──< Booking >── Court
  │          │
  │          ├──< BookingItem >── Product >── ProductCategory
  │          └──── BookingPayment
  │
  ├──< Sale >── CashSession
  │      └──< SaleItem >── Product
  │
  └──< CashSession (opened/closed)
             └──< Transaction
```

**Relaciones clave:**

| Entidad | Relación | Descripción |
|---------|----------|-------------|
| Booking → BookingItem | OneToMany | Productos consumidos en la reserva |
| Booking → BookingPayment | OneToOne | Pago de la reserva |
| Sale → SaleItem | OneToMany | Productos de una venta directa |
| CashSession → Transaction | OneToMany | Todos los movimientos del día |
| Product → ProductCategory | ManyToOne | Categorización del inventario |

---

## Seguridad y autenticación

### JWT

- **Algoritmo:** HS256
- **Access token:** 8 horas
- **Refresh token:** 7 días (secret independiente)
- **Payload:** `{ sub, username, role, sessionVersion }`
- **Rotación:** cada refresh genera un par de tokens completamente nuevo

### Sesión única (single-session enforcement)

Cada usuario tiene un `sessionVersion` en DB. Cada login lo incrementa e incluye ese valor en el JWT. El `JwtStrategy` compara el valor del token con el de la DB en cada request — si no coincide (el usuario inició sesión en otro dispositivo o el admin reseteó la clave), el request se rechaza con `SESSION_OVERRIDDEN`.

### Guards (aplicados globalmente)

| Guard | Propósito |
|-------|-----------|
| `JwtAuthGuard` | Valida el Bearer token en cada request |
| `RolesGuard` | Verifica que el rol del usuario coincida con `@Roles()` |
| `ThrottlerGuard` | Rate limiting (60 req/min por defecto) |

### Protecciones adicionales

- Mensajes de error genéricos en login (evita enumeración de usuarios)
- El strategy JWT recarga el usuario desde DB en cada request (detecta cuentas desactivadas)
- Contraseñas nunca expuestas en respuestas (`passwordHash` excluida)
- ValidationPipe global con `whitelist: true` (descarta campos no declarados en DTOs)
- Flag `mustChangePassword`: activo cuando un admin resetea la clave de otro usuario

### Formato de error uniforme

```json
{
  "statusCode": 400,
  "timestamp": "2026-03-10T12:00:00.000Z",
  "path": "/api/v1/bookings",
  "message": "Descripción del error"
}
```

---

## Patrones arquitectónicos clave

### 1. Transacciones atómicas con QueryRunner

Todas las operaciones de escritura complejas usan `QueryRunner` de TypeORM con `COMMIT` / `ROLLBACK` explícito. Ninguna operación queda en estado parcial.

### 2. Snapshot de precios

`BookingItem.unitPrice` y `SaleItem.unitPrice` capturan el precio del producto **en el momento de la transacción**. Los cambios futuros de precio no alteran registros históricos.

### 3. Advisory Locks de PostgreSQL

Usados en dos módulos críticos:

- **Bookings:** `pg_advisory_xact_lock(hash(courtId, date, hour))` — evita doble reserva del mismo slot bajo concurrencia
- **CashRegister:** advisory lock sobre la fecha — evita sesiones duplicadas del mismo día

### 4. Soft Deletes

Usuarios y productos nunca se eliminan físicamente. Se marcan como `isActive = false`, preservando el historial y respetando las foreign keys.

### 5. Bloqueo pesimista en stock (`SELECT FOR UPDATE`)

Antes de decrementar stock en ventas y reservas, se bloquea la fila del producto con `SELECT FOR UPDATE`. Garantiza que dos transacciones concurrentes no lean el mismo stock disponible.

### 6. Transacciones polimórficas

`Transaction.type` (`BOOKING` | `SALE`) + `referenceId` permiten una tabla unificada de movimientos de caja extensible sin modificar el esquema.

### 7. Idempotencia en ventas

`Sale.idempotency_key` (UUID, UNIQUE, nullable) permite detectar y rechazar ventas duplicadas por doble clic o retry de red. El frontend envía el UUID por header `X-Idempotency-Key`; si la clave ya existe, se retorna la venta original sin ejecutar ninguna lógica de negocio.

### 8. Sesión única por usuario

`User.sessionVersion` se incrementa en cada login. El JWT payload incluye este valor y el strategy lo valida en cada request, garantizando que un nuevo login invalide automáticamente todos los tokens anteriores del mismo usuario.

---

## Documentación Swagger

Disponible en desarrollo en:

```
http://localhost:3000/api/docs
```

Incluye todos los endpoints documentados con sus DTOs, respuestas posibles y soporte para autenticación Bearer.
