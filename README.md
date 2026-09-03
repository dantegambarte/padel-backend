# PadelSys — Backend API

Sistema integral de gestión para canchas de pádel. Construido con **NestJS**, **TypeORM** y **PostgreSQL**. Provee autenticación JWT, control de reservas con anti-overbooking, turnos fijos recurrentes, punto de venta, caja registradora, recordatorios y reportes financieros.

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
   - [Fixed Bookings (Turnos Fijos)](#fixed-bookings-turnos-fijos)
   - [Teachers (Profesores)](#teachers-profesores)
   - [Pricing Shifts (Franjas de precio)](#pricing-shifts-franjas-de-precio)
   - [Products](#products)
   - [POS (Ventas)](#pos-ventas)
   - [Cash Register (Caja)](#cash-register-caja)
   - [Reports](#reports)
   - [Search (Búsqueda global)](#search-búsqueda-global)
   - [Reminders (Recordatorios)](#reminders-recordatorios)
   - [Expenses (Egresos)](#expenses-egresos)
   - [System Config](#system-config)
7. [Modelo de datos](#modelo-de-datos)
8. [Seguridad y autenticación](#seguridad-y-autenticación)
9. [Patrones arquitectónicos clave](#patrones-arquitectónicos-clave)
10. [Documentación Swagger](#documentación-swagger)

---

## Tecnologías

| Categoría          | Tecnología                            |
| ------------------ | ------------------------------------- |
| Framework          | NestJS v11                            |
| Lenguaje           | TypeScript ^5.9                       |
| Base de datos      | PostgreSQL 15                         |
| ORM                | TypeORM v0.3                          |
| Auth               | JWT (HS256) + Passport                |
| Hashing            | bcrypt v6 (10 rounds)                 |
| Validación         | class-validator + Joi                 |
| Documentación      | Swagger / OpenAPI (@nestjs/swagger 11)|
| Rate limiting      | @nestjs/throttler v6                  |
| Tareas programadas | @nestjs/schedule v6                   |
| Exportación        | exceljs                               |
| Testing            | Jest 30 + Supertest 7                 |
| Lint / formato     | ESLint 10 (flat config) + Prettier 3  |
| Proceso prod       | PM2                                   |

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
│  │  Fixed   │ │ Teachers │ │ Pricing  │ │  Products   │    │
│  │Bookings  │ │          │ │ Shifts   │ │             │    │
│  ├──────────┤ ├──────────┤ ├──────────┤ ├─────────────┤    │
│  │   POS    │ │  Cash    │ │ Reports  │ │   Search    │    │
│  ├──────────┤ └──────────┘ └──────────┘ └─────────────┘    │
│  │Reminders │                                               │
│  └──────────┘                                               │
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

| Rol        | Descripción                                                |
| ---------- | ---------------------------------------------------------- |
| `ADMIN`    | Acceso total: usuarios, productos, reportes, cancelaciones |
| `EMPLOYEE` | Acceso operativo: reservas, ventas, consultas              |

---

## Estructura de carpetas

```
src/
├── main.ts                        # Bootstrap, CORS, prefijo global, Swagger
├── app.module.ts                  # Módulo raíz: throttler, config, TypeORM, schedule
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
│   │   ├── 1000000000003-DropUniqueDateCashSessions.ts
│   │   ├── 1000000000004-AddIsRentalToProductCategories.ts
│   │   ├── 1000000000005-AddOpenedByIndexToCashSessions.ts
│   │   ├── 1000000000006-AddTeacherPriceToCourts.ts
│   │   ├── 1000000000007-CreateFixedBookings.ts
│   │   ├── 1000000000008-FixedBookingsHasDeposit.ts
│   │   ├── 1000000000009-RemoveHasDeposit.ts
│   │   ├── 1000000000010-AddIsConfirmedToBookings.ts
│   │   ├── 1000000000011-CreateTeachers.ts
│   │   ├── 1000000000012-AddIconToProducts.ts
│   │   ├── 1000000000013-BackfillProductIcons.ts
│   │   ├── 1000000000014-CreateDailyClosures.ts
│   │   └── 1000000000015-RecalcSessionDifferences.ts
│   └── seed.ts                    # Seed inicial (admin + config)
└── modules/
    ├── auth/
    ├── users/
    ├── courts/
    ├── bookings/
    ├── fixed-bookings/
    ├── teachers/
    ├── pricing-shifts/
    ├── products/
    ├── pos/
    ├── cash-register/
    ├── reports/
    ├── search/
    ├── reminders/
    ├── expenses/
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
DB_USERNAME=padel_user
DB_PASSWORD=padel_secret
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

### Migraciones

```bash
# Ejecutar todas las migraciones pendientes
npm run migration:run

# Revertir la última migración
npm run migration:revert

# Generar nueva migración a partir de cambios en entidades
npm run migration:generate
```

### Seed

```bash
npm run seed        # datos demo completos
npm run seed:cash   # solo sesiones de caja
```

El seed es **idempotente**: se puede correr las veces que haga falta sobre la misma base.

- Los productos demo se upsertean por `name` en lugar de saltarse cuando ya existe cualquier producto — así el stock vuelve a su valor original entre corridas de E2E
- Si ya hay sesiones de caja pero ninguna abierta, crea una para que los tests de caja y POS no queden bloqueados
- Las entidades se cargan por glob (`modules/**/entities/*.entity{.ts,.js}`), no por lista manual: una entidad nueva queda incluida sin tocar `seed.ts`

### Calidad de código

```bash
npm run lint   # ESLint 10 (flat config, eslint.config.mjs) con --fix
npm test       # Jest 30
```

El proyecto usa **ESLint flat config** (`eslint.config.mjs`) integrado con Prettier vía `eslint-plugin-prettier` y `eslint-config-prettier`.

### URLs útiles

| Servicio | URL                              |
| -------- | -------------------------------- |
| API      | `http://localhost:3000/api/v1`   |
| Swagger  | `http://localhost:3000/api/docs` |

---

## Módulos y endpoints

> **Base URL:** `/api/v1`
> Todos los endpoints (excepto login y refresh) requieren `Authorization: Bearer <token>`.

---

### Auth

Gestión de sesión y tokens JWT.

| Método | Endpoint            | Acceso      | Descripción                 |
| ------ | ------------------- | ----------- | --------------------------- |
| POST   | `/auth/login`       | Público     | Login con username/password |
| POST   | `/auth/refresh`     | Público     | Renovar par de tokens       |
| GET    | `/auth/me`          | Autenticado | Perfil del usuario actual   |
| PATCH  | `/auth/me/password` | Autenticado | Cambiar contraseña propia   |

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

| Método | Endpoint                    | Descripción                                       |
| ------ | --------------------------- | ------------------------------------------------- |
| GET    | `/users`                    | Listar todos los usuarios                         |
| GET    | `/users/:id`                | Detalle de un usuario                             |
| POST   | `/users`                    | Crear usuario (ADMIN o EMPLOYEE)                  |
| PATCH  | `/users/:id`                | Actualizar nombre o estado                        |
| PATCH  | `/users/:id/reset-password` | Restablecer contraseña (admin fuerza nueva clave) |
| DELETE | `/users/:id`                | Desactivar usuario (soft delete)                  |

**Reglas de negocio:**

- No se puede desactivar la propia cuenta
- No se puede desactivar al último administrador activo
- `reset-password` activa el flag `mustChangePassword` → el usuario deberá cambiarla en su próximo login
- Las contraseñas se guardan con bcrypt (10 rounds), nunca en texto plano

---

### Courts

Gestión de canchas de pádel.

| Método | Endpoint                  | Acceso | Descripción       |
| ------ | ------------------------- | ------ | ----------------- |
| GET    | `/courts?onlyActive=true` | Todos  | Listar canchas    |
| GET    | `/courts/:id`             | Todos  | Detalle de cancha |
| POST   | `/courts`                 | Admin  | Crear cancha      |
| PATCH  | `/courts/:id`             | Admin  | Actualizar cancha |

**Campo nuevo:** `teacherPrice` — precio especial de la cancha cuando hay profesor asignado a la reserva.

---

### Bookings

Módulo más complejo del sistema. Gestiona reservas con **anti-overbooking de dos capas**.

| Método | Endpoint                                 | Acceso | Descripción                   |
| ------ | ---------------------------------------- | ------ | ----------------------------- |
| GET    | `/bookings?date=YYYY-MM-DD&courtId=uuid` | Todos  | Agenda del día                |
| GET    | `/bookings/:id`                          | Todos  | Detalle de reserva            |
| POST   | `/bookings`                              | Todos  | Crear reserva                 |
| PATCH  | `/bookings/:id`                          | Todos  | Actualizar reserva            |
| POST   | `/bookings/:id/move`                     | Todos  | Mover reserva a otro slot     |
| POST   | `/bookings/:id/duplicate`                | Todos  | Duplicar reserva en otro slot |
| DELETE | `/bookings/:id`                          | Admin  | Cancelar reserva              |

**Máquina de estados:**

```
BOOKED ──► PLAYING ──► COMPLETED  (terminal)
   │
   └──► CANCELLED  (terminal, solo ADMIN)
```

**Anti-overbooking (dos capas):**

1. **Advisory Lock PostgreSQL** — `pg_advisory_xact_lock()` sobre el hash del slot (cancha + fecha + hora), serializa solicitudes concurrentes
2. **Constraint UNIQUE** en DB — `(court_id, date, hour)`, segunda red de seguridad a nivel base de datos

**Campos nuevos en Booking:**

| Campo            | Tipo            | Descripción                                                                 |
| ---------------- | --------------- | --------------------------------------------------------------------------- |
| `fixedBookingId` | UUID (nullable) | FK al turno fijo que generó esta reserva                                    |
| `teacherId`      | UUID (nullable) | FK al profesor asignado                                                     |
| `isConfirmed`    | boolean         | Indica si el cliente confirmó asistencia (solo relevante para turnos fijos) |

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

### Fixed Bookings (Turnos Fijos)

Gestión de reservas recurrentes semanales. Solo **ADMIN**.

| Método | Endpoint                       | Descripción                                              |
| ------ | ------------------------------ | -------------------------------------------------------- |
| GET    | `/fixed-bookings`              | Listar todos los turnos fijos                            |
| GET    | `/fixed-bookings/:id`          | Detalle de turno fijo                                    |
| POST   | `/fixed-bookings`              | Crear turno fijo (genera 8 semanas de reservas)          |
| PATCH  | `/fixed-bookings/:id`          | Actualizar turno fijo                                    |
| DELETE | `/fixed-bookings/:id`          | Desactivar turno fijo (soft delete)                      |
| DELETE | `/fixed-bookings/:id/cascade`  | Desactivar y eliminar reservas futuras con estado BOOKED |
| POST   | `/fixed-bookings/:id/generate` | Generar manualmente las próximas 8 semanas de reservas   |

**Campos de `FixedBooking`:**

| Campo             | Tipo                  | Descripción                                       |
| ----------------- | --------------------- | ------------------------------------------------- |
| `clientName`      | varchar 150           | Nombre del cliente                                |
| `phoneNumber`     | varchar 30 (nullable) | Teléfono para recordatorios WhatsApp              |
| `dayOfWeek`       | int (1–7)             | Día de la semana en ISO 8601 (1=Lunes, 7=Domingo) |
| `hour`            | varchar "HH:MM"       | Hora del turno                                    |
| `durationMinutes` | int                   | Duración: 30, 60, 90 o 120 minutos                |
| `courtId`         | UUID                  | Cancha asignada                                   |
| `teacherId`       | UUID (nullable)       | Profesor asignado                                 |
| `startDate`       | date "YYYY-MM-DD"     | Fecha desde la cual se generan reservas           |
| `isActive`        | boolean               | Si el turno está vigente                          |
| `notes`           | text (nullable)       | Notas adicionales                                 |

**Reglas de negocio:**

- Al crear un turno fijo se generan automáticamente reservas individuales para las próximas 8 semanas
- El soft delete solo marca `isActive = false`; no cancela reservas ya generadas
- El cascade delete cancela únicamente las reservas futuras en estado `BOOKED`
- Las reservas generadas quedan enlazadas a su turno fijo vía `fixedBookingId`
- Confirmación de asistencia: el admin marca `isConfirmed = true` en la reserva individual tras contactar al cliente por WhatsApp

---

### Teachers (Profesores)

Gestión de profesores del club.

| Método | Endpoint                         | Acceso | Descripción                                 |
| ------ | -------------------------------- | ------ | ------------------------------------------- |
| GET    | `/teachers`                      | Todos  | Listar profesores activos                   |
| GET    | `/teachers?includeInactive=true` | Admin  | Listar todos incluyendo inactivos           |
| GET    | `/teachers/:id`                  | Todos  | Detalle de profesor                         |
| POST   | `/teachers`                      | Admin  | Crear profesor                              |
| PATCH  | `/teachers/:id`                  | Admin  | Actualizar profesor                         |
| DELETE | `/teachers/:id`                  | Admin  | Desactivar profesor (soft delete, HTTP 204) |

**Campos de `Teacher`:**

| Campo         | Tipo                   | Descripción                |
| ------------- | ---------------------- | -------------------------- |
| `fullName`    | varchar 150            | Nombre completo            |
| `phoneNumber` | varchar 30 (nullable)  | Teléfono de contacto       |
| `email`       | varchar 150 (nullable) | Email de contacto          |
| `isActive`    | boolean                | Si el profesor está activo |

**Reglas de negocio:**

- Soft delete: `isActive = false`, nunca eliminación física
- Si un profesor es eliminado, sus reservas y turnos fijos mantienen el registro (SET NULL en FK)
- Empleados no pueden acceder a `?includeInactive=true` → 403 Forbidden

---

### Pricing Shifts (Franjas de precio)

Define precios dinámicos por día y horario. Solo **ADMIN** para escritura.

| Método | Endpoint                 | Acceso | Descripción                 |
| ------ | ------------------------ | ------ | --------------------------- |
| GET    | `/pricing-shifts`        | Admin  | Listar todas las franjas    |
| GET    | `/pricing-shifts/active` | Todos  | Listar solo franjas activas |
| GET    | `/pricing-shifts/:id`    | Admin  | Detalle de franja           |
| POST   | `/pricing-shifts`        | Admin  | Crear franja de precio      |
| PATCH  | `/pricing-shifts/:id`    | Admin  | Actualizar franja           |
| DELETE | `/pricing-shifts/:id`    | Admin  | Eliminar franja (HTTP 204)  |

**Campos de `PricingShift`:**

| Campo                 | Tipo            | Descripción                                                 |
| --------------------- | --------------- | ----------------------------------------------------------- |
| `name`                | varchar 100     | Nombre descriptivo (ej: "Turno Mañana L-V")                 |
| `startTime`           | varchar "HH:mm" | Hora de inicio (múltiplo de 30 min)                         |
| `endTime`             | varchar "HH:mm" | Hora de fin (múltiplo de 30 min)                            |
| `daysOfWeek`          | int[] JSON      | Días de la semana (0=Domingo, convención JS)                |
| `price30min`          | numeric         | Precio para turno de 30 minutos                             |
| `price60min`          | numeric         | Precio para turno de 60 minutos                             |
| `price90min`          | numeric         | Precio para turno de 90 minutos                             |
| `price120min`         | numeric         | Precio para turno de 120 minutos                            |
| `teacherPricePerHour` | numeric         | Precio adicional por hora cuando hay profesor (prorrateado) |
| `isActive`            | boolean         | Si la franja está vigente                                   |

**Reglas de negocio:**

- Solo las franjas activas se aplican al cálculo de precios
- Los horarios deben ser múltiplos de 30 minutos (`:00` o `:30`)
- El precio del profesor se proratea según la duración del turno

---

### Products

Gestión de inventario y catálogo de productos.

| Método | Endpoint               | Acceso | Descripción                       |
| ------ | ---------------------- | ------ | --------------------------------- |
| GET    | `/products`            | Todos  | Listar con filtros                |
| GET    | `/products/featured`   | Todos  | Productos destacados (agenda)     |
| GET    | `/products/low-stock`  | Todos  | Alertas de stock mínimo           |
| GET    | `/products/categories` | Todos  | Categorías disponibles            |
| GET    | `/products/summary`    | Admin  | Estadísticas de inventario        |
| GET    | `/products/:id`        | Todos  | Detalle de producto               |
| POST   | `/products`            | Admin  | Crear producto                    |
| PATCH  | `/products/:id`        | Admin  | Actualizar / ajustar stock        |
| DELETE | `/products/:id`        | Admin  | Desactivar producto (soft delete) |

**Query params de `/products`:**

| Param        | Tipo    | Descripción                   |
| ------------ | ------- | ----------------------------- |
| `search`     | string  | Busca por nombre              |
| `categoryId` | uuid    | Filtra por categoría          |
| `lowStock`   | boolean | Solo productos bajo mínimo    |
| `onlyActive` | boolean | Solo activos (default: false) |

**Campos nuevos:**

| Campo      | Entidad           | Descripción                                                                                                |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `icon`     | `Product`         | Nombre de ícono de Material Symbols Rounded (default: `inventory_2`)                                       |
| `isRental` | `ProductCategory` | Marca la categoría como alquiler — los productos en estas categorías **no descuentan stock** en ventas POS |

**Reglas de negocio:**

- El stock nunca puede quedar negativo (CHECK constraint en DB)
- `isFeatured = true` expone el producto en los botones rápidos de la agenda
- Las categorías se cargan automáticamente (eager loading)
- Los productos de categorías con `isRental = true` se venden sin descontar stock (ej: alquiler de paletas)

---

### POS (Ventas)

Punto de venta directa de productos (sin reserva).

| Método | Endpoint                 | Acceso | Descripción     |
| ------ | ------------------------ | ------ | --------------- |
| GET    | `/sales?date=YYYY-MM-DD` | Todos  | Ventas del día  |
| POST   | `/sales`                 | Todos  | Registrar venta |

**Header de idempotencia:**

```
X-Idempotency-Key: <uuid-generado-por-el-cliente>
```

El frontend genera un UUID por intento de venta. Si la misma clave llega dos veces (doble clic, retry por red lenta), el backend retorna la venta ya creada sin volver a descontar stock ni registrar en caja.

**Flujo transaccional:**

```
1. Verificar clave de idempotencia (si existe → retornar venta original)
2. SELECT FOR UPDATE en cada producto
3. Validar stock disponible (omitido para categorías isRental)
4. Snapshot de precio (unitPrice)
5. Crear Sale + SaleItems (con idempotency_key)
6. Decrementar stock atómicamente (omitido para categorías isRental)
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

| Método | Endpoint                        | Acceso | Descripción                 |
| ------ | ------------------------------- | ------ | --------------------------- |
| GET    | `/cash/current?date=YYYY-MM-DD` | Todos  | Estado y totales de la caja |
| POST   | `/cash/open`                    | Todos  | Apertura manual de jornada  |
| POST   | `/cash/close`                   | Todos  | Cierre Z (cierre del día)   |

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
- `DailyClosureRecord` — registro único por fecha comercial que actúa como bloqueo para evitar dobles cierres de jornada (tabla `daily_closures`, campo `date` con constraint UNIQUE)

**Cierre de Jornada (`DailyClosureRecord`):**

- Se persiste una sola vez por fecha comercial al confirmar el "Cierre de Jornada"
- Impide que se ejecute el cierre dos veces en el mismo día comercial
- Incluye el campo `closedAt` (timestamptz) con el momento exacto del cierre

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

| Método | Endpoint                                                      | Descripción                             |
| ------ | ------------------------------------------------------------- | --------------------------------------- |
| GET    | `/reports/summary?dateFrom=&dateTo=`                          | Cards del dashboard                     |
| GET    | `/reports/kpis?dateFrom=&dateTo=`                             | KPIs ejecutivos del dashboard           |
| GET    | `/reports/revenue?dateFrom=&dateTo=&groupBy=day\|week\|month` | Ingresos en el tiempo                   |
| GET    | `/reports/revenue/trend?dateFrom=&dateTo=`                    | Tendencia diaria de ingresos            |
| GET    | `/reports/payment-methods?dateFrom=&dateTo=`                  | Distribución efectivo / transferencia   |
| GET    | `/reports/products-ranking?dateFrom=&dateTo=`                 | Top 20 productos por unidades vendidas  |
| GET    | `/reports/expenses?dateFrom=&dateTo=`                         | Reporte de gastos                       |
| GET    | `/reports/low-stock`                                          | Productos con stock bajo o agotado      |
| GET    | `/reports/transactions?dateFrom=&dateTo=`                     | Historial de transacciones (exportable) |

**Detalles técnicos:**

- Usa SQL crudo con parámetros seguros (sin riesgo de inyección)
- Timezone: `America/Argentina/Buenos_Aires`
- `getProductsRanking()` realiza un `UNION` entre `sale_items` y `booking_items`
- Agrupación temporal con `DATE_TRUNC` de PostgreSQL
- El endpoint de transacciones soporta exportación (usa `exceljs` para generar archivos)

---

### Search (Búsqueda global)

Búsqueda full-text unificada sobre productos, reservas y ventas.

| Método | Endpoint            | Acceso      | Descripción     |
| ------ | ------------------- | ----------- | --------------- |
| GET    | `/search?q=término` | Autenticado | Búsqueda global |

**Rate limit:** 30 req/min (el frontend aplica debounce de 300ms adicional)

**Respuesta:**

```json
{
  "products": [{ "id": "uuid", "label": "Pelota Penn", "subLabel": "Pelotas" }],
  "bookings": [
    { "id": "uuid", "label": "Juan García", "subLabel": "Cancha 1 — 10:00", "date": "2026-04-02" }
  ],
  "sales": [{ "id": "uuid", "label": "María López", "subLabel": "02/04/2026 — $5.000" }]
}
```

**Comportamiento:**

- Máximo 6 resultados por categoría
- Productos: búsqueda ILIKE por nombre, solo activos
- Reservas: no canceladas, desde hoy en adelante
- Ventas: desde hoy en adelante, filtradas por nombre de cliente
- Timezone-aware: usa `America/Argentina/Buenos_Aires`

---

### Reminders (Recordatorios)

Recordatorios de turnos fijos para notificaciones por WhatsApp.

| Método | Endpoint              | Acceso | Descripción                  |
| ------ | --------------------- | ------ | ---------------------------- |
| GET    | `/reminders/upcoming` | Admin  | Turnos fijos de hoy y mañana |

**Respuesta:**

```json
{
  "today": [
    { "bookingId": "uuid", "clientName": "Juan García", "phoneNumber": "+5491...", "courtName": "Cancha 1", "date": "2026-04-02", "hour": "10:00" }
  ],
  "tomorrow": [...]
}
```

**Reglas de negocio:**

- Solo retorna reservas generadas desde turnos fijos (`fixedBookingId != null`)
- Excluye reservas canceladas
- El campo `phoneNumber` viene del turno fijo original
- El servicio expone además `getUpcomingForCron()` para uso interno: retorna recordatorios en ventana de 23–24h ("mañana") y 1–2h ("hoy"), usado para envío automático por cron

---

### Expenses (Egresos)

Registro de egresos de caja. **ADMIN** y **EMPLOYEE** pueden crear y consultar; solo **ADMIN** puede modificar y eliminar.

| Método | Endpoint                        | Acceso          | Descripción                            |
| ------ | ------------------------------- | --------------- | -------------------------------------- |
| GET    | `/expenses?from=&to=`           | Admin, Employee | Listar egresos (con filtro de fechas)  |
| GET    | `/expenses/:id`                 | Admin, Employee | Detalle de egreso                      |
| POST   | `/expenses`                     | Admin, Employee | Registrar egreso                       |
| PATCH  | `/expenses/:id`                 | Admin           | Actualizar egreso                      |
| DELETE | `/expenses/:id`                 | Admin           | Eliminar egreso (soft delete, HTTP 204)|

**Campos de `Expense`:**

| Campo           | Tipo                    | Descripción                                                      |
| --------------- | ----------------------- | ---------------------------------------------------------------- |
| `amount`        | numeric(10,2)           | Monto del egreso (positivo)                                      |
| `description`   | varchar 255             | Descripción del gasto                                            |
| `category`      | enum `ExpenseCategory`  | `Insumos` \| `Mantenimiento` \| `Sueldos` \| `Servicios` \| `Otro` |
| `paymentMethod` | enum `PaymentMethod`    | `Efectivo` \| `Transferencia` \| `Tarjeta` \| `Otro`            |
| `date`          | date "YYYY-MM-DD"       | Fecha comercial del egreso                                       |
| `cashSessionId` | UUID (nullable)         | FK a la sesión de caja activa (solo cuando `paymentMethod = Efectivo`) |
| `createdByUserId`| UUID (nullable)        | FK al usuario que registró el egreso (auditoría)                 |

**Reglas de negocio:**

- Soft delete: `deletedAt` (TypeORM `@DeleteDateColumn`), nunca eliminación física
- Los egresos en efectivo se vinculan automáticamente a la sesión de caja abierta
- Los egresos en efectivo impactan el arqueo del cierre Z (se descuentan del efectivo esperado)
- La fórmula de diferencia de caja usa `GREATEST(0, ...)` para evitar valores negativos en `cash_expected` cuando los egresos superan los ingresos en efectivo
- `PATCH` y `DELETE` solo para ADMIN; employees pueden crear y leer

---

### System Config

Configuración global del sistema. Solo **ADMIN**.

| Método | Endpoint       | Descripción                   |
| ------ | -------------- | ----------------------------- |
| GET    | `/config`      | Obtener toda la configuración |
| PATCH  | `/config/:key` | Actualizar un valor           |
| PUT    | `/config/bulk` | Actualizar múltiples valores  |

**Claves predefinidas:**

| Clave             | Descripción                  |
| ----------------- | ---------------------------- |
| `precio_estandar` | Precio de hora estándar      |
| `precio_profesor` | Precio de hora para profesor |
| `hora_apertura`   | Hora de apertura del club    |
| `hora_cierre`     | Hora de cierre del club      |
| `nombre_club`     | Nombre del club              |

---

## Modelo de datos

```
User ──< Booking >── Court
  │          │           └── teacherPrice
  │          ├── fixedBookingId ──> FixedBooking >── Court
  │          ├── teacherId ──────────────────────> Teacher
  │          ├──< BookingItem >── Product >── ProductCategory (isRental)
  │          └──── BookingPayment
  │
  ├──< Sale >── CashSession
  │      └──< SaleItem >── Product
  │
  ├──< CashSession (opened/closed)
  │         ├──< Transaction
  │         └──< Expense (solo paymentMethod=Efectivo)
  │
  ├──< Expense (fecha comercial, categoría, método de pago)
  │
  └──< FixedBooking >── Court
             └── teacherId ──> Teacher

PricingShift  (tabla de lookup, sin FK a otras entidades)
```

**Relaciones clave:**

| Entidad                   | Relación             | Descripción                        |
| ------------------------- | -------------------- | ---------------------------------- |
| Booking → BookingItem     | OneToMany            | Productos consumidos en la reserva |
| Booking → BookingPayment  | OneToOne             | Pago de la reserva                 |
| Booking → FixedBooking    | ManyToOne (nullable) | Turno fijo que originó la reserva  |
| Booking → Teacher         | ManyToOne (nullable) | Profesor asignado a la reserva     |
| FixedBooking → Court      | ManyToOne            | Cancha del turno fijo              |
| FixedBooking → Teacher    | ManyToOne (nullable) | Profesor del turno fijo            |
| Sale → SaleItem           | OneToMany            | Productos de una venta directa     |
| CashSession → Transaction | OneToMany            | Todos los movimientos del día      |
| Product → ProductCategory | ManyToOne            | Categorización del inventario      |
| Expense → CashSession     | ManyToOne (nullable) | Egreso vinculado a caja (solo efectivo) |
| Expense → User            | ManyToOne (nullable) | Usuario que registró el egreso     |

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

> **Excepción en tests:** con `NODE_ENV=test`, `AuthService.login` **no** incrementa `sessionVersion`. Sin esta excepción, cualquier spec de Playwright que hace su propio login invalidaría la sesión compartida del `storageState` y el resto de la suite fallaría con `SESSION_OVERRIDDEN`. En el mismo entorno, el límite del throttler de `POST /auth/login` sube de 5 a 1000 req/min.

### Guards (aplicados globalmente)

| Guard            | Propósito                                               |
| ---------------- | ------------------------------------------------------- |
| `JwtAuthGuard`   | Valida el Bearer token en cada request                  |
| `RolesGuard`     | Verifica que el rol del usuario coincida con `@Roles()` |
| `ThrottlerGuard` | Rate limiting (60 req/min por defecto)                  |

### Protecciones adicionales

- Mensajes de error genéricos en login (evita enumeración de usuarios)
- El strategy JWT recarga el usuario desde DB en cada request (detecta cuentas desactivadas)
- Contraseñas nunca expuestas en respuestas (`passwordHash` excluida)
- ValidationPipe global con `whitelist: true` y `forbidNonWhitelisted: true` (descarta y rechaza campos no declarados en DTOs)
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

Usuarios, productos, profesores y turnos fijos nunca se eliminan físicamente. Se marcan como `isActive = false`, preservando el historial y respetando las foreign keys.

### 5. Bloqueo pesimista en stock (`SELECT FOR UPDATE`)

Antes de decrementar stock en ventas y reservas, se bloquea la fila del producto con `SELECT FOR UPDATE`. Garantiza que dos transacciones concurrentes no lean el mismo stock disponible.

### 6. Transacciones polimórficas

`Transaction.type` (`BOOKING` | `SALE`) + `referenceId` permiten una tabla unificada de movimientos de caja extensible sin modificar el esquema.

### 7. Idempotencia en ventas

`Sale.idempotency_key` (UUID, UNIQUE, nullable) permite detectar y rechazar ventas duplicadas por doble clic o retry de red. El frontend envía el UUID por header `X-Idempotency-Key`; si la clave ya existe, se retorna la venta original sin ejecutar ninguna lógica de negocio.

### 8. Sesión única por usuario

`User.sessionVersion` se incrementa en cada login (salvo con `NODE_ENV=test`, ver [Sesión única](#sesión-única-single-session-enforcement)). El JWT payload incluye este valor y el strategy lo valida en cada request, garantizando que un nuevo login invalide automáticamente todos los tokens anteriores del mismo usuario.

### 9. Generación automática de turnos fijos

Al crear un `FixedBooking`, el servicio genera automáticamente reservas individuales para las próximas 8 semanas, respetando el día de la semana y la hora configurados. La generación también puede dispararse manualmente via `POST /fixed-bookings/:id/generate`.

### 10. Precios dinámicos por franja horaria

Las `PricingShift` reemplazan el sistema de precio único por tipo. El precio de una reserva se determina en base al día de la semana y la hora del turno, con soporte para duraciones de 30, 60, 90 y 120 minutos. Si hay profesor, se aplica el `teacherPricePerHour` prorrateado.

### 11. Arqueo de caja con tope cero en egresos

El `cash_expected` al cierre se calcula como:

```
cash_expected = GREATEST(0, initial_balance + cash_income - cash_expense_total)
```

El `GREATEST(0, ...)` evita que `cash_expected` sea negativo cuando los egresos en efectivo superan los ingresos del día, lo que producía diferencias absurdas (ej. `+360.000`). Los registros históricos se corrigieron via la migración `1000000000015-RecalcSessionDifferences`.

### 12. Categorías de alquiler (isRental)

Las categorías de producto con `isRental = true` permiten registrar ventas de alquileres (paletas, pelotas, etc.) sin descontar stock. El flag se define a nivel de categoría, no de producto individual.

---

## Documentación Swagger

Disponible en desarrollo en:

```
http://localhost:3000/api/docs
```

Incluye todos los endpoints documentados con sus DTOs, respuestas posibles y soporte para autenticación Bearer.
