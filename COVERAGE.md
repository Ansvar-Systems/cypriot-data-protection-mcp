# Coverage

This document describes what data is included in this MCP server, known gaps, and language coverage.

## Authority

**Commissioner for Personal Data Protection (CDPC)**
- Country: Cyprus (CY)
- Website: <https://www.dataprotection.gov.cy/>
- Role: National supervisory authority for GDPR enforcement in Cyprus

---

## Corpus Scope

### Decisions & Sanctions (`cdpc-decisions`)

Covers CDPC enforcement output:

| Type | Description |
|------|-------------|
| `decision` | Formal regulatory decisions |
| `sanction` | Administrative fines and penalties |
| `warning` | Formal warnings issued to controllers/processors |
| `reprimand` | Reprimands (less severe than sanctions) |

### Guidance Documents (`cdpc-guidelines`)

Covers CDPC non-binding guidance:

| Type | Description |
|------|-------------|
| `guide` | Practical guidance on GDPR topics |
| `recommendation` | Formal recommendations |
| `faq` | Frequently asked questions |
| `template` | Document templates for DPAs, DPIAs, etc. |

---

## Topics Covered

| Topic ID | Description |
|----------|-------------|
| `consent` | Lawful basis — consent requirements |
| `cookies` | Cookie consent and tracking technologies |
| `data_breach` | Personal data breach notification and response |
| `data_subject_rights` | Access, erasure, portability, and other rights |
| `dpia` | Data Protection Impact Assessments |
| `employee_monitoring` | Workplace surveillance and monitoring |
| `international_transfers` | Cross-border data transfers (SCCs, adequacy, BCRs) |
| `lawful_basis` | Lawful bases for processing (Art. 6 GDPR) |
| `special_categories` | Special category data (Art. 9 GDPR) |
| `video_surveillance` | CCTV and video surveillance |

---

## Language Coverage

- **Greek (el):** Primary language — all official documents
- **English (en):** Selected documents and translations

Not all CDPC documents are available in English. Greek-language-only documents are indexed but may be less useful for non-Greek speakers.

---

## Known Gaps

1. **Older decisions (pre-2018):** Coverage may be incomplete for decisions issued before GDPR came into force.
2. **Pending decisions:** Decisions under appeal or not yet published may be missing.
3. **Informal guidance:** Informal opinions and correspondence are not included.
4. **Real-time updates:** The database is updated periodically and may lag the CDPC website by days to weeks.

---

## Freshness

Run `npm run ingest` to refresh the database from official CDPC sources. Use the `cy_dp_check_data_freshness` tool to see current record counts and latest dates.

See `data/coverage.json` for machine-readable coverage metadata.
