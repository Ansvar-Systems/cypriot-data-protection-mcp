/**
 * Seed the CDPC database with sample decisions and guidelines for testing.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["CDPC_DB_PATH"] ?? "data/cdpc.db";
const force = process.argv.includes("--force");

const dir = dirname(DB_PATH);
if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }
if (force && existsSync(DB_PATH)) { unlinkSync(DB_PATH); console.log(`Deleted existing database at ${DB_PATH}`); }

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);
console.log(`Database initialised at ${DB_PATH}`);

interface TopicRow { id: string; name_local: string; name_en: string; description: string; }

const topics: TopicRow[] = [
  { id: "cookies", name_local: "Cookies and trackers", name_en: "Cookies and trackers", description: "Use of cookies and other trackers on users' devices (GDPR Art. 6)." },
  { id: "employee_monitoring", name_local: "Employee monitoring", name_en: "Employee monitoring", description: "Processing of employee data and monitoring in the workplace." },
  { id: "video_surveillance", name_local: "Video surveillance", name_en: "Video surveillance", description: "Use of video surveillance systems and personal data protection (GDPR Art. 6)." },
  { id: "data_breach", name_local: "Data breach notification", name_en: "Data breach notification", description: "Notification of personal data breaches to the CDPC and data subjects (GDPR Art. 33–34)." },
  { id: "consent", name_local: "Consent", name_en: "Consent", description: "Obtaining, validity, and withdrawal of consent for personal data processing (GDPR Art. 7)." },
  { id: "dpia", name_local: "Data Protection Impact Assessment", name_en: "Data Protection Impact Assessment (DPIA)", description: "Impact assessment for high-risk processing operations (GDPR Art. 35)." },
  { id: "transfers", name_local: "International data transfers", name_en: "International data transfers", description: "Transfer of personal data to third countries or international organisations (GDPR Art. 44–49)." },
  { id: "data_subject_rights", name_local: "Data subject rights", name_en: "Data subject rights", description: "Exercise of access, rectification, erasure and other rights (GDPR Art. 15–22)." },
];

const insertTopic = db.prepare("INSERT OR IGNORE INTO topics (id, name_local, name_en, description) VALUES (?, ?, ?, ?)");
for (const t of topics) { insertTopic.run(t.id, t.name_local, t.name_en, t.description); }
console.log(`Inserted ${topics.length} topics`);

interface DecisionRow {
  reference: string; title: string; date: string; type: string;
  entity_name: string; fine_amount: number | null; summary: string;
  full_text: string; topics: string; gdpr_articles: string; status: string;
}

const decisions: DecisionRow[] = [
  {
    reference: "CDPC-2022-005",
    title: "CDPC Decision on Cookie Consent Violations",
    date: "2022-06-10",
    type: "sanction",
    entity_name: "Online retail company",
    fine_amount: 10000,
    summary: "The CDPC imposed a €10,000 fine on an online retail company for deploying analytics and advertising cookies without prior user consent and failing to provide an equally easy opt-out mechanism.",
    full_text: "The Commissioner for Personal Data Protection conducted an investigation following user complaints about cookie practices. It was found that the company activated advertising and analytics cookies upon page load, before users had the opportunity to make their choice. The consent banner was displayed after cookies were already active. The CDPC found: 1) cookies were activated prior to obtaining consent; 2) the opt-out mechanism was significantly more complex than the opt-in process; 3) information about cookie purposes was insufficient. The company was fined €10,000 and ordered to remediate within 60 days.",
    topics: JSON.stringify(["cookies", "consent"]),
    gdpr_articles: JSON.stringify(["6", "7"]),
    status: "final",
  },
  {
    reference: "CDPC-2022-012",
    title: "CDPC Decision on Employee Monitoring via GPS",
    date: "2022-10-05",
    type: "sanction",
    entity_name: "Transport company",
    fine_amount: 18000,
    summary: "The CDPC imposed an €18,000 fine on a transport company for continuous GPS tracking of employees both during and outside working hours, violating the proportionality principle.",
    full_text: "The CDPC received complaints from employees regarding continuous GPS tracking through a fleet management system. The investigation revealed: 1) GPS data was collected 24/7 including outside working hours and weekends; 2) employees were not adequately informed about the extent of processing before the system was deployed; 3) data was retained for 3 years without justification. The CDPC emphasised that GPS tracking is only permissible during working hours for specific legitimate purposes. The company was fined €18,000 and ordered to restrict tracking to working hours.",
    topics: JSON.stringify(["employee_monitoring"]),
    gdpr_articles: JSON.stringify(["5", "6", "13"]),
    status: "final",
  },
  {
    reference: "CDPC-2023-002",
    title: "CDPC Decision on Late Data Breach Notification",
    date: "2023-02-22",
    type: "sanction",
    entity_name: "Healthcare provider",
    fine_amount: 30000,
    summary: "The CDPC imposed a €30,000 fine on a healthcare provider for late and incomplete notification of a data breach affecting approximately 8,000 patients.",
    full_text: "A healthcare provider suffered a cyberattack that compromised the personal data of approximately 8,000 patients, including medical information. The CDPC found the following violations: 1) the notification to the CDPC was submitted 11 days after the breach was discovered, exceeding the 72-hour deadline; 2) the notification was incomplete, lacking the type of data affected, the approximate number of individuals, and a risk assessment; 3) affected patients were not notified despite the high risk posed. The company was fined €30,000. The CDPC stressed that healthcare data breaches require prompt action given the sensitive nature of the data involved.",
    topics: JSON.stringify(["data_breach"]),
    gdpr_articles: JSON.stringify(["33", "34"]),
    status: "final",
  },
  {
    reference: "CDPC-2023-017",
    title: "CDPC Decision on Video Surveillance in the Workplace",
    date: "2023-05-30",
    type: "warning",
    entity_name: "Retail chain",
    fine_amount: null,
    summary: "The CDPC issued a warning to a retail chain for installing video surveillance cameras in employee rest areas and failing to adequately inform employees about the monitoring.",
    full_text: "The CDPC conducted planned inspections at retail chain stores and discovered that video surveillance cameras had been installed in employee rest areas — changing rooms and break rooms. This is a clear violation of the proportionality principle, as there is no legitimate basis for such intensive surveillance in private employee zones. Furthermore, employees were not adequately informed about camera locations and the extent of data processed. The CDPC issued a warning and required the company to: 1) immediately remove cameras from employee rest areas; 2) review its video surveillance policy in line with GDPR requirements; 3) prepare and publish clear information for employees about video monitoring.",
    topics: JSON.stringify(["video_surveillance", "employee_monitoring"]),
    gdpr_articles: JSON.stringify(["5", "6", "13"]),
    status: "final",
  },
  {
    reference: "CDPC-2023-029",
    title: "CDPC Decision on Direct Marketing Without Consent",
    date: "2023-09-15",
    type: "sanction",
    entity_name: "Financial services company",
    fine_amount: 15000,
    summary: "The CDPC imposed a €15,000 fine on a financial services company for sending marketing emails without valid consent and failing to provide an easy opt-out mechanism.",
    full_text: "The CDPC investigated complaints from consumers who received unsolicited marketing emails from a financial services company. The investigation revealed: 1) the company sent marketing messages to persons who had not explicitly consented — consent was obtained through pre-ticked checkboxes; 2) the unsubscribe link was hidden in the email footer in small print; 3) some consumers reported continuing to receive emails for weeks after unsubscribing. The CDPC stressed that consent for marketing communications must be obtained through an affirmative action. The company was fined €15,000.",
    topics: JSON.stringify(["consent"]),
    gdpr_articles: JSON.stringify(["6", "7"]),
    status: "final",
  },
];

const insertDecision = db.prepare(`INSERT OR IGNORE INTO decisions (reference, title, date, type, entity_name, fine_amount, summary, full_text, topics, gdpr_articles, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertDecisionsAll = db.transaction(() => { for (const d of decisions) { insertDecision.run(d.reference, d.title, d.date, d.type, d.entity_name, d.fine_amount, d.summary, d.full_text, d.topics, d.gdpr_articles, d.status); } });
insertDecisionsAll();
console.log(`Inserted ${decisions.length} decisions`);

interface GuidelineRow { reference: string | null; title: string; date: string; type: string; summary: string; full_text: string; topics: string; language: string; }

const guidelines: GuidelineRow[] = [
  {
    reference: "CDPC-GUIDE-COOKIES-2022",
    title: "Guidelines on Cookie Consent",
    date: "2022-03-01",
    type: "guide",
    summary: "CDPC guidelines on the use of cookies and other tracking technologies. Covers consent requirements, user information obligations, and opt-out mechanisms.",
    full_text: "These guidelines explain requirements for cookie use in Cyprus under the GDPR and the Electronic Communications Law. Key requirements: 1) Consent before cookies — non-essential cookies (advertising, analytics) require prior, clear and active user consent; only strictly necessary cookies may be deployed without consent; 2) Equal access — users must be given an equally easy way to both accept and reject cookies; cookie walls are generally not permissible; 3) Information — clear information on cookie purposes, duration and third parties; 4) Withdrawal — users must be able to withdraw consent at any time as easily as they gave it; 5) Proof — controllers must be able to demonstrate that valid consent was obtained.",
    topics: JSON.stringify(["cookies", "consent"]),
    language: "en",
  },
  {
    reference: "CDPC-GUIDE-DPIA-2021",
    title: "Guide to Conducting a Data Protection Impact Assessment",
    date: "2021-09-01",
    type: "guide",
    summary: "CDPC methodological guide for conducting a Data Protection Impact Assessment (DPIA). Covers when a DPIA is mandatory, how to conduct one, and documentation requirements.",
    full_text: "Article 35 of the GDPR requires a Data Protection Impact Assessment (DPIA) where processing is likely to result in a high risk to the rights and freedoms of individuals. A DPIA is mandatory for: large-scale processing of biometric or health data; systematic monitoring of publicly accessible areas; processing for automated decision-making with legal or similarly significant effects. The three stages of a DPIA: 1) Description of processing — data categories, purposes, recipients, transfers, retention period, security measures; 2) Assessment of necessity and proportionality — whether processing is lawful, data is minimal, and data subject rights can be exercised; 3) Risk management — identification of risks (unauthorised access, unintended modification, loss), assessment of their likelihood and severity, and identification of supplementary measures. DPIAs must be documented and kept up to date. The CDPC recommends using the EDPB methodology.",
    topics: JSON.stringify(["dpia"]),
    language: "en",
  },
  {
    reference: "CDPC-GUIDE-RIGHTS-2022",
    title: "Guide to Exercising Data Subject Rights",
    date: "2022-07-15",
    type: "guide",
    summary: "CDPC guide on data subject rights under the GDPR — access, rectification, erasure, restriction, portability, and objection. Covers timelines, procedures, and exceptions.",
    full_text: "The GDPR grants data subjects extensive rights regarding the processing of their personal data. Key rights: 1) Right of access (Art. 15) — individuals have the right to obtain confirmation of whether their data is being processed and a copy of that data; the response must be provided within 1 month; 2) Right to rectification (Art. 16) — inaccurate data must be rectified without undue delay; 3) Right to erasure (Art. 17) — the 'right to be forgotten' in specific circumstances, e.g., withdrawal of consent, no longer necessary for the purpose; 4) Right to restriction of processing (Art. 18); 5) Right to data portability (Art. 20) — individuals have the right to receive their data in a structured, commonly used, machine-readable format; 6) Right to object (Art. 21) — individuals may object to processing based on legitimate interests or for direct marketing. Organisations must have clear procedures in place and respond within the required timeframes.",
    topics: JSON.stringify(["data_subject_rights"]),
    language: "en",
  },
];

const insertGuideline = db.prepare(`INSERT INTO guidelines (reference, title, date, type, summary, full_text, topics, language) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const insertGuidelinesAll = db.transaction(() => { for (const g of guidelines) { insertGuideline.run(g.reference, g.title, g.date, g.type, g.summary, g.full_text, g.topics, g.language); } });
insertGuidelinesAll();
console.log(`Inserted ${guidelines.length} guidelines`);

const dc = (db.prepare("SELECT count(*) as cnt FROM decisions").get() as { cnt: number }).cnt;
const gc = (db.prepare("SELECT count(*) as cnt FROM guidelines").get() as { cnt: number }).cnt;
const tc = (db.prepare("SELECT count(*) as cnt FROM topics").get() as { cnt: number }).cnt;
console.log(`\nDatabase summary:\n  Topics: ${tc}\n  Decisions: ${dc}\n  Guidelines: ${gc}\n\nDone. Database ready at ${DB_PATH}`);
db.close();
