'use strict';
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const APP_VERSION = 'v6.4 DB 1.0';

const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const db = new Database('./kri.db');

const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

async function sendVerificationEmail(toEmail, token) {
  const link = `${BASE_URL}/verify-email.html?token=${token}`;
  if (!mailer) {
    console.log(`[DEV] Verificación para ${toEmail}: ${link}`);
    return;
  }
  await mailer.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      toEmail,
    subject: 'Verifica tu cuenta en CISO Toolkit',
    html:    `<p>Hola,</p><p>Haz clic en el siguiente enlace para verificar tu cuenta:</p><p><a href="${link}">${link}</a></p><p>Este enlace expirará en 24 horas.</p>`,
  });
}

// ─── Database Initialization ──────────────────────────────────────────────────

db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT DEFAULT 'CISO',
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS functions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    function_id INTEGER NOT NULL REFERENCES functions(id)
  );

  CREATE TABLE IF NOT EXISTS subcategories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS examples (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subcategory_id   INTEGER NOT NULL REFERENCES subcategories(id),
    number           INTEGER NOT NULL,
    text             TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kris (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subcategory_id   INTEGER UNIQUE NOT NULL REFERENCES subcategories(id),
    kri_name         TEXT,
    kri_description  TEXT,
    kri_formula      TEXT,
    cmmi_flag        TEXT CHECK(cmmi_flag IN ('POSITIVO','NEGATIVO')),
    cmmi_levels      TEXT,
    valoracion       REAL CHECK(valoracion >= 0 AND valoracion <= 100),
    updated_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS kri_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    subcategory_id INTEGER NOT NULL REFERENCES subcategories(id),
    valoracion     REAL NOT NULL,
    saved_by       TEXT NOT NULL,
    saved_at       TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Migrations ───────────────────────────────────────────────────────────────
(function runMigrations() {
  const cols = db.prepare("PRAGMA table_info(kris)").all().map(c => c.name);

  // M1: add valoracion / drop old 0-10 schema
  if (!cols.includes('valoracion')) {
    console.log('[M1] Migrating kris table to valoracion schema...');
    db.exec(`
      DROP TABLE IF EXISTS kris;
      CREATE TABLE kris (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        subcategory_id   INTEGER UNIQUE NOT NULL REFERENCES subcategories(id),
        kri_name         TEXT,
        kri_description  TEXT,
        kri_formula      TEXT,
        cmmi_flag        TEXT CHECK(cmmi_flag IN ('POSITIVO','NEGATIVO')),
        cmmi_levels      TEXT,
        valoracion       REAL CHECK(valoracion >= 0 AND valoracion <= 100),
        updated_at       TEXT DEFAULT (datetime('now'))
      );
    `);
    console.log('[M1] Done.');
  }

  // M2: drop quarterly columns (valor_enero/abril/julio/octubre)
  if (cols.includes('valor_enero')) {
    console.log('[M2] Dropping quarterly columns from kris...');
    db.exec(`
      CREATE TABLE kris_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        subcategory_id   INTEGER UNIQUE NOT NULL REFERENCES subcategories(id),
        kri_name         TEXT,
        kri_description  TEXT,
        kri_formula      TEXT,
        cmmi_flag        TEXT CHECK(cmmi_flag IN ('POSITIVO','NEGATIVO')),
        cmmi_levels      TEXT,
        valoracion       REAL CHECK(valoracion >= 0 AND valoracion <= 100),
        updated_at       TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO kris_new (id,subcategory_id,kri_name,kri_description,kri_formula,
                            cmmi_flag,cmmi_levels,valoracion,updated_at)
        SELECT id,subcategory_id,kri_name,kri_description,kri_formula,
               cmmi_flag,cmmi_levels,valoracion,updated_at FROM kris;
      DROP TABLE kris;
      ALTER TABLE kris_new RENAME TO kris;
    `);
    console.log('[M2] Done.');
  }

  // M3: create kri_history if missing
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (!tables.includes('kri_history')) {
    console.log('[M3] Creating kri_history table...');
    db.exec(`
      CREATE TABLE kri_history (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        subcategory_id INTEGER NOT NULL REFERENCES subcategories(id),
        valoracion     REAL NOT NULL,
        saved_by       TEXT NOT NULL,
        saved_at       TEXT DEFAULT (datetime('now'))
      );
    `);
    console.log('[M3] Done.');
  }

  // M4: remove UNIQUE constraint from kris.subcategory_id (allow multiple KRIs per subcategory)
  const krisSQL = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='kris'").get()?.sql || '';
  if (krisSQL.includes('UNIQUE')) {
    console.log('[M4] Removing UNIQUE constraint from kris.subcategory_id...');
    db.exec(`
      CREATE TABLE kris_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        subcategory_id   INTEGER NOT NULL REFERENCES subcategories(id),
        kri_name         TEXT,
        kri_description  TEXT,
        kri_formula      TEXT,
        cmmi_flag        TEXT CHECK(cmmi_flag IN ('POSITIVO','NEGATIVO')),
        cmmi_levels      TEXT,
        valoracion       REAL CHECK(valoracion >= 0 AND valoracion <= 100),
        updated_at       TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO kris_new SELECT * FROM kris;
      DROP TABLE kris;
      ALTER TABLE kris_new RENAME TO kris;
    `);
    console.log('[M4] Done.');
  }

  // M4b: add kri_id to kri_history + backfill
  const histCols = db.prepare("PRAGMA table_info(kri_history)").all().map(c => c.name);
  if (!histCols.includes('kri_id')) {
    console.log('[M4b] Adding kri_id to kri_history...');
    db.exec('ALTER TABLE kri_history ADD COLUMN kri_id INTEGER REFERENCES kris(id)');
    db.exec(`
      UPDATE kri_history SET kri_id = (
        SELECT id FROM kris WHERE kris.subcategory_id = kri_history.subcategory_id
        ORDER BY id ASC LIMIT 1
      ) WHERE kri_id IS NULL
    `);
    console.log('[M4b] Done.');
  }

  // M5: add email verification fields to users
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes('email')) {
    console.log('[M5] Adding email verification fields to users...');
    db.exec('ALTER TABLE users ADD COLUMN email TEXT');
    db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0');
    db.exec('ALTER TABLE users ADD COLUMN verification_token TEXT');
    db.exec('ALTER TABLE users ADD COLUMN verification_expires TEXT');
    console.log('[M5] Done.');
  }

  // M6: add user_id to kris
  const kriCols = db.prepare("PRAGMA table_info(kris)").all().map(c => c.name);
  if (!kriCols.includes('user_id')) {
    console.log('[M6] Adding user_id to kris...');
    db.exec('ALTER TABLE kris ADD COLUMN user_id INTEGER REFERENCES users(id)');
    console.log('[M6] Done.');
  }

  // M7: add user_id to kri_history
  const histCols2 = db.prepare("PRAGMA table_info(kri_history)").all().map(c => c.name);
  if (!histCols2.includes('user_id')) {
    console.log('[M7] Adding user_id to kri_history...');
    db.exec('ALTER TABLE kri_history ADD COLUMN user_id INTEGER REFERENCES users(id)');
    console.log('[M7] Done.');
  }

  // M8: Upgrade default ciso user to ADMIN role
  const cisoUser = db.prepare("SELECT role FROM users WHERE username='ciso'").get();
  if (cisoUser && cisoUser.role !== 'ADMIN') {
    console.log('[M8] Upgrading ciso user to ADMIN role...');
    db.prepare("UPDATE users SET role='ADMIN' WHERE username='ciso'").run();
    console.log('[M8] Done.');
  }

  // M9: add scratch_mode to users
  const userCols9 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols9.includes('scratch_mode')) {
    console.log('[M9] Adding scratch_mode to users...');
    db.exec('ALTER TABLE users ADD COLUMN scratch_mode INTEGER DEFAULT 0');
    console.log('[M9] Done.');
  }

  // M10: add heatmap_name to users
  const userCols10 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols10.includes('heatmap_name')) {
    console.log('[M10] Adding heatmap_name to users...');
    db.exec('ALTER TABLE users ADD COLUMN heatmap_name TEXT DEFAULT NULL');
    console.log('[M10] Done.');
  }
})();

// ─── Seed Data ────────────────────────────────────────────────────────────────

function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) as c FROM functions').get().c;
  if (count > 0) return;

  console.log('Seeding database with NIST CSF 2.0 data...');

  // Default CISO user
  const hash = bcrypt.hashSync('Admin1234!', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('ciso', hash);

  const fns = [
    { code: 'GV', name: 'GOVERN',   description: "The organization's cybersecurity risk management strategy, expectations, and policy are established, communicated, and monitored" },
    { code: 'ID', name: 'IDENTIFY', description: "The organization's current cybersecurity risks are understood" },
    { code: 'PR', name: 'PROTECT',  description: "Safeguards to manage the organization's cybersecurity risks are used" },
    { code: 'DE', name: 'DETECT',   description: "Possible cybersecurity attacks and compromises are found and analyzed" },
    { code: 'RS', name: 'RESPOND',  description: "Actions regarding a detected cybersecurity incident are taken" },
    { code: 'RC', name: 'RECOVER',  description: "Assets and operations affected by a cybersecurity incident are restored" },
  ];
  const insF = db.prepare('INSERT INTO functions (code, name, description) VALUES (?, ?, ?)');
  fns.forEach(f => insF.run(f.code, f.name, f.description));
  const fnMap = {};
  db.prepare('SELECT id, code FROM functions').all().forEach(r => { fnMap[r.code] = r.id; });

  const cats = [
    { code: 'GV.OC', name: 'Organizational Context',                       fn: 'GV', desc: "The circumstances — mission, stakeholder expectations, dependencies, and legal, regulatory, and contractual requirements — surrounding the organization's cybersecurity risk management decisions are understood" },
    { code: 'GV.RM', name: 'Risk Management Strategy',                      fn: 'GV', desc: "The organization's priorities, constraints, risk tolerance and appetite statements, and assumptions are established, communicated, and used to support operational risk decisions" },
    { code: 'GV.RR', name: 'Roles, Responsibilities, and Authorities',      fn: 'GV', desc: "Cybersecurity roles, responsibilities, and authorities to foster accountability, performance assessment, and continuous improvement are established and communicated" },
    { code: 'GV.PO', name: 'Policy',                                        fn: 'GV', desc: "Organizational cybersecurity policy is established, communicated, and enforced" },
    { code: 'GV.OV', name: 'Oversight',                                     fn: 'GV', desc: "Results of organization-wide cybersecurity risk management activities and performance are used to inform, improve, and adjust the risk management strategy" },
    { code: 'GV.SC', name: 'Cybersecurity Supply Chain Risk Management',    fn: 'GV', desc: "Cyber supply chain risk management processes are identified, established, managed, monitored, and improved by organizational stakeholders" },
    { code: 'ID.AM', name: 'Asset Management',                              fn: 'ID', desc: "Assets (e.g., data, hardware, software, systems, facilities, services, people) that enable the organization to achieve business purposes are identified and managed consistent with their relative importance to organizational objectives and the organization's risk strategy" },
    { code: 'ID.RA', name: 'Risk Assessment',                               fn: 'ID', desc: "The cybersecurity risk to the organization, assets, and individuals is understood by the organization" },
    { code: 'ID.IM', name: 'Improvement',                                   fn: 'ID', desc: "Improvements to organizational cybersecurity risk management processes, procedures and activities are identified across all CSF Functions" },
    { code: 'PR.AA', name: 'Identity Management, Authentication & Access Control', fn: 'PR', desc: "Access to physical and logical assets is limited to authorized users, services, and hardware and managed commensurate with the assessed risk of unauthorized access" },
    { code: 'PR.AT', name: 'Awareness and Training',                        fn: 'PR', desc: "The organization's personnel are provided with cybersecurity awareness and training so that they can perform their cybersecurity-related tasks" },
    { code: 'PR.DS', name: 'Data Security',                                 fn: 'PR', desc: "Data are managed consistent with the organization's risk strategy to protect the confidentiality, integrity, and availability of information" },
    { code: 'PR.PS', name: 'Platform Security',                             fn: 'PR', desc: "The hardware, software (e.g., firmware, operating systems, applications), and services of physical and virtual platforms are managed consistent with the organization's risk strategy to protect their confidentiality, integrity, and availability" },
    { code: 'PR.IR', name: 'Technology Infrastructure Resilience',          fn: 'PR', desc: "Security architectures are managed with the organization's risk strategy to protect asset confidentiality, integrity, and availability, and organizational resilience" },
    { code: 'DE.AE', name: 'Adverse Event Analysis',                        fn: 'DE', desc: "Anomalies, indicators of compromise, and other potentially adverse events are analyzed to characterize the events and detect cybersecurity incidents" },
    { code: 'DE.CM', name: 'Continuous Monitoring',                         fn: 'DE', desc: "Assets are monitored to find anomalies, indicators of compromise, and other potentially adverse events" },
    { code: 'RS.MA', name: 'Incident Management',                           fn: 'RS', desc: "Responses to detected cybersecurity incidents are managed" },
    { code: 'RS.AN', name: 'Incident Analysis',                             fn: 'RS', desc: "Investigations are conducted to ensure effective response and support forensics and recovery activities" },
    { code: 'RS.CO', name: 'Incident Response Reporting and Communication', fn: 'RS', desc: "Response activities are coordinated with internal and external stakeholders as required by laws, regulations, or policies" },
    { code: 'RS.MI', name: 'Incident Mitigation',                           fn: 'RS', desc: "Activities are performed to prevent expansion of an event and mitigate its effects" },
    { code: 'RC.RP', name: 'Incident Recovery Plan Execution',              fn: 'RC', desc: "Restoration activities are performed to ensure operational availability of systems and services affected by cybersecurity incidents" },
    { code: 'RC.CO', name: 'Incident Recovery Communication',               fn: 'RC', desc: "Restoration activities are coordinated with internal and external parties" },
  ];
  const insC = db.prepare('INSERT INTO categories (code, name, description, function_id) VALUES (?, ?, ?, ?)');
  cats.forEach(c => insC.run(c.code, c.name, c.desc, fnMap[c.fn]));
  const catMap = {};
  db.prepare('SELECT id, code FROM categories').all().forEach(r => { catMap[r.code] = r.id; });

  const subs = [
    // ── GV.OC ───────────────────────────────────────────────────────────────
    { code: 'GV.OC-01', cat: 'GV.OC', desc: 'The organizational mission is understood and informs cybersecurity risk management', ex: [
      'Share the organization\'s mission (e.g., through vision and mission statements, marketing, and service strategies) to provide a basis for identifying risks that may impede that mission'
    ]},
    { code: 'GV.OC-02', cat: 'GV.OC', desc: 'Internal and external stakeholders are understood, and their needs and expectations regarding cybersecurity risk management are understood and considered', ex: [
      'Identify relevant internal stakeholders and their cybersecurity-related expectations (e.g., performance and risk expectations of officers, directors, and advisors; cultural expectations of employees)',
      'Identify relevant external stakeholders and their cybersecurity-related expectations (e.g., privacy expectations of customers, business expectations of partnerships, compliance expectations of regulators, ethics expectations of society)'
    ]},
    { code: 'GV.OC-03', cat: 'GV.OC', desc: 'Legal, regulatory, and contractual requirements regarding cybersecurity — including privacy and civil liberties obligations — are understood and managed', ex: [
      'Determine a process to track and manage legal and regulatory requirements regarding protection of individuals\' information (e.g., HIPAA, CCPA, GDPR)',
      'Determine a process to track and manage contractual requirements for cybersecurity management of supplier, customer, and partner information',
      'Align the organization\'s cybersecurity strategy with legal, regulatory, and contractual requirements'
    ]},
    { code: 'GV.OC-04', cat: 'GV.OC', desc: 'Critical objectives, capabilities, and services that external stakeholders depend on or expect from the organization are understood and communicated', ex: [
      'Establish criteria for determining the criticality of capabilities and services as viewed by internal and external stakeholders',
      'Determine assets and business operations that are vital to achieving mission objectives and the potential impact of a loss of such operations',
      'Establish and communicate resilience objectives (e.g., recovery time objectives) for delivering critical capabilities and services in various operating states'
    ]},
    { code: 'GV.OC-05', cat: 'GV.OC', desc: 'Outcomes, capabilities, and services that the organization depends on are understood and communicated', ex: [
      'Create an inventory of the organization\'s dependencies on external resources (e.g., facilities, cloud-based hosting providers) and their relationships to organizational assets and business functions',
      'Identify and document external dependencies that are potential points of failure for the organization\'s critical capabilities and services'
    ]},
    // ── GV.RM ───────────────────────────────────────────────────────────────
    { code: 'GV.RM-01', cat: 'GV.RM', desc: 'Risk management objectives are established and agreed to by organizational stakeholders', ex: [
      'Update near-term and long-term cybersecurity risk management objectives as part of annual strategic planning and when major changes occur',
      'Establish measurable objectives for cybersecurity risk management',
      'Senior leaders agree about cybersecurity objectives and use them for measuring and managing risk and performance'
    ]},
    { code: 'GV.RM-02', cat: 'GV.RM', desc: 'Risk appetite and risk tolerance statements are established, communicated, and maintained', ex: [
      'Determine and communicate risk appetite statements that convey expectations about the appropriate level of risk for the organization',
      'Translate risk appetite statements into specific, measurable, and broadly understandable risk tolerance statements',
      'Refine organizational objectives and risk appetite periodically based on known risk exposure and residual risk'
    ]},
    { code: 'GV.RM-03', cat: 'GV.RM', desc: 'Cybersecurity risk management activities and outcomes are included in enterprise risk management processes', ex: [
      'Aggregate and manage cybersecurity risks alongside other enterprise risks (e.g., compliance, financial, operational, regulatory, reputational, safety)',
      'Include cybersecurity risk managers in enterprise risk management planning',
      'Establish criteria for escalating cybersecurity risks within enterprise risk management'
    ]},
    { code: 'GV.RM-04', cat: 'GV.RM', desc: 'Strategic direction that describes appropriate risk response options is established and communicated', ex: [
      'Specify criteria for accepting and avoiding cybersecurity risk for various classifications of data',
      'Determine whether to purchase cybersecurity insurance',
      'Document conditions under which shared responsibility models are acceptable'
    ]},
    { code: 'GV.RM-05', cat: 'GV.RM', desc: 'Lines of communication across the organization are established for cybersecurity risks, including risks from suppliers and other third parties', ex: [
      'Determine how to update senior executives, directors, and management on the organization\'s cybersecurity posture at agreed-upon intervals',
      'Identify how all departments across the organization will communicate with each other about cybersecurity risks'
    ]},
    { code: 'GV.RM-06', cat: 'GV.RM', desc: 'A standardized method for calculating, documenting, categorizing, and prioritizing cybersecurity risks is established and communicated', ex: [
      'Establish criteria for using a quantitative approach to cybersecurity risk analysis, and specify probability and exposure formulas',
      'Create and use templates (e.g., a risk register) to document cybersecurity risk information',
      'Establish criteria for risk prioritization at the appropriate levels within the enterprise',
      'Use a consistent list of risk categories to support integrating, aggregating, and comparing cybersecurity risks'
    ]},
    { code: 'GV.RM-07', cat: 'GV.RM', desc: 'Strategic opportunities (i.e., positive risks) are characterized and are included in organizational cybersecurity risk discussions', ex: [
      'Define and communicate guidance and methods for identifying opportunities and including them in risk discussions (e.g., SWOT analysis)',
      'Identify stretch goals and document them',
      'Calculate, document, and prioritize positive risks alongside negative risks'
    ]},
    // ── GV.RR ───────────────────────────────────────────────────────────────
    { code: 'GV.RR-01', cat: 'GV.RR', desc: 'Organizational leadership is responsible and accountable for cybersecurity risk and fosters a culture that is risk-aware, ethical, and continually improving', ex: [
      'Leaders agree on their roles and responsibilities in developing, implementing, and assessing the organization\'s cybersecurity strategy',
      'Share leaders\' expectations regarding a secure and ethical culture',
      'Leaders direct the CISO to maintain a comprehensive cybersecurity risk strategy and review and update it at least annually',
      'Conduct reviews to ensure adequate authority and coordination among those responsible for managing cybersecurity risk'
    ]},
    { code: 'GV.RR-02', cat: 'GV.RR', desc: 'Roles, responsibilities, and authorities related to cybersecurity risk management are established, communicated, understood, and enforced', ex: [
      'Document risk management roles and responsibilities in policy',
      'Document who is responsible and accountable for cybersecurity risk management activities',
      'Include cybersecurity responsibilities and performance requirements in personnel descriptions',
      'Document performance goals for personnel with cybersecurity risk management responsibilities',
      'Clearly articulate cybersecurity responsibilities within operations, risk functions, and internal audit functions'
    ]},
    { code: 'GV.RR-03', cat: 'GV.RR', desc: 'Adequate resources are allocated commensurate with the cybersecurity risk strategy, roles, responsibilities, and policies', ex: [
      'Conduct periodic management reviews to ensure that those given cybersecurity risk management responsibilities have the necessary authority',
      'Identify resource allocation and investment in line with risk tolerance and response',
      'Provide adequate and sufficient people, process, and technical resources to support the cybersecurity strategy'
    ]},
    { code: 'GV.RR-04', cat: 'GV.RR', desc: 'Cybersecurity is included in human resources practices', ex: [
      'Integrate cybersecurity risk management considerations into human resources processes (e.g., personnel screening, onboarding, change notification, offboarding)',
      'Consider cybersecurity knowledge to be a positive factor in hiring, training, and retention decisions',
      'Conduct background checks prior to onboarding new personnel for sensitive roles',
      'Define and enforce obligations for personnel to be aware of, adhere to, and uphold security policies'
    ]},
    // ── GV.PO ───────────────────────────────────────────────────────────────
    { code: 'GV.PO-01', cat: 'GV.PO', desc: 'Policy for managing cybersecurity risks is established based on organizational context, cybersecurity strategy, and priorities and is communicated and enforced', ex: [
      'Create, disseminate, and maintain an understandable, usable risk management policy with statements of management intent, expectations, and direction',
      'Periodically review policy and supporting processes and procedures to ensure alignment with risk management strategy objectives',
      'Require approval from senior management on policy',
      'Communicate cybersecurity risk management policy and supporting processes and procedures across the organization',
      'Require personnel to acknowledge receipt of policy when first hired, annually, and whenever policy is updated'
    ]},
    { code: 'GV.PO-02', cat: 'GV.PO', desc: 'Policy for managing cybersecurity risks is reviewed, updated, communicated, and enforced to reflect changes in requirements, threats, technology, and organizational mission', ex: [
      'Update policy based on periodic reviews of cybersecurity risk management results',
      'Provide a timeline for reviewing changes to the organization\'s risk environment, and communicate recommended policy updates',
      'Update policy to reflect changes in legal and regulatory requirements',
      'Update policy to reflect changes in technology (e.g., adoption of artificial intelligence) and changes to the business'
    ]},
    // ── GV.OV ───────────────────────────────────────────────────────────────
    { code: 'GV.OV-01', cat: 'GV.OV', desc: 'Cybersecurity risk management strategy outcomes are reviewed to inform and adjust strategy and direction', ex: [
      'Measure how well the risk management strategy and risk results have helped leaders make decisions and achieve organizational objectives',
      'Examine whether cybersecurity risk strategies that impede operations or innovation should be adjusted'
    ]},
    { code: 'GV.OV-02', cat: 'GV.OV', desc: 'The cybersecurity risk management strategy is reviewed and adjusted to ensure coverage of organizational requirements and risks', ex: [
      'Review audit findings to confirm whether the existing cybersecurity strategy has ensured compliance with internal and external requirements',
      'Review the performance oversight of those in cybersecurity-related roles to determine whether policy changes are necessary',
      'Review strategy in light of cybersecurity incidents'
    ]},
    { code: 'GV.OV-03', cat: 'GV.OV', desc: 'Organizational cybersecurity risk management performance is evaluated and reviewed for adjustments needed', ex: [
      'Review key performance indicators (KPIs) to ensure that organization-wide policies and procedures achieve objectives',
      'Review key risk indicators (KRIs) to identify risks the organization faces, including likelihood and potential impact',
      'Collect and communicate metrics on cybersecurity risk management with senior leadership'
    ]},
    // ── GV.SC ───────────────────────────────────────────────────────────────
    { code: 'GV.SC-01', cat: 'GV.SC', desc: 'A cybersecurity supply chain risk management program, strategy, objectives, policies, and processes are established and agreed to by organizational stakeholders', ex: [
      'Establish a strategy that expresses the objectives of the cybersecurity supply chain risk management program',
      'Develop the cybersecurity supply chain risk management program, including a plan (with milestones), policies, and procedures',
      'Develop and implement program processes based on the strategy, objectives, policies, and procedures',
      'Establish a cross-organizational mechanism that ensures alignment between functions that contribute to cybersecurity supply chain risk management'
    ]},
    { code: 'GV.SC-02', cat: 'GV.SC', desc: 'Cybersecurity roles and responsibilities for suppliers, customers, and partners are established, communicated, and coordinated internally and externally', ex: [
      'Identify one or more specific roles or positions that will be responsible and accountable for cybersecurity supply chain risk management activities',
      'Document cybersecurity supply chain risk management roles and responsibilities in policy',
      'Create responsibility matrixes to document who will be responsible and accountable for cybersecurity supply chain risk management activities'
    ]},
    { code: 'GV.SC-03', cat: 'GV.SC', desc: 'Cybersecurity supply chain risk management is integrated into cybersecurity and enterprise risk management, risk assessment, and improvement processes', ex: [
      'Identify areas of alignment and overlap with cybersecurity and enterprise risk management',
      'Establish integrated control sets for cybersecurity risk management and cybersecurity supply chain risk management',
      'Integrate cybersecurity supply chain risk management into improvement processes',
      'Escalate material cybersecurity risks in supply chains to senior management'
    ]},
    { code: 'GV.SC-04', cat: 'GV.SC', desc: 'Suppliers are known and prioritized by criticality', ex: [
      'Develop criteria for supplier criticality based on, for example, the sensitivity of data processed or possessed by suppliers and the degree of access to the organization\'s systems',
      'Keep a record of all suppliers, and prioritize suppliers based on the criticality criteria'
    ]},
    { code: 'GV.SC-05', cat: 'GV.SC', desc: 'Requirements to address cybersecurity risks in supply chains are established, prioritized, and integrated into contracts and other types of agreements with suppliers and other relevant third parties', ex: [
      'Establish security requirements for suppliers, products, and services commensurate with their criticality level and potential impact if compromised',
      'Include all cybersecurity and supply chain requirements that third parties must follow in default contractual language',
      'Define the rules and protocols for information sharing between the organization and its suppliers and sub-tier suppliers in agreements'
    ]},
    { code: 'GV.SC-06', cat: 'GV.SC', desc: 'Planning and due diligence are performed to reduce risks before entering into formal supplier or other third-party relationships', ex: [
      'Perform thorough due diligence on prospective suppliers that is consistent with procurement planning and commensurate with the level of risk',
      'Assess the suitability of the technology and cybersecurity capabilities and the risk management practices of prospective suppliers',
      'Conduct supplier risk assessments against business and applicable cybersecurity requirements',
      'Assess the authenticity, integrity, and security of critical products prior to acquisition and use'
    ]},
    { code: 'GV.SC-07', cat: 'GV.SC', desc: 'The risks posed by a supplier, their products and services, and other third parties are understood, recorded, prioritized, assessed, responded to, and monitored over the course of the relationship', ex: [
      'Adjust assessment formats and frequencies based on the third party\'s reputation and the criticality of the products or services they provide',
      'Evaluate third parties\' evidence of compliance with contractual cybersecurity requirements',
      'Monitor critical suppliers to ensure that they are fulfilling their security obligations throughout the supplier relationship lifecycle'
    ]},
    { code: 'GV.SC-08', cat: 'GV.SC', desc: 'Relevant suppliers and other third parties are included in incident planning, response, and recovery activities', ex: [
      'Define and use rules and protocols for reporting incident response and recovery activities and the status between the organization and its suppliers',
      'Identify and document the roles and responsibilities of the organization and its suppliers for incident response',
      'Include critical suppliers in incident response exercises and simulations',
      'Define and coordinate crisis communication methods and protocols between the organization and its critical suppliers'
    ]},
    { code: 'GV.SC-09', cat: 'GV.SC', desc: 'Supply chain security practices are integrated into cybersecurity and enterprise risk management programs, and their performance is monitored throughout the technology product and service life cycle', ex: [
      'Policies and procedures require provenance records for all acquired technology products and services',
      'Periodically provide risk reporting to leaders about how acquired components are proven to be untampered and authentic',
      'Communicate regularly among cybersecurity risk managers and operations personnel about the need to acquire software patches, updates, and upgrades only from authenticated and trustworthy software providers'
    ]},
    { code: 'GV.SC-10', cat: 'GV.SC', desc: 'Cybersecurity supply chain risk management plans include provisions for activities that occur after the conclusion of a partnership or service agreement', ex: [
      'Establish processes for terminating critical relationships under both normal and adverse circumstances',
      'Define and implement plans for component end-of-life maintenance support and obsolescence',
      'Verify that supplier access to organization resources is deactivated promptly when it is no longer needed',
      'Verify that assets containing the organization\'s data are returned or properly disposed of in a timely, controlled, and safe manner'
    ]},
    // ── ID.AM ───────────────────────────────────────────────────────────────
    { code: 'ID.AM-01', cat: 'ID.AM', desc: 'Inventories of hardware managed by the organization are maintained', ex: [
      'Maintain inventories for all types of hardware, including IT, IoT, OT, and mobile devices',
      'Constantly monitor networks to detect new hardware and automatically update inventories'
    ]},
    { code: 'ID.AM-02', cat: 'ID.AM', desc: 'Inventories of software, services, and systems managed by the organization are maintained', ex: [
      'Maintain inventories for all types of software and services, including commercial-off-the-shelf, open-source, custom applications, API services, and cloud-based applications and services',
      'Constantly monitor all platforms, including containers and virtual machines, for software and service inventory changes',
      'Maintain an inventory of the organization\'s systems'
    ]},
    { code: 'ID.AM-03', cat: 'ID.AM', desc: 'Representations of the organization\'s authorized network communication and internal and external network data flows are maintained', ex: [
      'Maintain baselines of communication and data flows within the organization\'s wired and wireless networks',
      'Maintain baselines of communication and data flows between the organization and third parties',
      'Maintain baselines of communication and data flows for the organization\'s infrastructure-as-a-service (IaaS) usage',
      'Maintain documentation of expected network ports, protocols, and services that are typically used among authorized systems'
    ]},
    { code: 'ID.AM-04', cat: 'ID.AM', desc: 'Inventories of services provided by suppliers are maintained', ex: [
      'Inventory all external services used by the organization, including third-party IaaS, PaaS, and SaaS offerings; APIs; and other externally hosted application services',
      'Update the inventory when a new external service is going to be utilized'
    ]},
    { code: 'ID.AM-05', cat: 'ID.AM', desc: 'Assets are prioritized based on classification, criticality, resources, and impact on the mission', ex: [
      'Define criteria for prioritizing each class of assets',
      'Apply the prioritization criteria to assets',
      'Track the asset priorities and update them periodically or when significant changes to the organization occur'
    ]},
    { code: 'ID.AM-07', cat: 'ID.AM', desc: 'Inventories of data and corresponding metadata for designated data types are maintained', ex: [
      'Maintain a list of the designated data types of interest (e.g., personally identifiable information, protected health information, financial account numbers, organization intellectual property)',
      'Continuously discover and analyze ad hoc data to identify new instances of designated data types',
      'Assign data classifications to designated data types through tags or labels',
      'Track the provenance, data owner, and geolocation of each instance of designated data types'
    ]},
    { code: 'ID.AM-08', cat: 'ID.AM', desc: 'Systems, hardware, software, services, and data are managed throughout their life cycles', ex: [
      'Integrate cybersecurity considerations throughout the life cycles of systems, hardware, software, and services',
      'Integrate cybersecurity considerations into product life cycles',
      'Identify unofficial uses of technology to meet mission objectives (i.e., shadow IT)',
      'Periodically identify redundant systems, hardware, software, and services that unnecessarily increase the organization\'s attack surface'
    ]},
    // ── ID.RA ───────────────────────────────────────────────────────────────
    { code: 'ID.RA-01', cat: 'ID.RA', desc: 'Vulnerabilities in assets are identified, validated, and recorded', ex: [
      'Use vulnerability management technologies to identify unpatched and misconfigured software',
      'Assess network and system architectures for design and implementation weaknesses that affect cybersecurity',
      'Review, analyze, or test organization-developed software to identify design, coding, and default configuration vulnerabilities',
      'Monitor sources of cyber threat intelligence for information on new vulnerabilities in products and services'
    ]},
    { code: 'ID.RA-02', cat: 'ID.RA', desc: 'Cyber threat intelligence is received from information sharing forums and sources', ex: [
      'Configure cybersecurity tools and technologies with detection or response capabilities to securely ingest cyber threat intelligence feeds',
      'Receive and review advisories from reputable third parties on current threat actors and their tactics, techniques, and procedures (TTPs)',
      'Monitor sources of cyber threat intelligence for information on the types of vulnerabilities that emerging technologies may have'
    ]},
    { code: 'ID.RA-03', cat: 'ID.RA', desc: 'Internal and external threats to the organization are identified and recorded', ex: [
      'Use cyber threat intelligence to maintain awareness of the types of threat actors likely to target the organization and the TTPs they are likely to use',
      'Perform threat hunting to look for signs of threat actors within the environment',
      'Implement processes for identifying internal threat actors'
    ]},
    { code: 'ID.RA-04', cat: 'ID.RA', desc: 'Potential impacts and likelihoods of threats exploiting vulnerabilities are identified and recorded', ex: [
      'Business leaders and cybersecurity risk management practitioners work together to estimate the likelihood and impact of risk scenarios',
      'Enumerate the potential business impacts of unauthorized access to the organization\'s communications, systems, and data',
      'Account for the potential impacts of cascading failures for systems of systems'
    ]},
    { code: 'ID.RA-05', cat: 'ID.RA', desc: 'Threats, vulnerabilities, likelihoods, and impacts are used to understand inherent risk and inform risk response prioritization', ex: [
      'Develop threat models to better understand risks to the data and identify appropriate risk responses',
      'Prioritize cybersecurity resource allocations and investments based on estimated likelihoods and impacts'
    ]},
    { code: 'ID.RA-06', cat: 'ID.RA', desc: 'Risk responses are chosen, prioritized, planned, tracked, and communicated', ex: [
      'Apply the vulnerability management plan\'s criteria for deciding whether to accept, transfer, mitigate, or avoid risk',
      'Apply the vulnerability management plan\'s criteria for selecting compensating controls to mitigate risk',
      'Track the progress of risk response implementation (e.g., plan of action and milestones, risk register)',
      'Use risk assessment findings to inform risk response decisions and actions',
      'Communicate planned risk responses to affected stakeholders in priority order'
    ]},
    { code: 'ID.RA-07', cat: 'ID.RA', desc: 'Changes and exceptions are managed, assessed for risk impact, recorded, and tracked', ex: [
      'Implement and follow procedures for the formal documentation, review, testing, and approval of proposed changes and requested exceptions',
      'Document the possible risks of making or not making each proposed change, and provide guidance on rolling back changes',
      'Document the risks related to each requested exception and the plan for responding to those risks',
      'Periodically review risks that were accepted based upon planned future actions or milestones'
    ]},
    { code: 'ID.RA-08', cat: 'ID.RA', desc: 'Processes for receiving, analyzing, and responding to vulnerability disclosures are established', ex: [
      'Conduct vulnerability information sharing between the organization and its suppliers following the rules and protocols defined in contracts',
      'Assign responsibilities and verify the execution of procedures for processing, analyzing the impact of, and responding to cybersecurity threat, vulnerability, or incident disclosures'
    ]},
    { code: 'ID.RA-09', cat: 'ID.RA', desc: 'The authenticity and integrity of hardware and software are assessed prior to acquisition and use', ex: [
      'Assess the authenticity and cybersecurity of critical technology products and services prior to acquisition and use'
    ]},
    { code: 'ID.RA-10', cat: 'ID.RA', desc: 'Critical suppliers are assessed prior to acquisition', ex: [
      'Conduct supplier risk assessments against business and applicable cybersecurity requirements, including the supply chain'
    ]},
    // ── ID.IM ───────────────────────────────────────────────────────────────
    { code: 'ID.IM-01', cat: 'ID.IM', desc: 'Improvements are identified from evaluations', ex: [
      'Perform self-assessments of critical services that take current threats and TTPs into consideration',
      'Invest in third-party assessments or independent audits of the effectiveness of the organization\'s cybersecurity program',
      'Constantly evaluate compliance with selected cybersecurity requirements through automated means'
    ]},
    { code: 'ID.IM-02', cat: 'ID.IM', desc: 'Improvements are identified from security tests and exercises, including those done in coordination with suppliers and relevant third parties', ex: [
      'Identify improvements for future incident response activities based on findings from incident response assessments',
      'Identify improvements based on exercises performed in coordination with critical service providers and product suppliers',
      'Perform penetration testing to identify opportunities to improve the security posture of selected high-risk systems',
      'Collect and analyze performance metrics using security tools and services to inform improvements to the cybersecurity program'
    ]},
    { code: 'ID.IM-03', cat: 'ID.IM', desc: 'Improvements are identified from execution of operational processes, procedures, and activities', ex: [
      'Conduct collaborative lessons learned sessions with suppliers',
      'Annually review cybersecurity policies, processes, and procedures to take lessons learned into account',
      'Use metrics to assess operational cybersecurity performance over time'
    ]},
    { code: 'ID.IM-04', cat: 'ID.IM', desc: 'Incident response plans and other cybersecurity plans that affect operations are established, communicated, maintained, and improved', ex: [
      'Establish contingency plans (e.g., incident response, business continuity, disaster recovery) for responding to and recovering from adverse events',
      'Include contact and communication information, processes for handling common scenarios, and criteria for prioritization, escalation, and elevation in all contingency plans',
      'Create a vulnerability management plan to identify and assess all types of vulnerabilities and to prioritize, test, and implement risk responses',
      'Review and update all cybersecurity plans annually or when a need for significant improvements is identified'
    ]},
    // ── PR.AA ───────────────────────────────────────────────────────────────
    { code: 'PR.AA-01', cat: 'PR.AA', desc: 'Identities and credentials for authorized users, services, and hardware are managed by the organization', ex: [
      'Initiate requests for new access or additional access for employees, contractors, and others, and track, review, and fulfill the requests',
      'Issue, manage, and revoke cryptographic certificates and identity tokens, cryptographic keys (i.e., key management), and other credentials',
      'Select a unique identifier for each device from immutable hardware characteristics or an identifier securely provisioned to the device',
      'Physically label authorized hardware with an identifier for inventory and servicing purposes'
    ]},
    { code: 'PR.AA-02', cat: 'PR.AA', desc: 'Identities are proofed and bound to credentials based on the context of interactions', ex: [
      'Verify a person\'s claimed identity at enrollment time using government-issued identity credentials (e.g., passport, visa, driver\'s license)',
      'Issue a different credential for each person (i.e., no credential sharing)'
    ]},
    { code: 'PR.AA-03', cat: 'PR.AA', desc: 'Users, services, and hardware are authenticated', ex: [
      'Require multifactor authentication',
      'Enforce policies for the minimum strength of passwords, PINs, and similar authenticators',
      'Periodically reauthenticate users, services, and hardware based on risk (e.g., in zero trust architectures)',
      'Ensure that authorized personnel can access accounts essential for protecting safety under emergency conditions'
    ]},
    { code: 'PR.AA-04', cat: 'PR.AA', desc: 'Identity assertions are protected, conveyed, and verified', ex: [
      'Protect identity assertions that are used to convey authentication and user information through single sign-on systems',
      'Protect identity assertions that are used to convey authentication and user information between federated systems',
      'Implement standards-based approaches for identity assertions in all contexts'
    ]},
    { code: 'PR.AA-05', cat: 'PR.AA', desc: 'Access permissions, entitlements, and authorizations are defined in a policy, managed, enforced, and reviewed, and incorporate the principles of least privilege and separation of duties', ex: [
      'Review logical and physical access privileges periodically and whenever someone changes roles or leaves the organization',
      'Take attributes of the requester and the requested resource into account for authorization decisions',
      'Restrict access and privileges to the minimum necessary (e.g., zero trust architecture)',
      'Periodically review the privileges associated with critical business functions to confirm proper separation of duties'
    ]},
    { code: 'PR.AA-06', cat: 'PR.AA', desc: 'Physical access to assets is managed, monitored, and enforced commensurate with risk', ex: [
      'Use security guards, security cameras, locked entrances, alarm systems, and other physical controls to monitor facilities and restrict access',
      'Employ additional physical security controls for areas that contain high-risk assets',
      'Escort guests, vendors, and other third parties within areas that contain business-critical assets'
    ]},
    // ── PR.AT ───────────────────────────────────────────────────────────────
    { code: 'PR.AT-01', cat: 'PR.AT', desc: 'Personnel are provided with awareness and training so that they possess the knowledge and skills to perform general tasks with cybersecurity risks in mind', ex: [
      'Provide basic cybersecurity awareness and training to employees, contractors, partners, suppliers, and all other users of the organization\'s non-public resources',
      'Train personnel to recognize social engineering attempts and other common attacks, report attacks and suspicious activity, comply with acceptable use policies',
      'Explain the consequences of cybersecurity policy violations, both to individual users and the organization as a whole',
      'Periodically assess or test users on their understanding of basic cybersecurity practices',
      'Require annual refreshers to reinforce existing practices and introduce new practices'
    ]},
    { code: 'PR.AT-02', cat: 'PR.AT', desc: 'Individuals in specialized roles are provided with awareness and training so that they possess the knowledge and skills to perform relevant tasks with cybersecurity risks in mind', ex: [
      'Identify the specialized roles within the organization that require additional cybersecurity training, such as physical and cybersecurity personnel, finance personnel, senior leadership',
      'Provide role-based cybersecurity awareness and training to all those in specialized roles, including contractors, partners, suppliers, and other third parties',
      'Periodically assess or test users on their understanding of cybersecurity practices for their specialized roles',
      'Require annual refreshers to reinforce existing practices and introduce new practices'
    ]},
    // ── PR.DS ───────────────────────────────────────────────────────────────
    { code: 'PR.DS-01', cat: 'PR.DS', desc: 'The confidentiality, integrity, and availability of data-at-rest are protected', ex: [
      'Use encryption, digital signatures, and cryptographic hashes to protect the confidentiality and integrity of stored data',
      'Use full disk encryption to protect data stored on user endpoints',
      'Confirm the integrity of software by validating signatures',
      'Restrict the use of removable media to prevent data exfiltration',
      'Physically secure removable media containing unencrypted sensitive information'
    ]},
    { code: 'PR.DS-02', cat: 'PR.DS', desc: 'The confidentiality, integrity, and availability of data-in-transit are protected', ex: [
      'Use encryption, digital signatures, and cryptographic hashes to protect the confidentiality and integrity of network communications',
      'Automatically encrypt or block outbound emails and other communications that contain sensitive data',
      'Block access to personal email, file sharing, file storage services from organizational systems and networks',
      'Prevent reuse of sensitive data from production environments in development, testing, and other non-production environments'
    ]},
    { code: 'PR.DS-10', cat: 'PR.DS', desc: 'The confidentiality, integrity, and availability of data-in-use are protected', ex: [
      'Remove data that must remain confidential (e.g., from processors and memory) as soon as it is no longer needed',
      'Protect data in use from access by other users and processes of the same platform'
    ]},
    { code: 'PR.DS-11', cat: 'PR.DS', desc: 'Backups of data are created, protected, maintained, and tested', ex: [
      'Continuously back up critical data in near-real-time, and back up other data frequently at agreed-upon schedules',
      'Test backups and restores for all types of data sources at least annually',
      'Securely store some backups offline and offsite so that an incident or disaster will not damage them',
      'Enforce geographic separation and geolocation restrictions for data backup storage'
    ]},
    // ── PR.PS ───────────────────────────────────────────────────────────────
    { code: 'PR.PS-01', cat: 'PR.PS', desc: 'Configuration management practices are established and applied', ex: [
      'Establish, test, deploy, and maintain hardened baselines that enforce the organization\'s cybersecurity policies and provide only essential capabilities (i.e., principle of least functionality)',
      'Review all default configuration settings that may potentially impact cybersecurity when installing or upgrading software',
      'Monitor implemented software for deviations from approved baselines'
    ]},
    { code: 'PR.PS-02', cat: 'PR.PS', desc: 'Software is maintained, replaced, and removed commensurate with risk', ex: [
      'Perform routine and emergency patching within the timeframes specified in the vulnerability management plan',
      'Update container images, and deploy new container instances to replace rather than update existing instances',
      'Replace end-of-life software and service versions with supported, maintained versions',
      'Uninstall and remove unauthorized software and services that pose undue risks',
      'Define and implement plans for software and service end-of-life maintenance support and obsolescence'
    ]},
    { code: 'PR.PS-03', cat: 'PR.PS', desc: 'Hardware is maintained, replaced, and removed commensurate with risk', ex: [
      'Replace hardware when it lacks needed security capabilities or when it cannot support software with needed security capabilities',
      'Define and implement plans for hardware end-of-life maintenance support and obsolescence',
      'Perform hardware disposal in a secure, responsible, and auditable manner'
    ]},
    { code: 'PR.PS-04', cat: 'PR.PS', desc: 'Log records are generated and made available for continuous monitoring', ex: [
      'Configure all operating systems, applications, and services (including cloud-based services) to generate log records',
      'Configure log generators to securely share their logs with the organization\'s logging infrastructure systems and services',
      'Configure log generators to record the data needed by zero-trust architectures'
    ]},
    { code: 'PR.PS-05', cat: 'PR.PS', desc: 'Installation and execution of unauthorized software are prevented', ex: [
      'Restrict software execution to permitted products only or deny the execution of prohibited and unauthorized software',
      'Verify the source of new software and the software\'s integrity before installing it',
      'Configure platforms to use only approved DNS services that block access to known malicious domains',
      'Configure platforms to allow the installation of organization-approved software only'
    ]},
    { code: 'PR.PS-06', cat: 'PR.PS', desc: 'Secure software development practices are integrated, and their performance is monitored throughout the software development life cycle', ex: [
      'Protect all components of organization-developed software from tampering and unauthorized access',
      'Secure all software produced by the organization, with minimal vulnerabilities in their releases',
      'Maintain the software used in production environments, and securely dispose of software once it is no longer needed'
    ]},
    // ── PR.IR ───────────────────────────────────────────────────────────────
    { code: 'PR.IR-01', cat: 'PR.IR', desc: 'Networks and environments are protected from unauthorized logical access and usage', ex: [
      'Logically segment organization networks and cloud-based platforms according to trust boundaries and platform types (e.g., IT, IoT, OT, mobile, guests)',
      'Logically segment organization networks from external networks, and permit only necessary communications',
      'Implement zero trust architectures to restrict network access to each resource to the minimum necessary',
      'Check the cyber health of endpoints before allowing them to access and use production resources'
    ]},
    { code: 'PR.IR-02', cat: 'PR.IR', desc: 'The organization\'s technology assets are protected from environmental threats', ex: [
      'Protect organizational equipment from known environmental threats, such as flooding, fire, wind, and excessive heat and humidity',
      'Include protection from environmental threats and provisions for adequate operating infrastructure in requirements for service providers'
    ]},
    { code: 'PR.IR-03', cat: 'PR.IR', desc: 'Mechanisms are implemented to achieve resilience requirements in normal and adverse situations', ex: [
      'Avoid single points of failure in systems and infrastructure',
      'Use load balancing to increase capacity and improve reliability',
      'Use high-availability components like redundant storage and power supplies to improve system reliability'
    ]},
    { code: 'PR.IR-04', cat: 'PR.IR', desc: 'Adequate resource capacity to ensure availability is maintained', ex: [
      'Monitor usage of storage, power, compute, network bandwidth, and other resources',
      'Forecast future needs, and scale resources accordingly'
    ]},
    // ── DE.AE ───────────────────────────────────────────────────────────────
    { code: 'DE.AE-02', cat: 'DE.AE', desc: 'Potentially adverse events are analyzed to better understand associated activities', ex: [
      'Use security information and event management (SIEM) or other tools to continuously monitor log events for known malicious and suspicious activity',
      'Utilize up-to-date cyber threat intelligence in log analysis tools to improve detection accuracy',
      'Regularly conduct manual reviews of log events for technologies that cannot be sufficiently monitored through automation',
      'Use log analysis tools to generate reports on their findings'
    ]},
    { code: 'DE.AE-03', cat: 'DE.AE', desc: 'Information is correlated from multiple sources', ex: [
      'Constantly transfer log data generated by other sources to a relatively small number of log servers',
      'Use event correlation technology (e.g., SIEM) to collect information captured by multiple sources',
      'Utilize cyber threat intelligence to help correlate events among log sources'
    ]},
    { code: 'DE.AE-04', cat: 'DE.AE', desc: 'The estimated impact and scope of adverse events are understood', ex: [
      'Use SIEMs or other tools to estimate impact and scope, and review and refine the estimates',
      'A person creates their own estimates of impact and scope'
    ]},
    { code: 'DE.AE-06', cat: 'DE.AE', desc: 'Information on adverse events is provided to authorized staff and tools', ex: [
      'Use cybersecurity software to generate alerts and provide them to the security operations center (SOC), incident responders, and incident response tools',
      'Incident responders and other authorized personnel can access log analysis findings at all times',
      'Automatically create and assign tickets in the organization\'s ticketing system when certain types of alerts occur',
      'Manually create and assign tickets in the organization\'s ticketing system when technical staff discover indicators of compromise'
    ]},
    { code: 'DE.AE-07', cat: 'DE.AE', desc: 'Cyber threat intelligence and other contextual information are integrated into the analysis', ex: [
      'Securely provide cyber threat intelligence feeds to detection technologies, processes, and personnel',
      'Securely provide information from asset inventories to detection technologies, processes, and personnel',
      'Rapidly acquire and analyze vulnerability disclosures for the organization\'s technologies from suppliers, vendors, and third-party security advisories'
    ]},
    { code: 'DE.AE-08', cat: 'DE.AE', desc: 'Incidents are declared when adverse events meet the defined incident criteria', ex: [
      'Apply incident criteria to known and assumed characteristics of activity in order to determine whether an incident should be declared',
      'Take known false positives into account when applying incident criteria'
    ]},
    // ── DE.CM ───────────────────────────────────────────────────────────────
    { code: 'DE.CM-01', cat: 'DE.CM', desc: 'Networks and network services are monitored to find potentially adverse events', ex: [
      'Monitor DNS, BGP, and other network services for adverse events',
      'Monitor wired and wireless networks for connections from unauthorized endpoints',
      'Monitor facilities for unauthorized or rogue wireless networks',
      'Compare actual network flows against baselines to detect deviations',
      'Monitor network communications to identify changes in security postures for zero trust purposes'
    ]},
    { code: 'DE.CM-02', cat: 'DE.CM', desc: 'The physical environment is monitored to find potentially adverse events', ex: [
      'Monitor logs from physical access control systems (e.g., badge readers) to find unusual access patterns and failed access attempts',
      'Review and monitor physical access records (e.g., from visitor registration, sign-in sheets)',
      'Monitor physical access controls (e.g., locks, latches, hinge pins, alarms) for signs of tampering',
      'Monitor the physical environment using alarm systems, cameras, and security guards'
    ]},
    { code: 'DE.CM-03', cat: 'DE.CM', desc: 'Personnel activity and technology usage are monitored to find potentially adverse events', ex: [
      'Use behavior analytics software to detect anomalous user activity to mitigate insider threats',
      'Monitor logs from logical access control systems to find unusual access patterns and failed access attempts',
      'Continuously monitor deception technology, including user accounts, for any usage'
    ]},
    { code: 'DE.CM-06', cat: 'DE.CM', desc: 'External service provider activities and services are monitored to find potentially adverse events', ex: [
      'Monitor remote and onsite administration and maintenance activities that external providers perform on organizational systems',
      'Monitor activity from cloud-based services, internet service providers, and other service providers for deviations from expected behavior'
    ]},
    { code: 'DE.CM-09', cat: 'DE.CM', desc: 'Computing hardware and software, runtime environments, and their data are monitored to find potentially adverse events', ex: [
      'Monitor email, web, file sharing, collaboration services, and other common attack vectors to detect malware, phishing, data leaks and exfiltration',
      'Monitor authentication attempts to identify attacks against credentials and unauthorized credential reuse',
      'Monitor software configurations for deviations from security baselines',
      'Monitor hardware and software for signs of tampering',
      'Use technologies with a presence on endpoints to detect cyber health issues (e.g., missing patches, malware infections, unauthorized software)'
    ]},
    // ── RS.MA ───────────────────────────────────────────────────────────────
    { code: 'RS.MA-01', cat: 'RS.MA', desc: 'The incident response plan is executed in coordination with relevant third parties once an incident is declared', ex: [
      'Detection technologies automatically report confirmed incidents',
      'Request incident response assistance from the organization\'s incident response outsourcer',
      'Designate an incident lead for each incident',
      'Initiate execution of additional cybersecurity plans as needed to support incident response (e.g., business continuity and disaster recovery)'
    ]},
    { code: 'RS.MA-02', cat: 'RS.MA', desc: 'Incident reports are triaged and validated', ex: [
      'Preliminarily review incident reports to confirm that they are cybersecurity-related and necessitate incident response activities',
      'Apply criteria to estimate the severity of an incident'
    ]},
    { code: 'RS.MA-03', cat: 'RS.MA', desc: 'Incidents are categorized and prioritized', ex: [
      'Further review and categorize incidents based on the type of incident (e.g., data breach, ransomware, DDoS, account compromise)',
      'Prioritize incidents based on their scope, likely impact, and time-critical nature',
      'Select incident response strategies for active incidents by balancing the need to quickly recover from an incident with the need to observe the attacker or conduct a more thorough investigation'
    ]},
    { code: 'RS.MA-04', cat: 'RS.MA', desc: 'Incidents are escalated or elevated as needed', ex: [
      'Track and validate the status of all ongoing incidents',
      'Coordinate incident escalation or elevation with designated internal and external stakeholders'
    ]},
    { code: 'RS.MA-05', cat: 'RS.MA', desc: 'The criteria for initiating incident recovery are applied', ex: [
      'Apply incident recovery criteria to known and assumed characteristics of the incident to determine whether incident recovery processes should be initiated',
      'Take the possible operational disruption of incident recovery activities into account'
    ]},
    // ── RS.AN ───────────────────────────────────────────────────────────────
    { code: 'RS.AN-03', cat: 'RS.AN', desc: 'Analysis is performed to establish what has taken place during an incident and the root cause of the incident', ex: [
      'Determine the sequence of events that occurred during the incident and which assets and resources were involved in each event',
      'Attempt to determine what vulnerabilities, threats, and threat actors were directly or indirectly involved in the incident',
      'Analyze the incident to find the underlying, systemic root causes',
      'Check any cyber deception technology for additional information on attacker behavior'
    ]},
    { code: 'RS.AN-06', cat: 'RS.AN', desc: 'Actions performed during an investigation are recorded, and the records\' integrity and provenance are preserved', ex: [
      'Require each incident responder who performs incident response tasks to record their actions and make the record immutable',
      'Require the incident lead to document the incident in detail and be responsible for preserving the integrity of the documentation'
    ]},
    { code: 'RS.AN-07', cat: 'RS.AN', desc: 'Incident data and metadata are collected, and their integrity and provenance are preserved', ex: [
      'Collect, preserve, and safeguard the integrity of all pertinent incident data and metadata (e.g., data source, date/time of collection) based on evidence preservation and chain-of-custody procedures'
    ]},
    { code: 'RS.AN-08', cat: 'RS.AN', desc: 'An incident\'s magnitude is estimated and validated', ex: [
      'Review other potential targets of the incident to search for indicators of compromise and evidence of persistence',
      'Automatically run tools on targets to look for indicators of compromise and evidence of persistence'
    ]},
    // ── RS.CO ───────────────────────────────────────────────────────────────
    { code: 'RS.CO-02', cat: 'RS.CO', desc: 'Internal and external stakeholders are notified of incidents', ex: [
      'Follow the organization\'s breach notification procedures after discovering a data breach incident, including notifying affected customers',
      'Notify business partners and customers of incidents in accordance with contractual requirements',
      'Notify law enforcement agencies and regulatory bodies of incidents based on criteria in the incident response plan'
    ]},
    { code: 'RS.CO-03', cat: 'RS.CO', desc: 'Information is shared with designated internal and external stakeholders', ex: [
      'Securely share information consistent with response plans and information sharing agreements',
      'Voluntarily share information about an attacker\'s observed TTPs, with all sensitive data removed, with an ISAC',
      'Notify HR when malicious insider activity occurs',
      'Regularly update senior leadership on the status of major incidents',
      'Follow the rules and protocols defined in contracts for incident information sharing between the organization and its suppliers'
    ]},
    // ── RS.MI ───────────────────────────────────────────────────────────────
    { code: 'RS.MI-01', cat: 'RS.MI', desc: 'Incidents are contained', ex: [
      'Cybersecurity technologies (e.g., antivirus software) and cybersecurity features of other technologies automatically perform containment actions',
      'Allow incident responders to manually select and perform containment actions',
      'Allow a third party (e.g., internet service provider, managed security service provider) to perform containment actions on behalf of the organization',
      'Automatically transfer compromised endpoints to a remediation virtual local area network (VLAN)'
    ]},
    { code: 'RS.MI-02', cat: 'RS.MI', desc: 'Incidents are eradicated', ex: [
      'Cybersecurity technologies and cybersecurity features of other technologies automatically perform eradication actions',
      'Allow incident responders to manually select and perform eradication actions',
      'Allow a third party (e.g., managed security service provider) to perform eradication actions on behalf of the organization'
    ]},
    // ── RC.RP ───────────────────────────────────────────────────────────────
    { code: 'RC.RP-01', cat: 'RC.RP', desc: 'The recovery portion of the incident response plan is executed once initiated from the incident response process', ex: [
      'Begin recovery procedures during or after incident response processes',
      'Make all individuals with recovery responsibilities aware of the plans for recovery and the authorizations required to implement each aspect of the plans'
    ]},
    { code: 'RC.RP-02', cat: 'RC.RP', desc: 'Recovery actions are selected, scoped, prioritized, and performed', ex: [
      'Select recovery actions based on the criteria defined in the incident response plan and available resources',
      'Change planned recovery actions based on a reassessment of organizational needs and resources'
    ]},
    { code: 'RC.RP-03', cat: 'RC.RP', desc: 'The integrity of backups and other restoration assets is verified before using them for restoration', ex: [
      'Check restoration assets for indicators of compromise, file corruption, and other integrity issues before use'
    ]},
    { code: 'RC.RP-04', cat: 'RC.RP', desc: 'Critical mission functions and cybersecurity risk management are considered to establish post-incident operational norms', ex: [
      'Use business impact and system categorization records (including service delivery objectives) to validate that essential services are restored in the appropriate order',
      'Work with system owners to confirm the successful restoration of systems and the return to normal operations',
      'Monitor the performance of restored systems to verify the adequacy of the restoration'
    ]},
    { code: 'RC.RP-05', cat: 'RC.RP', desc: 'The integrity of restored assets is verified, systems and services are restored, and normal operating status is confirmed', ex: [
      'Check restored assets for indicators of compromise and remediation of root causes of the incident before production use',
      'Verify the correctness and adequacy of the restoration actions taken before putting a restored system online'
    ]},
    { code: 'RC.RP-06', cat: 'RC.RP', desc: 'The end of incident recovery is declared based on criteria, and incident-related documentation is completed', ex: [
      'Prepare an after-action report that documents the incident itself, the response and recovery actions taken, and lessons learned',
      'Declare the end of incident recovery once the criteria are met'
    ]},
    // ── RC.CO ───────────────────────────────────────────────────────────────
    { code: 'RC.CO-03', cat: 'RC.CO', desc: 'Recovery activities and progress in restoring operational capabilities are communicated to designated internal and external stakeholders', ex: [
      'Securely share recovery information, including restoration progress, consistent with response plans and information sharing agreements',
      'Regularly update senior leadership on recovery status and restoration progress for major incidents',
      'Follow the rules and protocols defined in contracts for incident information sharing between the organization and its suppliers',
      'Coordinate crisis communication between the organization and its critical suppliers'
    ]},
    { code: 'RC.CO-04', cat: 'RC.CO', desc: 'Public updates on incident recovery are shared using approved methods and messaging', ex: [
      'Follow the organization\'s breach notification procedures for recovering from a data breach incident',
      'Explain the steps being taken to recover from the incident and to prevent a recurrence'
    ]},
  ];

  const insSub = db.prepare('INSERT INTO subcategories (code, description, category_id) VALUES (?, ?, ?)');
  const insEx  = db.prepare('INSERT INTO examples (subcategory_id, number, text) VALUES (?, ?, ?)');

  subs.forEach(s => {
    const info = insSub.run(s.code, s.desc, catMap[s.cat]);
    s.ex.forEach((e, i) => insEx.run(info.lastInsertRowid, i + 1, e));
  });

  console.log('Database seeded successfully.');
}

seedDatabase();

// Demo sandbox user (idempotente — se crea solo si no existe)
(function seedDemoUser() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('demo');
  if (!existing) {
    const demoHash = bcrypt.hashSync('demo-sandbox-2024', 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('demo', demoHash, 'DEMO');
  }
})();

// ─── Import KRIs from Excel ───────────────────────────────────────────────────

function importKRIsFromExcel() {
  const kriCount = db.prepare('SELECT COUNT(*) as c FROM kris').get().c;
  if (kriCount > 0) return; // already imported

  const xlsxPath = path.join(__dirname, 'KRIs.xlsx');
  if (!require('fs').existsSync(xlsxPath)) {
    console.log('KRIs.xlsx not found, skipping import.');
    return;
  }

  console.log('Importing KRIs from KRIs.xlsx...');
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1); // skip header

  const getSubId  = db.prepare('SELECT id FROM subcategories WHERE code = ?');
  const getExisting = db.prepare('SELECT id FROM kris WHERE subcategory_id = ? LIMIT 1');
  const insertKri = db.prepare(`
    INSERT INTO kris (subcategory_id, kri_name, kri_description, kri_formula,
                      cmmi_flag, cmmi_levels, valoracion)
    VALUES (?,?,?,?,?,?,?)
  `);
  const updateKri = db.prepare(`
    UPDATE kris SET kri_name=?, kri_description=?, kri_formula=?,
      cmmi_flag=?, cmmi_levels=?, valoracion=?, updated_at=datetime('now')
    WHERE id=?
  `);

  let imported = 0, skipped = 0;
  const importAll = db.transaction(() => {
    rows.forEach(r => {
      const rawCode = String(r[2] || '');
      const match   = rawCode.match(/^([A-Z]{2}\.[A-Z]{2}-\d+)/);
      if (!match) { skipped++; return; }
      const code = match[1];
      const sub  = getSubId.get(code);
      if (!sub) { skipped++; return; }

      const name   = String(r[4]  || '').trim();
      const desc   = String(r[5]  || '').trim();
      const formula= String(r[6]  || '').trim();
      const flag   = String(r[9]  || '').trim() || null;
      const levels = String(r[8]  || '').trim();
      const val    = r[7] != null ? parseFloat(r[7]) : null;
      const existing = getExisting.get(sub.id);
      if (existing) {
        updateKri.run(name, desc, formula, flag, levels, val, existing.id);
      } else {
        insertKri.run(sub.id, name, desc, formula, flag, levels, val);
      }
      imported++;
    });
  });
  importAll();
  console.log(`KRIs imported: ${imported} rows (${skipped} skipped).`);
}

importKRIsFromExcel();

// ─── Passport Configuration ───────────────────────────────────────────────────

passport.use(new LocalStrategy(
  { usernameField: 'username', passwordField: 'password' },
  function(username, password, done) {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return done(null, false, { message: 'Usuario o contraseña incorrectos' });
    if (!bcrypt.compareSync(password, user.password_hash))
      return done(null, false, { message: 'Usuario o contraseña incorrectos' });
    if (user.email !== null && !user.email_verified)
      return done(null, false, { message: 'Debes verificar tu email antes de iniciar sesión' });
    return done(null, user);
  }
));

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
  done(null, user || false);
});

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: 'kri-dashboard-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'No autenticado' });
}

function requireAdmin(req, res, next) {
  if (req.isAuthenticated() && req.session.role === 'ADMIN') return next();
  res.status(403).json({ error: 'Acceso denegado' });
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res, next) => {
  if (!req.body.username || !req.body.password)
    return res.status(400).json({ error: 'Credenciales requeridas' });

  passport.authenticate('local', (err, user, info) => {
    if (err)   return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Usuario o contraseña incorrectos' });

    req.logIn(user, (err) => {
      if (err) return next(err);
      // Mantener campos de sesión explícitos — kri_history usa req.session.username
      req.session.userId   = user.id;
      req.session.username = user.username;
      req.session.role     = user.role;
      res.json({ ok: true, username: user.username, role: user.role });
    });
  })(req, res, next);
});

app.post('/api/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.json({ ok: true }));
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'No autenticado' });
  const userState = db.prepare('SELECT scratch_mode, heatmap_name FROM users WHERE id=?').get(req.user.id);
  res.json({
    userId: req.user.id,
    username: req.user.username,
    role: req.user.role,
    scratchMode: userState?.scratch_mode === 1,
    heatmapName: userState?.heatmap_name || null,
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Email inválido' });
  if (password.length < 8)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(normalizedEmail, normalizedEmail);
  if (existing) return res.status(409).json({ error: 'El email ya está registrado' });

  const hash    = bcrypt.hashSync(password, 10);
  const token   = generateToken();
  const expires = new Date(Date.now() + 86400000).toISOString();

  let userId;
  try {
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, email, email_verified, verification_token, verification_expires) VALUES (?,?,?,0,?,?)'
    ).run(normalizedEmail, hash, normalizedEmail, token, expires);
    userId = result.lastInsertRowid;
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear usuario' });
  }

  try {
    await sendVerificationEmail(normalizedEmail, token);
  } catch (e) {
    console.error('[SMTP error]', e.message);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return res.status(500).json({ error: `No se pudo enviar el email de verificación: ${e.message}` });
  }

  res.status(201).json({ ok: true, pending: true });
});

app.get('/api/auth/verify-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });

  const user = db.prepare('SELECT id, verification_expires FROM users WHERE verification_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'Token inválido o ya utilizado' });
  if (new Date(user.verification_expires) < new Date())
    return res.status(400).json({ error: 'El enlace ha expirado' });

  db.prepare(
    'UPDATE users SET email_verified=1, verification_token=NULL, verification_expires=NULL WHERE id=?'
  ).run(user.id);

  res.json({ ok: true });
});

app.post('/api/auth/demo', (req, res, next) => {
  const demoUser = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get('demo');
  if (!demoUser) return res.status(500).json({ error: 'Usuario demo no disponible' });

  req.logIn(demoUser, (err) => {
    if (err) return next(err);
    req.session.userId   = demoUser.id;
    req.session.username = demoUser.username;
    req.session.role     = demoUser.role;
    res.json({ ok: true, username: demoUser.username, role: demoUser.role });
  });
});

// ─── Data Routes ──────────────────────────────────────────────────────────────

app.get('/api/functions', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM functions ORDER BY code').all());
});

app.get('/api/categories', requireAuth, (req, res) => {
  const { functionId } = req.query;
  const sql = functionId
    ? 'SELECT * FROM categories WHERE function_id = ? ORDER BY code'
    : 'SELECT * FROM categories ORDER BY code';
  res.json(functionId ? db.prepare(sql).all(functionId) : db.prepare(sql).all());
});

app.get('/api/subcategories', requireAuth, (req, res) => {
  const { categoryId, functionId } = req.query;
  let rows;
  if (categoryId) {
    rows = db.prepare('SELECT s.*, c.code as category_code, c.name as category_name, c.function_id FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.category_id = ? ORDER BY s.code').all(categoryId);
  } else if (functionId) {
    rows = db.prepare('SELECT s.*, c.code as category_code, c.name as category_name, c.function_id FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE c.function_id = ? ORDER BY s.code').all(functionId);
  } else {
    rows = db.prepare('SELECT s.*, c.code as category_code, c.name as category_name, c.function_id FROM subcategories s JOIN categories c ON s.category_id = c.id ORDER BY s.code').all();
  }
  res.json(rows);
});

app.get('/api/examples', requireAuth, (req, res) => {
  const { subcategoryId } = req.query;
  if (!subcategoryId) return res.status(400).json({ error: 'subcategoryId requerido' });
  res.json(db.prepare('SELECT * FROM examples WHERE subcategory_id = ? ORDER BY number').all(subcategoryId));
});

// Full heat map data (all aggregates)
app.get('/api/heatmap', requireAuth, (req, res) => {
  const functions    = db.prepare('SELECT * FROM functions ORDER BY code').all();
  const categories   = db.prepare('SELECT * FROM categories ORDER BY code').all();
  const userRow      = db.prepare('SELECT scratch_mode FROM users WHERE id = ?').get(req.user.id);
  const scratchMode  = userRow && userRow.scratch_mode === 1;
  const kriFilter    = scratchMode ? 'user_id = ?' : '(user_id = ? OR user_id IS NULL)';
  const subcategories = db.prepare(`
    SELECT s.*,
           avg_k.avg_valoracion  AS valoracion,
           latest_k.id           AS kri_id,
           latest_k.kri_name,
           latest_k.kri_description,
           latest_k.kri_formula,
           latest_k.cmmi_flag,
           latest_k.cmmi_levels
    FROM subcategories s
    LEFT JOIN (
      SELECT subcategory_id, AVG(valoracion) AS avg_valoracion
      FROM kris
      WHERE ${kriFilter}
      GROUP BY subcategory_id
    ) avg_k ON avg_k.subcategory_id = s.id
    LEFT JOIN kris latest_k ON latest_k.id = (
      SELECT id FROM kris WHERE subcategory_id = s.id AND ${kriFilter} ORDER BY id DESC LIMIT 1
    )
    ORDER BY s.code
  `).all(req.user.id, req.user.id);

  const subsByCat = {};
  subcategories.forEach(s => {
    if (!subsByCat[s.category_id]) subsByCat[s.category_id] = [];
    subsByCat[s.category_id].push(s);
  });

  const catsByFn = {};
  categories.forEach(c => {
    if (!catsByFn[c.function_id]) catsByFn[c.function_id] = [];
    catsByFn[c.function_id].push(c);
  });

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const result = functions.map(fn => {
    const fnCats = (catsByFn[fn.id] || []).map(cat => {
      const catSubs  = subsByCat[cat.id] || [];
      const vals     = catSubs.filter(s => s.valoracion != null).map(s => s.valoracion);
      return { ...cat, subcategories: catSubs, avgValoracion: avg(vals), kriCount: vals.length, totalSubcategories: catSubs.length };
    });
    const allVals = fnCats.flatMap(c => c.subcategories.filter(s => s.valoracion != null).map(s => s.valoracion));
    return { ...fn, categories: fnCats, avgValoracion: avg(allVals), kriCount: allVals.length, totalSubcategories: fnCats.reduce((a, c) => a + c.totalSubcategories, 0) };
  });

  res.json(result);
});

// KRI CRUD
app.get('/api/kris', requireAuth, (req, res) => {
  const { functionId, categoryId, subcategoryId, search } = req.query;
  const userRow = db.prepare('SELECT scratch_mode FROM users WHERE id = ?').get(req.user.id);
  const scratchMode = userRow && userRow.scratch_mode === 1;
  const kriFilter = scratchMode ? 'k.user_id = ?' : '(k.user_id = ? OR k.user_id IS NULL)';
  let sql = `
    SELECT s.id as subcategory_id, s.code, s.description, s.category_id,
           c.code as category_code, c.name as category_name, c.function_id,
           f.code as function_code, f.name as function_name,
           k.id as kri_id, k.kri_name, k.kri_description, k.kri_formula,
           k.cmmi_flag, k.cmmi_levels, k.valoracion, k.updated_at,
           h.saved_by as last_saved_by, h.saved_at as last_saved_at
    FROM subcategories s
    JOIN categories c ON s.category_id = c.id
    JOIN functions f ON c.function_id = f.id
    LEFT JOIN kris k ON k.subcategory_id = s.id AND ${kriFilter}
    LEFT JOIN (
      SELECT kri_id, saved_by, saved_at
      FROM kri_history
      WHERE id IN (SELECT MAX(id) FROM kri_history GROUP BY kri_id)
    ) h ON h.kri_id = k.id
    WHERE 1=1
  `;
  const params = [req.user.id];
  if (functionId)    { sql += ' AND f.id = ?';  params.push(functionId); }
  if (categoryId)    { sql += ' AND c.id = ?';  params.push(categoryId); }
  if (subcategoryId) { sql += ' AND s.id = ?';  params.push(subcategoryId); }
  if (search) {
    sql += ' AND (s.code LIKE ? OR s.description LIKE ? OR k.kri_name LIKE ? OR k.kri_description LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  sql += ' ORDER BY s.code, k.id';
  res.json(db.prepare(sql).all(...params));
});

// POST → create or update a KRI (kri_id in body = update, absent = create)
app.post('/api/kris/:subcategoryId', requireAuth, (req, res) => {
  const { subcategoryId } = req.params;
  const { kri_id, kri_name, kri_description, kri_formula, cmmi_flag, cmmi_levels, valoracion } = req.body;

  if (!kri_name) return res.status(400).json({ error: 'kri_name es requerido' });
  const v = parseFloat(valoracion);
  if (isNaN(v) || v < 0 || v > 100)
    return res.status(400).json({ error: 'valoracion debe estar entre 0 y 100' });

  try {
    if (kri_id) {
      // UPDATE existing KRI — verify ownership
      const existing = db.prepare('SELECT id FROM kris WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(kri_id, req.user.id);
      if (!existing) return res.status(404).json({ error: 'KRI no encontrado' });

      db.prepare(`
        UPDATE kris SET kri_name=?, kri_description=?, kri_formula=?,
                        cmmi_flag=?, cmmi_levels=?, valoracion=?, updated_at=datetime('now')
        WHERE id=?
      `).run(kri_name, kri_description||null, kri_formula||null,
             cmmi_flag||null, cmmi_levels||null, v, kri_id);

      db.prepare(`
        INSERT INTO kri_history (subcategory_id, kri_id, valoracion, saved_by, user_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(subcategoryId, kri_id, v, req.session.username, req.user.id);

      res.json({ ok: true, kri_id });
    } else {
      // INSERT new KRI
      const result = db.prepare(`
        INSERT INTO kris (subcategory_id, kri_name, kri_description, kri_formula,
                          cmmi_flag, cmmi_levels, valoracion, user_id)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(subcategoryId, kri_name, kri_description||null, kri_formula||null,
             cmmi_flag||null, cmmi_levels||null, v, req.user.id);

      const newKriId = result.lastInsertRowid;
      db.prepare(`
        INSERT INTO kri_history (subcategory_id, kri_id, valoracion, saved_by, user_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(subcategoryId, newKriId, v, req.session.username, req.user.id);

      res.json({ ok: true, kri_id: newKriId });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET history by kri id
app.get('/api/kris/:kriId/history', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT valoracion, saved_by, saved_at
    FROM kri_history
    WHERE kri_id = ? AND (user_id = ? OR user_id IS NULL)
    ORDER BY saved_at DESC
    LIMIT 50
  `).all(req.params.kriId, req.user.id);
  res.json(rows);
});

// DELETE by kri id
app.delete('/api/kris/:kriId', requireAuth, (req, res) => {
  const { kriId } = req.params;
  const owned = db.prepare('SELECT id FROM kris WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(kriId, req.user.id);
  if (!owned) return res.status(403).json({ error: 'No autorizado' });
  try {
    db.prepare('DELETE FROM kri_history WHERE kri_id = ?').run(kriId);
    db.prepare('DELETE FROM kris WHERE id = ?').run(kriId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/export/excel — export filtered KRIs as .xlsx
app.get('/api/export/excel', requireAuth, (req, res) => {
  const { functionId, categoryId, kriFilter, search } = req.query;
  let sql = `
    SELECT s.id as subcategory_id, s.code, s.description, s.category_id,
           c.code as category_code, c.name as category_name, c.function_id,
           f.code as function_code, f.name as function_name,
           k.id as kri_id, k.kri_name, k.kri_description, k.kri_formula,
           k.cmmi_flag, k.cmmi_levels, k.valoracion, k.updated_at,
           h.saved_by as last_saved_by, h.saved_at as last_saved_at
    FROM subcategories s
    JOIN categories c ON s.category_id = c.id
    JOIN functions f ON c.function_id = f.id
    LEFT JOIN kris k ON k.subcategory_id = s.id AND (k.user_id = ? OR k.user_id IS NULL)
    LEFT JOIN (
      SELECT kri_id, saved_by, saved_at
      FROM kri_history
      WHERE id IN (SELECT MAX(id) FROM kri_history GROUP BY kri_id)
    ) h ON h.kri_id = k.id
    WHERE 1=1
  `;
  const params = [req.user.id];
  if (functionId) { sql += ' AND f.id = ?'; params.push(functionId); }
  if (categoryId) { sql += ' AND c.id = ?'; params.push(categoryId); }
  if (kriFilter === 'with')    { sql += ' AND k.id IS NOT NULL'; }
  if (kriFilter === 'without') { sql += ' AND k.id IS NULL'; }
  if (search) {
    sql += ' AND (s.code LIKE ? OR s.description LIKE ? OR k.kri_name LIKE ? OR k.kri_description LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  sql += ' ORDER BY s.code, k.id';
  const rows = db.prepare(sql).all(...params);

  // CMMI level computation (same logic as client)
  function cmmiLevel(val, flag, levels) {
    if (val == null || val === '') return { level: null, name: '—' };
    const v = parseFloat(val);
    const lvlNames = ['Inicial', 'Repetible', 'Definido', 'Gestionado', 'Optimizado'];
    let thresholds = [20, 40, 60, 80];
    if (levels) {
      try { thresholds = JSON.parse(levels); } catch (e) { /* use default */ }
    }
    let lvl;
    if (flag === 'POSITIVO') {
      if      (v >= thresholds[3]) lvl = 5;
      else if (v >= thresholds[2]) lvl = 4;
      else if (v >= thresholds[1]) lvl = 3;
      else if (v >= thresholds[0]) lvl = 2;
      else                          lvl = 1;
    } else {
      if      (v <= thresholds[0]) lvl = 5;
      else if (v <= thresholds[1]) lvl = 4;
      else if (v <= thresholds[2]) lvl = 3;
      else if (v <= thresholds[3]) lvl = 2;
      else                          lvl = 1;
    }
    return { level: lvl, name: `N${lvl} – ${lvlNames[lvl - 1]}` };
  }

  const data = rows.map(r => {
    const cm = cmmiLevel(r.valoracion, r.cmmi_flag, r.cmmi_levels);
    return {
      'Función (Código)':       r.function_code  || '',
      'Función (Nombre)':       r.function_name  || '',
      'Categoría (Código)':     r.category_code  || '',
      'Categoría (Nombre)':     r.category_name  || '',
      'Subcategoría (Código)':  r.code           || '',
      'Subcategoría (Descripción)': r.description || '',
      'KRI ID':                 r.kri_id         != null ? r.kri_id : '',
      'KRI Nombre':             r.kri_name       || '',
      'KRI Descripción':        r.kri_description || '',
      'KRI Fórmula':            r.kri_formula    || '',
      'Valoración (0-100)':     r.valoracion     != null ? r.valoracion : '',
      'Nivel CMMI':             cm.level         != null ? cm.level : '',
      'Nivel CMMI (Nombre)':    cm.name,
      'CMMI Flag':              r.cmmi_flag      || '',
      'Última actualización':   r.updated_at     || '',
      'Actualizado por':        r.last_saved_by  || '',
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);

  // Auto column widths
  const colWidths = Object.keys(data[0] || {}).map(k => ({
    wch: Math.max(k.length, ...data.map(r => String(r[k] || '').length), 10)
  }));
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'KRI Dashboard');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="kri_export_${today}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, role, email, email_verified, created_at FROM users ORDER BY id ASC'
  ).all();
  res.json(users);
});

app.put('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.userId)
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

// ─── Admin: domain heatmaps ───────────────────────────────────────────────────

app.get('/api/admin/domain-heatmaps', requireAdmin, (req, res) => {
  const adminUser = db.prepare('SELECT email FROM users WHERE id=?').get(req.user.id);
  const domain = adminUser?.email?.split('@')[1]?.toLowerCase();
  if (!domain) return res.json([]);

  const rows = db.prepare(`
    SELECT u.id, u.username, u.email, u.scratch_mode, u.heatmap_name,
           COUNT(k.id) AS kri_count,
           MAX(k.updated_at) AS last_update
    FROM users u
    LEFT JOIN kris k ON k.user_id = u.id
    WHERE LOWER(SUBSTR(u.email, INSTR(u.email,'@')+1)) = ?
    GROUP BY u.id
    ORDER BY u.id ASC
  `).all(domain);

  res.json(rows);
});

app.get('/api/admin/heatmap/:userId', requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const functions    = db.prepare('SELECT * FROM functions ORDER BY code').all();
  const categories   = db.prepare('SELECT * FROM categories ORDER BY code').all();
  const subcategories = db.prepare(`
    SELECT s.*,
           avg_k.avg_valoracion AS valoracion,
           avg_k.kri_count AS kri_count
    FROM subcategories s
    LEFT JOIN (
      SELECT subcategory_id,
             AVG(valoracion) AS avg_valoracion,
             COUNT(*) AS kri_count
      FROM kris WHERE user_id = ?
      GROUP BY subcategory_id
    ) avg_k ON avg_k.subcategory_id = s.id
    ORDER BY s.code
  `).all(userId);

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const subsByCat = {};
  subcategories.forEach(s => {
    if (!subsByCat[s.category_id]) subsByCat[s.category_id] = [];
    subsByCat[s.category_id].push(s);
  });
  const catsByFn = {};
  categories.forEach(c => {
    if (!catsByFn[c.function_id]) catsByFn[c.function_id] = [];
    catsByFn[c.function_id].push(c);
  });

  const result = functions.map(fn => {
    const fnCats = (catsByFn[fn.id] || []).map(cat => {
      const catSubs = subsByCat[cat.id] || [];
      const vals = catSubs.filter(s => s.valoracion != null).map(s => s.valoracion);
      return { code: cat.code, name: cat.name, avgValoracion: avg(vals), kriCount: vals.length };
    });
    const allVals = fnCats.filter(c => c.avgValoracion != null).map(c => c.avgValoracion);
    return { code: fn.code, name: fn.name, avgValoracion: avg(allVals), categories: fnCats };
  });

  res.json(result);
});

// ─── Scenario Routes ──────────────────────────────────────────────────────────

app.post('/api/scenarios/apply', requireAuth, (req, res) => {
  const { scenario } = req.body;
  const valid = ['empty', 'positive', 'neutral', 'negative', 'scratch'];
  if (!valid.includes(scenario))
    return res.status(400).json({ error: 'Escenario inválido' });

  const userId = req.session.userId;

  // Delete existing KRIs and history for this user
  const userKriIds = db.prepare('SELECT id FROM kris WHERE user_id = ?').all(userId).map(r => r.id);
  if (userKriIds.length) {
    const placeholders = userKriIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM kri_history WHERE kri_id IN (${placeholders})`).run(...userKriIds);
    db.prepare('DELETE FROM kris WHERE user_id = ?').run(userId);
  }

  if (scenario === 'scratch') {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : null;
    db.prepare('UPDATE users SET scratch_mode=1, heatmap_name=? WHERE id=?').run(name, userId);
    return res.json({ ok: true, created: 0 });
  }

  db.prepare('UPDATE users SET scratch_mode=0 WHERE id=?').run(userId);

  const templateFile = {
    empty:    'RANDOM.json',
    positive: 'POSITIVA.json',
    neutral:  'NEUTRAL.json',
    negative: 'NEGATIVA.json',
  }[scenario];

  const rawTemplate = JSON.parse(fs.readFileSync(path.join(__dirname, templateFile), 'utf8'));
  const templateMap = {};
  for (const r of rawTemplate) {
    if (r.kri_name && r.kri_name.includes('Simulación')) {
      templateMap[r.subcategory_id] = { val: r.valoracion, flag: r.cmmi_flag };
    }
  }

  const label = { empty: 'random', positive: 'positiva', neutral: 'neutral', negative: 'negativa' }[scenario];

  const subcategories = db.prepare('SELECT id FROM subcategories').all();
  const insKri = db.prepare(
    'INSERT INTO kris (subcategory_id, kri_name, cmmi_flag, valoracion, user_id) VALUES (?, ?, ?, ?, ?)'
  );
  const insHist = db.prepare(
    'INSERT INTO kri_history (subcategory_id, kri_id, valoracion, saved_by, user_id) VALUES (?, ?, ?, ?, ?)'
  );

  const insertAll = db.transaction(() => {
    for (const sub of subcategories) {
      const tpl = templateMap[sub.id];
      const val = tpl ? tpl.val : Math.round(Math.random() * 100);
      const f   = tpl ? tpl.flag : 'POSITIVO';
      const info = insKri.run(sub.id, `KRI — Simulación ${label}`, f, val, userId);
      insHist.run(sub.id, info.lastInsertRowid, val, req.session.username, userId);
    }
  });
  insertAll();

  res.json({ ok: true, created: subcategories.length });
});

// ─── Redirect root ────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`KRI Dashboard running at http://localhost:${PORT}`);
  console.log('Default credentials: ciso / Admin1234!');
});
