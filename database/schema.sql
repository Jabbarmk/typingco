-- ============================================================
-- ALNOOR ERP — Full Database Schema
-- MySQL 8.x | Charset: utf8mb4 | Timezone: Asia/Dubai
-- ============================================================

CREATE DATABASE IF NOT EXISTS alnoor_erp
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE alnoor_erp;

-- ============================================================
-- SUPER ADMIN LAYER
-- ============================================================

CREATE TABLE IF NOT EXISTS plans (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(50)    NOT NULL,          -- Starter, Professional, Enterprise
  price_monthly DECIMAL(10,2)  NOT NULL,
  price_annual  DECIMAL(10,2)  NOT NULL,
  max_users     INT            NOT NULL DEFAULT 3,
  features      JSON,
  is_active     TINYINT(1)     NOT NULL DEFAULT 1,
  created_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS companies (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150)  NOT NULL,
  name_ar         VARCHAR(150),
  trn             VARCHAR(15),                     -- UAE TRN: 15 digits ending 003
  cr_number       VARCHAR(50),
  email           VARCHAR(150)  NOT NULL,
  phone           VARCHAR(30),
  address         VARCHAR(255),
  emirate         VARCHAR(50)   DEFAULT 'Dubai',
  country_code    CHAR(2)       DEFAULT 'AE',
  logo_url        VARCHAR(255),
  plan_id         INT,
  status          ENUM('trial','active','suspended','cancelled') DEFAULT 'trial',
  trial_ends_at   DATE,
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  company_id     INT           NOT NULL,
  plan_id        INT           NOT NULL,
  billing_cycle  ENUM('monthly','annual') DEFAULT 'monthly',
  amount         DECIMAL(10,2) NOT NULL,
  status         ENUM('trial','active','suspended','cancelled') DEFAULT 'active',
  starts_at      DATE          NOT NULL,
  ends_at        DATE,
  renewed_at     DATE,
  created_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (plan_id)    REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT           NOT NULL,
  sub_id       INT           NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,
  method       ENUM('bank_transfer','card','cash','cheque') DEFAULT 'bank_transfer',
  reference    VARCHAR(100),
  paid_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  status       ENUM('paid','pending','failed','refunded') DEFAULT 'paid',
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (sub_id)     REFERENCES subscriptions(id)
);

CREATE TABLE IF NOT EXISTS users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT,                               -- NULL = super admin
  name         VARCHAR(100)  NOT NULL,
  email        VARCHAR(150)  NOT NULL UNIQUE,
  password     VARCHAR(255)  NOT NULL,            -- bcrypt hash
  role         ENUM('superadmin','admin','manager','operator') DEFAULT 'operator',
  is_active    TINYINT(1)    NOT NULL DEFAULT 1,
  last_login   TIMESTAMP     NULL,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT,
  company_id   INT,
  action       VARCHAR(100)  NOT NULL,
  target       VARCHAR(200),
  ip_address   VARCHAR(45),
  result       ENUM('success','warning','error') DEFAULT 'success',
  meta         JSON,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- ============================================================
-- TYPING CENTRE ERP LAYER (per-company)
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  company_id    INT           NOT NULL,
  name          VARCHAR(150)  NOT NULL,
  phone         VARCHAR(30),
  email         VARCHAR(150),
  nationality   VARCHAR(60),
  id_type       ENUM('emirates_id','passport','visa','other') DEFAULT 'emirates_id',
  id_number     VARCHAR(50),
  emirate       VARCHAR(50)   DEFAULT 'Dubai',
  customer_type ENUM('individual','company') DEFAULT 'individual',
  trn           VARCHAR(15),
  notes         TEXT,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS services (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT           NOT NULL,
  name         VARCHAR(150)  NOT NULL,
  category     VARCHAR(60),
  unit_price   DECIMAL(10,2) NOT NULL,
  vat_category ENUM('S','Z','E','O') DEFAULT 'S',
  icon         VARCHAR(20)   DEFAULT NULL,
  is_active    TINYINT(1)    NOT NULL DEFAULT 1,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  company_id      INT            NOT NULL,
  invoice_number  VARCHAR(30)    NOT NULL UNIQUE,
  type            ENUM('tax_invoice','credit_note','debit_note') DEFAULT 'tax_invoice',
  customer_id     INT,
  customer_name   VARCHAR(150),
  customer_trn    VARCHAR(15),
  issue_date      DATE           NOT NULL,
  supply_date     DATE,
  subtotal        DECIMAL(12,2)  NOT NULL DEFAULT 0,
  discount_amt    DECIMAL(12,2)  NOT NULL DEFAULT 0,
  vat_amount      DECIMAL(12,2)  NOT NULL DEFAULT 0,
  total           DECIMAL(12,2)  NOT NULL DEFAULT 0,
  payment_method  ENUM('cash','card','bank_transfer') DEFAULT 'cash',
  status          ENUM('draft','posted','void') DEFAULT 'posted',
  einvoice_status ENUM('none','queued','submitted','cleared','failed') DEFAULT 'none',
  einvoice_uuid   VARCHAR(100),
  notes           TEXT,
  created_at      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id)  REFERENCES companies(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id   INT            NOT NULL,
  service_id   INT,
  description  VARCHAR(255)   NOT NULL,
  quantity     DECIMAL(10,3)  NOT NULL DEFAULT 1,
  unit_price   DECIMAL(10,2)  NOT NULL,
  vat_category ENUM('S','Z','E','O') DEFAULT 'S',
  vat_rate     DECIMAL(5,4)   NOT NULL DEFAULT 0.05,
  line_amount  DECIMAL(12,2)  NOT NULL,
  vat_amount   DECIMAL(12,2)  NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE IF NOT EXISTS applications (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  company_id      INT           NOT NULL,
  app_number      VARCHAR(30)   NOT NULL UNIQUE,
  customer_id     INT,
  customer_name   VARCHAR(150),
  service_type    VARCHAR(150)  NOT NULL,
  status          ENUM('new','doc_pending','ready_to_submit','submitted','processing','under_process','completed','rejected') DEFAULT 'new',
  priority        ENUM('normal','urgent') DEFAULT 'normal',
  govt_ref        VARCHAR(100),
  govt_ref_number VARCHAR(100),
  govt_fee        DECIMAL(10,2) DEFAULT 0,
  service_fee     DECIMAL(10,2) DEFAULT 0,
  assigned_to     VARCHAR(100),
  expected_date   DATE,
  notes           TEXT,
  submitted_at    TIMESTAMP     NULL,
  completed_at    TIMESTAMP     NULL,
  created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id)  REFERENCES companies(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS application_history (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT          NOT NULL,
  from_status    VARCHAR(50),
  to_status      VARCHAR(50)  NOT NULL,
  note           TEXT,
  changed_by     INT,
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES applications(id),
  FOREIGN KEY (changed_by)     REFERENCES users(id)
);

-- ============================================================
-- ACCOUNTING (double-entry)
-- ============================================================

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT          NOT NULL,
  code         VARCHAR(20)  NOT NULL,
  name         VARCHAR(150) NOT NULL,
  type         ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_coa (company_id, code),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT           NOT NULL,
  je_number    VARCHAR(30)   NOT NULL,
  reference    VARCHAR(100),
  description  TEXT,
  entry_date   DATE          NOT NULL,
  status       ENUM('draft','posted') DEFAULT 'posted',
  created_by   INT,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  je_id        INT            NOT NULL,
  account_id   INT            NOT NULL,
  description  VARCHAR(255),
  debit        DECIMAL(14,2)  NOT NULL DEFAULT 0,
  credit       DECIMAL(14,2)  NOT NULL DEFAULT 0,
  FOREIGN KEY (je_id)      REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT           NOT NULL,
  expense_date DATE          NOT NULL,
  category     VARCHAR(80)   NOT NULL DEFAULT 'General',
  description  VARCHAR(255)  NOT NULL,
  amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  vat_input    DECIMAL(12,2) NOT NULL DEFAULT 0,
  supplier     VARCHAR(150),
  reference    VARCHAR(100),
  account_id   INT,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);

-- ============================================================
-- VAT / E-INVOICE
-- ============================================================

CREATE TABLE IF NOT EXISTS vat_periods (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT          NOT NULL,
  period_from  DATE         NOT NULL,
  period_to    DATE         NOT NULL,
  output_vat   DECIMAL(12,2) NOT NULL DEFAULT 0,
  input_vat    DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_vat      DECIMAL(12,2) GENERATED ALWAYS AS (output_vat - input_vat) STORED,
  status       ENUM('open','filed') DEFAULT 'open',
  filed_at     TIMESTAMP    NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS einvoice_queue (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  company_id      INT          NOT NULL,
  invoice_id      INT          NOT NULL,
  status          ENUM('pending','submitted','cleared','failed') DEFAULT 'pending',
  attempts        INT          NOT NULL DEFAULT 0,
  last_attempt    TIMESTAMP    NULL,
  next_retry      TIMESTAMP    NULL,
  asp_uuid        VARCHAR(100),
  asp_response    JSON,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE TABLE IF NOT EXISTS einvoice_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT          NOT NULL,
  invoice_id   INT,
  level        ENUM('INFO','WARN','ERROR') DEFAULT 'INFO',
  message      TEXT         NOT NULL,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- ============================================================
-- LEADS & QUOTATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT           NOT NULL,
  name         VARCHAR(150)  NOT NULL,
  phone        VARCHAR(30),
  email        VARCHAR(150),
  company_name VARCHAR(150),
  source       ENUM('walk_in','referral','online','phone','whatsapp','other') DEFAULT 'walk_in',
  notes        TEXT,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS quotations (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  company_id    INT           NOT NULL,
  quote_number  VARCHAR(30)   NOT NULL UNIQUE,
  lead_id       INT           DEFAULT NULL,
  lead_name     VARCHAR(150),
  lead_phone    VARCHAR(30),
  lead_email    VARCHAR(150),
  lead_company  VARCHAR(150),
  issue_date    DATE          NOT NULL,
  valid_until   DATE          DEFAULT NULL,
  subtotal      DECIMAL(12,2) DEFAULT 0.00,
  discount_amt  DECIMAL(12,2) DEFAULT 0.00,
  vat_amount    DECIMAL(12,2) DEFAULT 0.00,
  total         DECIMAL(12,2) DEFAULT 0.00,
  status        ENUM('draft','sent','accepted','rejected','invoiced','expired') DEFAULT 'draft',
  notes         TEXT,
  terms_text    TEXT,
  invoice_id    INT           DEFAULT NULL,
  created_by    INT           DEFAULT NULL,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS quotation_lines (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id   INT           NOT NULL,
  service_id     INT           DEFAULT NULL,
  description    VARCHAR(255)  NOT NULL,
  quantity       DECIMAL(10,3) DEFAULT 1.000,
  unit_price     DECIMAL(10,2) NOT NULL,
  vat_category   ENUM('S','Z','E','O') DEFAULT 'S',
  vat_rate       DECIMAL(5,4)  DEFAULT 0.0500,
  line_amount    DECIMAL(12,2) NOT NULL,
  vat_amount     DECIMAL(12,2) DEFAULT 0.00,
  FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
);

-- ============================================================
-- DOCUMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  company_id      INT          NOT NULL,
  customer_id     INT,
  application_id  INT,
  name            VARCHAR(200) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  file_size       INT,
  mime_type       VARCHAR(100),
  expires_at      DATE,
  uploaded_by     INT,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id)     REFERENCES companies(id),
  FOREIGN KEY (customer_id)    REFERENCES customers(id),
  FOREIGN KEY (application_id) REFERENCES applications(id),
  FOREIGN KEY (uploaded_by)    REFERENCES users(id)
);

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO plans (name, price_monthly, price_annual, max_users, features) VALUES
('Starter',      1200.00, 12000.00,  3,  '["POS & Sales","Customer management","Basic reports","Email support"]'),
('Professional', 2500.00, 25000.00,  10, '["Full accounting","Application tracking","Document management","WhatsApp notifications","UAE VAT reports","Priority support"]'),
('Enterprise',   4500.00, 48000.00,  999,'["All Professional features","UAE e-invoicing","Multi-branch","Custom integrations","Dedicated account manager","SLA 99.9%"]')
ON DUPLICATE KEY UPDATE name=name;

INSERT INTO companies (name, name_ar, trn, cr_number, email, phone, address, emirate, plan_id, status) VALUES
('Al Noor Typing & Photocopying', 'النور للطباعة والتصوير', '100234567890003', 'CN-2021-0045', 'info@alnoor.ae', '+971501234567', 'Shop 12, Al Nahda Complex', 'Dubai',    3, 'active'),
('Gulf Services LLC',             'خليج للخدمات',           '100987654300003', 'CN-2019-0122', 'info@gulfserv.ae','+971502345678', 'Office 5, Bur Dubai',         'Dubai',    2, 'active'),
('Emirates Doc Centre',           NULL,                      NULL,              NULL,            'info@edc.ae',     '+971503456789', 'Sharjah City Centre',         'Sharjah',  1, 'trial'),
('Sharjah Typing Hub',            NULL,                      '100456789100003', 'CN-2018-0300', 'info@shjtypng.ae','+971504567890', 'Al Qasba, Sharjah',           'Sharjah',  3, 'active'),
('Ajman Typing Office',           NULL,                      NULL,              NULL,            'info@ajmantyp.ae','+971505678901', 'Ajman Free Zone',             'Ajman',    2, 'suspended')
ON DUPLICATE KEY UPDATE name=name;

INSERT INTO users (company_id, name, email, password, role) VALUES
(NULL, 'Super Admin',      'admin@alnoor.ae',       '$2b$10$placeholder_hash_superadmin', 'superadmin'),
(1,    'Ahmed Al Mazrouei','ahmed@alnoor.ae',        '$2b$10$placeholder_hash_admin1',     'admin'),
(2,    'Sara Hassan',      'sara@gulfserv.ae',       '$2b$10$placeholder_hash_mgr1',       'manager'),
(3,    'Omar Khalid',      'omar@edc.ae',            '$2b$10$placeholder_hash_op1',        'operator')
ON DUPLICATE KEY UPDATE name=name;

-- Services for company 1 (Al Noor)
INSERT INTO services (company_id, name, category, unit_price, vat_category) VALUES
(1, 'Emirates ID Typing',      'Government',  250.00, 'S'),
(1, 'Visa Application',        'Government', 1200.00, 'S'),
(1, 'Visa Renewal',            'Government',  900.00, 'S'),
(1, 'MOHRE Labour Contract',   'Government',  350.00, 'S'),
(1, 'Medical Typing',          'Government',  180.00, 'S'),
(1, 'Trade Licence Renewal',   'Government',  500.00, 'S'),
(1, 'Photocopy A4 B&W',        'Photocopy',    0.50, 'S'),
(1, 'Photocopy A4 Colour',     'Photocopy',    1.00, 'S'),
(1, 'Scan to PDF',             'Photocopy',    5.00, 'S'),
(1, 'Lamination A4',           'Photocopy',    5.00, 'S'),
(1, 'Binding',                 'Photocopy',   15.00, 'S'),
(1, 'Passport Typing',         'Government',  150.00, 'S')
ON DUPLICATE KEY UPDATE name=name;

-- Chart of accounts for company 1
INSERT INTO chart_of_accounts (company_id, code, name, type) VALUES
(1, '1100', 'Cash',                   'asset'),
(1, '1200', 'Accounts Receivable',    'asset'),
(1, '2100', 'Accounts Payable',       'liability'),
(1, '2200', 'VAT Payable',            'liability'),
(1, '3100', 'Owner Equity',           'equity'),
(1, '4100', 'Service Revenue',        'revenue'),
(1, '4200', 'Govt Fee Pass-through',  'revenue'),
(1, '5100', 'Rent Expense',           'expense'),
(1, '5200', 'Salaries Expense',       'expense'),
(1, '5300', 'Utilities Expense',      'expense')
ON DUPLICATE KEY UPDATE name=name;
