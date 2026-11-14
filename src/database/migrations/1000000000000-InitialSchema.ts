import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline schema: the database as it was before migration 1000000000001.
 *
 * The original schema was created with `synchronize`, so an empty database
 * could not be migrated (the first migration alters `sales`, which did not
 * exist). This migration recreates that starting point on an EMPTY database
 * only; on any existing database (production included) it does nothing and is
 * just recorded as applied.
 *
 * How the SQL was produced: production schema (no data), then every
 * migration's down() in reverse order, then `pg_dump --schema-only`.
 */
export class InitialSchema1000000000000 implements MigrationInterface {
  name = 'InitialSchema1000000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { exists: boolean }[] = await queryRunner.query(
      `SELECT to_regclass('public.users') IS NOT NULL AS "exists"`,
    );
    if (rows[0]?.exists) return;

    await queryRunner.query(`

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

CREATE TYPE public.bookings_price_type_enum AS ENUM (
    'standard',
    'professor'
);

CREATE TYPE public.bookings_status_enum AS ENUM (
    'booked',
    'playing',
    'completed',
    'cancelled'
);

CREATE TYPE public.cash_sessions_status_enum AS ENUM (
    'open',
    'closed'
);

CREATE TYPE public.expenses_category_enum AS ENUM (
    'Insumos',
    'Mantenimiento',
    'Sueldos',
    'Servicios',
    'Otro'
);

CREATE TYPE public.expenses_payment_method_enum AS ENUM (
    'Efectivo',
    'Transferencia',
    'Tarjeta',
    'Otro'
);

CREATE TYPE public.transactions_type_enum AS ENUM (
    'booking',
    'sale',
    'settlement'
);

CREATE TYPE public.users_role_enum AS ENUM (
    'admin',
    'employee'
);

CREATE TABLE public.booking_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    booking_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT "CHK_103731323f8fc1fda15e1feeca" CHECK ((quantity > 0))
);

CREATE TABLE public.booking_payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    booking_id uuid NOT NULL,
    amount_cash numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    amount_transfer numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    paid_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bookings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    court_id uuid NOT NULL,
    date date NOT NULL,
    hour character varying(5) NOT NULL,
    status public.bookings_status_enum DEFAULT 'booked'::public.bookings_status_enum NOT NULL,
    client_name character varying(150) NOT NULL,
    price_type public.bookings_price_type_enum DEFAULT 'standard'::public.bookings_price_type_enum NOT NULL,
    applied_shift_name character varying(100),
    price_amount numeric(10,2) NOT NULL,
    duration_minutes integer DEFAULT 60 NOT NULL,
    created_by_user_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cash_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    date date NOT NULL,
    status public.cash_sessions_status_enum DEFAULT 'open'::public.cash_sessions_status_enum NOT NULL,
    opened_by_user_id uuid,
    closed_by_user_id uuid,
    cash_counted numeric(10,2),
    difference numeric(10,2),
    initial_balance numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    opened_at timestamp without time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone
);

CREATE TABLE public.courts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.expenses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    amount numeric(10,2) NOT NULL,
    description character varying(255) NOT NULL,
    category public.expenses_category_enum DEFAULT 'Otro'::public.expenses_category_enum NOT NULL,
    payment_method public.expenses_payment_method_enum DEFAULT 'Efectivo'::public.expenses_payment_method_enum NOT NULL,
    date date NOT NULL,
    cash_session_id uuid,
    created_by_user_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);

CREATE TABLE public.pricing_shifts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    start_time character varying(5) NOT NULL,
    end_time character varying(5) NOT NULL,
    days_of_week text NOT NULL,
    price_30min numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    price_60min numeric(10,2) NOT NULL,
    price_90min numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    price_120min numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    teacher_price_per_hour numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.product_categories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.products (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(150) NOT NULL,
    category_id uuid,
    cost_price numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    sale_price numeric(10,2) NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    min_stock integer DEFAULT 5 NOT NULL,
    is_featured boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT "CHK_aea3ee263e1d44e36e5f5b5783" CHECK ((stock >= 0))
);

CREATE TABLE public.sale_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sale_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT "CHK_11ae30f8d4c0b9607120d43505" CHECK ((quantity > 0))
);

CREATE TABLE public.sales (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cash_session_id uuid NOT NULL,
    created_by_user_id uuid,
    amount_cash numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    amount_transfer numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    total numeric(10,2) NOT NULL,
    customer_name character varying(100),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.system_config (
    key character varying(100) NOT NULL,
    value character varying(500) NOT NULL,
    description character varying(255),
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cash_session_id uuid,
    type public.transactions_type_enum NOT NULL,
    reference_id uuid,
    concept character varying(255) NOT NULL,
    amount_cash numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    amount_transfer numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    created_by_user_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    username character varying(50) NOT NULL,
    full_name character varying(100) NOT NULL,
    password_hash character varying NOT NULL,
    role public.users_role_enum DEFAULT 'employee'::public.users_role_enum NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.products
    ADD CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY (id);

ALTER TABLE ONLY public.pricing_shifts
    ADD CONSTRAINT "PK_38bf83a80f071ed2ce71b9c7dbf" PRIMARY KEY (id);

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT "PK_4f0bc990ae81dba46da680895ea" PRIMARY KEY (id);

ALTER TABLE ONLY public.booking_payments
    ADD CONSTRAINT "PK_4f54ffc7dfddb70234fb53a97a9" PRIMARY KEY (id);

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT "PK_53d863efb388346f9bee6ec6701" PRIMARY KEY (id);

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT "PK_5a7dc5b4562a9e590528b3e08ab" PRIMARY KEY (id);

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT "PK_7069dac60d88408eca56fdc9e0c" PRIMARY KEY (id);

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT "PK_946ea5ce864b10fb70162708448" PRIMARY KEY (id);

ALTER TABLE ONLY public.courts
    ADD CONSTRAINT "PK_948a5d356c3083f3237ecbf9897" PRIMARY KEY (id);

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT "PK_94c3ceb17e3140abc9282c20610" PRIMARY KEY (id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY (id);

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT "PK_bee6805982cc1e248e94ce94957" PRIMARY KEY (id);

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT "PK_eedd3cd0f227c7fb5eff2204e93" PRIMARY KEY (key);

ALTER TABLE ONLY public.booking_payments
    ADD CONSTRAINT "REL_afaa5733b05d8844072d5107ea" UNIQUE (booking_id);

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT "UQ_a75bfadcd8291a0538ab7abfdcf" UNIQUE (name);

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT "UQ_booking_court_date_hour" UNIQUE (court_id, date, hour);

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT "UQ_cash_session_date" UNIQUE (date);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE (username);

CREATE INDEX "IDX_booking_court_date" ON public.bookings USING btree (court_id, date);

CREATE INDEX "IDX_booking_date" ON public.bookings USING btree (date);

CREATE INDEX "IDX_transaction_session" ON public.transactions USING btree (cash_session_id);

CREATE INDEX "IDX_transaction_type_ref" ON public.transactions USING btree (type, reference_id);

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT "FK_051d3c1315bc8d8b0567feff198" FOREIGN KEY (cash_session_id) REFERENCES public.cash_sessions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT "FK_2bd7e9c03db9f51a4765974abb8" FOREIGN KEY (court_id) REFERENCES public.courts(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT "FK_44b020f061fb4e8628710571bfb" FOREIGN KEY (opened_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT "FK_45bf07fc1290c059e3884753e89" FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT "FK_4e85abc6ca85052e6703762ec30" FOREIGN KEY (cash_session_id) REFERENCES public.cash_sessions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT "FK_4ecae62db3f9e9cc9a368d57adb" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT "FK_5d4e096ac4d4725b0189876bd55" FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT "FK_720a3f2f2cedc8732785cee85b6" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT "FK_75386bba209e8eb029dc4f27e4b" FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT "FK_955c4c4d285ec0bec8ff953f486" FOREIGN KEY (cash_session_id) REFERENCES public.cash_sessions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.products
    ADD CONSTRAINT "FK_9a5f6868c96e0069e699f33e124" FOREIGN KEY (category_id) REFERENCES public.product_categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.booking_payments
    ADD CONSTRAINT "FK_afaa5733b05d8844072d5107eae" FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT "FK_c210a330b80232c29c2ad68462a" FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT "FK_e627a013019838efab1870d2376" FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT "FK_e7e788d35705cfd1349f240628c" FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT "FK_ef31cb9266b7deb19ad60847479" FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;

    `);
  }

  public async down(): Promise<void> {
    // Intentionally empty: reverting the baseline would drop every table.
  }
}
