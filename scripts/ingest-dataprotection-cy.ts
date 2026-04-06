#!/usr/bin/env tsx
/**
 * CDPC ingestion crawler — fetches decisions and guidelines from
 * the Commissioner for Personal Data Protection (dataprotection.gov.cy).
 *
 * Two-phase pipeline:
 *   Phase 1 (Index):   Crawl the Domino NSF views/pages on the Commissioner's
 *                       site to build a metadata index of decisions, announcements,
 *                       and guidance documents.
 *   Phase 2 (Content): Fetch each detail page/PDF, extract full text and metadata,
 *                       upsert into the SQLite database.
 *
 * The site runs on IBM/HCL Lotus Domino (NSF database). Content is primarily in
 * Greek with some English documents. The Commissioner publishes decisions as PDF
 * attachments on Domino document pages, and guidance documents as HTML pages.
 *
 * NOTE: The site has a self-signed / problematic TLS certificate. The crawler
 * sets NODE_TLS_REJECT_UNAUTHORIZED=0 at startup to work around this.
 *
 * Usage:
 *   npx tsx scripts/ingest-dataprotection-cy.ts
 *   npx tsx scripts/ingest-dataprotection-cy.ts --resume
 *   npx tsx scripts/ingest-dataprotection-cy.ts --dry-run
 *   npx tsx scripts/ingest-dataprotection-cy.ts --force
 *   npx tsx scripts/ingest-dataprotection-cy.ts --limit 50
 *   npx tsx scripts/ingest-dataprotection-cy.ts --resume --limit 100
 */

// Bypass self-signed certificate on dataprotection.gov.cy
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env["CDPC_DB_PATH"] ?? "data/cdpc.db";
const DATA_DIR = resolve(__dirname, "..", "data");
const INDEX_PATH = resolve(DATA_DIR, "cdpc-index.json");
const PROGRESS_PATH = resolve(DATA_DIR, "cdpc-progress.json");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.dataprotection.gov.cy";
const NSF_BASE = "/dataprotection/dataprotection.nsf";

/**
 * Known section views on the Domino NSF database.
 *
 * The Commissioner's site uses Lotus Domino, which organises documents into
 * "views" exposed via URL paths like /nsf/viewname. We crawl these views to
 * discover documents. The `All` view is the catch-all Domino default.
 *
 * Greek page slugs mapped from the site navigation:
 *   - home_el / home_en — landing pages (contain announcement links)
 *   - page3g_el / page3g_en — GDPR section (guidelines, EDPB guidance)
 *   - page3a_el / page3a_en — Law 125(I)/2018 section
 *   - All — Domino default "all documents" view
 */
const SECTION_VIEWS: { path: string; label: string }[] = [
  { path: `${NSF_BASE}/home_el/home_el?opendocument`, label: "Home (EL)" },
  { path: `${NSF_BASE}/home_en/home_en?opendocument`, label: "Home (EN)" },
  {
    path: `${NSF_BASE}/page3g_el/page3g_el?opendocument`,
    label: "GDPR (EL)",
  },
  {
    path: `${NSF_BASE}/page3g_en/page3g_en?opendocument`,
    label: "GDPR (EN)",
  },
  { path: `${NSF_BASE}/All?OpenView&Count=1000`, label: "All Docs View" },
  {
    path: `${NSF_BASE}/All?OpenView&Count=1000&Start=1001`,
    label: "All Docs View (page 2)",
  },
  {
    path: `${NSF_BASE}/All?OpenView&Count=1000&Start=2001`,
    label: "All Docs View (page 3)",
  },
];

const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3000;
const USER_AGENT =
  "AnsvarCDPCCrawler/1.0 (+https://ansvar.eu; data-protection-research)";

/**
 * Map Greek category/document type labels to normalised English types
 * used in the DB schema.
 */
const CATEGORY_MAP: Record<string, string> = {
  // Greek labels found on the site
  "Απόφαση": "sanction",
  "ΑΠΟΦΑΣΗ": "sanction",
  "Αποφάσεις": "sanction",
  "Γνωμοδότηση": "opinion",
  "Γνωμοδοτήσεις": "opinion",
  "Ανακοίνωση": "announcement",
  "Ανακοινώσεις": "announcement",
  "Οδηγία": "directive",
  "Κατευθυντήριες γραμμές": "guide",
  "Κατευθυντήριες Γραμμές": "guide",
  "Σύσταση": "recommendation",
  "Εγκύκλιος": "circular",
  "Ετήσια Έκθεση": "annual_report",
  "Ομιλία": "speech",
  "Νομοθεσία": "legislation",
  "Κώδικας Δεοντολογίας": "code_of_conduct",
  // English labels
  Decision: "sanction",
  Opinion: "opinion",
  Announcement: "announcement",
  Guideline: "guide",
  Guidelines: "guide",
  Recommendation: "recommendation",
  Circular: "circular",
  "Annual Report": "annual_report",
  Legislation: "legislation",
};

/**
 * Map topic labels (Greek/English) found on pages to topic IDs
 * matching the `topics` table.
 */
const THEMATIC_TO_TOPIC: Record<string, string> = {
  // Greek
  "Cookies": "cookies",
  "Ηλεκτρονικές επικοινωνίες": "cookies",
  "Βιντεοεπιτήρηση": "video_surveillance",
  "Εργοδότηση": "employee_monitoring",
  "Παρακολούθηση εργαζομένων": "employee_monitoring",
  "Παραβίαση δεδομένων": "data_breach",
  "Συγκατάθεση": "consent",
  "Εκτίμηση αντικτύπου": "dpia",
  "DPIA": "dpia",
  "Διαβίβαση δεδομένων": "transfers",
  "Δικαιώματα υποκειμένων": "data_subject_rights",
  "Δικαιώματα": "data_subject_rights",
  // English
  "Video surveillance": "video_surveillance",
  "Employee monitoring": "employee_monitoring",
  "Data breach": "data_breach",
  "Consent": "consent",
  "Impact assessment": "dpia",
  "Data transfers": "transfers",
  "Data subject rights": "data_subject_rights",
};

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

interface CliFlags {
  resume: boolean;
  dryRun: boolean;
  force: boolean;
  limit: number;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = {
    resume: false,
    dryRun: false,
    force: false,
    limit: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--resume":
        flags.resume = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--force":
        flags.force = true;
        break;
      case "--limit":
        flags.limit = parseInt(args[++i] ?? "0", 10);
        break;
      default:
        console.error(`Unknown flag: ${arg}`);
        process.exit(1);
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
          "Accept-Language": "el-GR,el;q=0.9,en;q=0.5",
        },
        redirect: "follow",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }

      return await res.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        const delay = RETRY_BACKOFF_MS * attempt;
        console.warn(
          `  WARN: attempt ${attempt}/${retries} failed for ${url}: ${msg} — retrying in ${delay}ms`,
        );
        await sleep(delay);
      } else {
        throw new Error(
          `Failed after ${retries} attempts for ${url}: ${msg}`,
        );
      }
    }
  }

  throw new Error("unreachable");
}

/**
 * Fetch binary content (PDF) as a Buffer.
 */
async function fetchBinaryWithRetry(
  url: string,
  retries = MAX_RETRIES,
): Promise<Buffer> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/pdf,*/*",
        },
        redirect: "follow",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }

      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        const delay = RETRY_BACKOFF_MS * attempt;
        console.warn(
          `  WARN: attempt ${attempt}/${retries} failed for ${url}: ${msg} — retrying in ${delay}ms`,
        );
        await sleep(delay);
      } else {
        throw new Error(
          `Failed after ${retries} attempts for ${url}: ${msg}`,
        );
      }
    }
  }

  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Index entry
// ---------------------------------------------------------------------------

interface IndexEntry {
  /** Normalised reference: e.g. "CDPC-2024-001" or "CDPC-DOC-{hash}" */
  reference: string;
  /** Title from link text or document heading */
  title: string;
  /** ISO date: YYYY-MM-DD (if extractable) */
  date: string;
  /** Category label as found on the page */
  categoryRaw: string;
  /** Full URL to the document/detail page */
  detailUrl: string;
  /** URL to a PDF attachment, if discovered during indexing */
  pdfUrl: string | null;
  /** Source language: "el" or "en" */
  language: string;
}

// ---------------------------------------------------------------------------
// Phase 1: Index — crawl Domino views and pages to discover documents
// ---------------------------------------------------------------------------

/**
 * Normalise a URL found in an href attribute to an absolute URL.
 */
function normaliseUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `${BASE_URL}${href}`;
  return `${BASE_URL}/${href}`;
}

/**
 * Determine if a URL points to a Domino document (not a view/page/image/css).
 */
function isDominoDocUrl(href: string): boolean {
  if (!href) return false;
  // Domino documents have UNIDs (32-char hex) in the path
  if (/[A-F0-9]{32}/i.test(href)) return true;
  // Or use ?OpenDocument on document paths
  if (href.includes("?OpenDocument") && !href.includes("home_")) return true;
  return false;
}

/**
 * Determine if a URL points to a PDF file.
 */
function isPdfUrl(href: string): boolean {
  return /\.pdf(\?|$)/i.test(href);
}

/**
 * Extract a reference number from the document URL or text.
 * Cypriot CDPC references follow patterns like:
 *   11.17.001.010.XXX (file reference numbers)
 *   12.10.001.011.XXX (another reference series)
 */
function extractReference(
  url: string,
  title: string,
  text: string,
): string {
  // Try to extract a CDPC file reference number from text/title
  const refPatterns = [
    // "Our ref.: 11.17.001.010.007" or "Αρ. Φακ.: 12.10.001.011.006"
    /(?:Our\s+ref\.?|Ref\.?\s*(?:no\.?)?|Αρ\.?\s*Φακ\.?)[:\s]*(\d{2}\.\d{2}\.\d{3}\.\d{3}(?:\.\d{3}){1,3})/i,
    // Standalone dotted reference
    /(\d{2}\.\d{2}\.\d{3}\.\d{3}\.\d{3}(?:\.\d{3}){0,2})/,
  ];

  for (const pattern of refPatterns) {
    const match = (title + " " + text).match(pattern);
    if (match?.[1]) {
      return `CDPC-${match[1]}`;
    }
  }

  // Try to extract a date-based reference from the URL or filename
  const dateMatch = url.match(/(\d{8})/);
  if (dateMatch?.[1]) {
    const d = dateMatch[1];
    return `CDPC-${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }

  // Fall back to a hash of the URL for uniqueness
  const urlHash = simpleHash(url);
  return `CDPC-DOC-${urlHash}`;
}

/**
 * Simple string hash for generating stable short IDs.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return Math.abs(hash).toString(36).toUpperCase().padStart(6, "0");
}

/**
 * Extract the date from a URL filename (e.g. "20240228 ΑΠΟΦΑΣΗ...") or
 * from surrounding text.
 */
function extractDateFromContext(
  url: string,
  text: string,
): string {
  // Pattern: YYYYMMDD in URL
  const urlDateMatch = url.match(/(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (urlDateMatch) {
    return `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`;
  }

  // Pattern: "DD Month YYYY" or "DD/MM/YYYY" in text
  const dmyMatch = text.match(/(\d{1,2})[/.\s-](\d{1,2})[/.\s-](\d{4})/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  }

  // Greek month names
  const greekMonths: Record<string, string> = {
    "Ιανουαρίου": "01", "Φεβρουαρίου": "02", "Μαρτίου": "03",
    "Απριλίου": "04", "Μαΐου": "05", "Ιουνίου": "06",
    "Ιουλίου": "07", "Αυγούστου": "08", "Σεπτεμβρίου": "09",
    "Οκτωβρίου": "10", "Νοεμβρίου": "11", "Δεκεμβρίου": "12",
  };

  for (const [monthName, monthNum] of Object.entries(greekMonths)) {
    const regex = new RegExp(`(\\d{1,2})\\s+${monthName}\\s+(\\d{4})`);
    const match = text.match(regex);
    if (match) {
      return `${match[2]}-${monthNum}-${match[1]!.padStart(2, "0")}`;
    }
  }

  // English month names
  const enMonths: Record<string, string> = {
    January: "01", February: "02", March: "03", April: "04",
    May: "05", June: "06", July: "07", August: "08",
    September: "09", October: "10", November: "11", December: "12",
  };

  for (const [monthName, monthNum] of Object.entries(enMonths)) {
    const regex = new RegExp(`(\\d{1,2})\\s+${monthName}\\s+(\\d{4})`);
    const match = text.match(regex);
    if (match) {
      return `${match[2]}-${monthNum}-${match[1]!.padStart(2, "0")}`;
    }
  }

  return "";
}

/**
 * Detect the language of a URL or text snippet.
 */
function detectLanguage(url: string, text: string): "el" | "en" {
  if (url.includes("_en") || url.includes("/en/")) return "en";
  if (url.includes("_el") || url.includes("/el/")) return "el";
  // Check for Greek characters in text
  if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(text)) return "el";
  return "en";
}

/**
 * Infer category from URL path, filename, or link text.
 */
function inferCategory(url: string, text: string): string {
  const combined = (url + " " + text).toLowerCase();

  if (/αποφαση|απόφαση|decision|sanction/i.test(combined)) return "Απόφαση";
  if (/γνωμοδ[οό]τηση|opinion/i.test(combined)) return "Γνωμοδότηση";
  if (/ανακο[ιί]νωση|announcement/i.test(combined)) return "Ανακοίνωση";
  if (/κατευθυντ[ηή]ρι|guideline|guide|οδηγ[ιί]α/i.test(combined)) return "Κατευθυντήριες γραμμές";
  if (/σ[υύ]σταση|recommendation/i.test(combined)) return "Σύσταση";
  if (/εγκ[υύ]κλιος|circular/i.test(combined)) return "Εγκύκλιος";
  if (/ετ[ηή]σια\s+[εέ]κθεση|annual\s+report/i.test(combined)) return "Ετήσια Έκθεση";
  if (/νομοθεσ[ιί]α|legislation|law\s+\d/i.test(combined)) return "Νομοθεσία";
  if (/ομιλ[ιί]α|speech|speach/i.test(combined)) return "Ομιλία";

  return "unknown";
}

/**
 * Parse a Domino view page or section page and extract links to documents.
 */
function extractLinksFromPage(
  html: string,
  pageUrl: string,
): IndexEntry[] {
  const $ = cheerio.load(html);
  const entries: IndexEntry[] = [];
  const seenUrls = new Set<string>();

  // Strategy 1: Find all links to Domino documents (32-char UNIDs in URL)
  // Strategy 2: Find all links to PDF files (decisions are published as PDFs)
  // Strategy 3: Find links with ?OpenDocument in the URL

  $("a[href]").each((_i, el) => {
    const rawHref = $(el).attr("href") ?? "";
    if (!rawHref) return;

    const fullUrl = normaliseUrl(rawHref);
    const linkText = $(el).text().trim();

    // Skip navigation, anchors, external links, images, stylesheets
    if (
      fullUrl.includes("javascript:") ||
      fullUrl.startsWith("#") ||
      fullUrl.includes(".gif") ||
      fullUrl.includes(".jpg") ||
      fullUrl.includes(".png") ||
      fullUrl.includes(".css") ||
      fullUrl.includes(".js") ||
      fullUrl.includes("mailto:") ||
      (!fullUrl.includes("dataprotection.gov.cy") &&
        !rawHref.startsWith("/"))
    ) {
      return;
    }

    // Skip if already seen
    if (seenUrls.has(fullUrl)) return;

    // Only process Domino documents or PDFs
    const isDoc = isDominoDocUrl(rawHref);
    const isPdf = isPdfUrl(rawHref);

    if (!isDoc && !isPdf) return;

    // Skip home/nav pages themselves
    if (/home_el|home_en/i.test(rawHref) && rawHref.includes("opendocument")) {
      return;
    }

    seenUrls.add(fullUrl);

    // Get surrounding text for context (parent element text)
    const parentText = $(el).parent().text().trim().slice(0, 300);

    const title = linkText || decodeURIComponent(fullUrl.split("/").pop() ?? "");
    const date = extractDateFromContext(fullUrl, parentText);
    const language = detectLanguage(fullUrl, linkText);
    const categoryRaw = inferCategory(fullUrl, linkText + " " + parentText);
    const reference = extractReference(fullUrl, title, parentText);

    entries.push({
      reference,
      title: cleanTitle(title),
      date,
      categoryRaw,
      detailUrl: isPdf ? fullUrl : fullUrl,
      pdfUrl: isPdf ? fullUrl : null,
      language,
    });
  });

  return entries;
}

/**
 * Clean a title string: remove excessive whitespace, control chars, etc.
 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim();
}

async function runIndexPhase(flags: CliFlags): Promise<IndexEntry[]> {
  console.log("\n=== Phase 1: Index — crawl dataprotection.gov.cy sections ===\n");

  const allEntries: IndexEntry[] = [];
  const seenRefs = new Set<string>();

  for (const section of SECTION_VIEWS) {
    const url = `${BASE_URL}${section.path}`;
    console.log(`  Section: ${section.label}`);
    console.log(`  URL: ${url}`);

    let html: string;
    try {
      html = await fetchWithRetry(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${msg}`);
      console.log("  Skipping this section.\n");
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    const entries = extractLinksFromPage(html, url);

    // Deduplicate by reference
    let added = 0;
    for (const entry of entries) {
      // Skip entries with generic unknown category and no useful title
      if (entry.categoryRaw === "unknown" && entry.title.length < 10) continue;

      const key = entry.reference;
      if (!seenRefs.has(key)) {
        seenRefs.add(key);
        allEntries.push(entry);
        added++;
      }
    }

    console.log(`  Found ${entries.length} links, ${added} new (cumulative: ${allEntries.length})\n`);

    if (flags.limit > 0 && allEntries.length >= flags.limit) {
      console.log(`  Reached --limit ${flags.limit}, stopping index.`);
      break;
    }

    await sleep(RATE_LIMIT_MS);
  }

  // Sort by date (most recent first), entries without dates go last
  allEntries.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  // Apply limit
  if (flags.limit > 0 && allEntries.length > flags.limit) {
    allEntries.splice(flags.limit);
  }

  // Persist index
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(allEntries, null, 2));
  console.log(`  Saved ${allEntries.length} index entries to ${INDEX_PATH}`);

  // Print category distribution
  const catCounts = new Map<string, number>();
  for (const e of allEntries) {
    catCounts.set(e.categoryRaw, (catCounts.get(e.categoryRaw) ?? 0) + 1);
  }
  console.log("\n  Category distribution:");
  for (const [cat, count] of Array.from(catCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${cat}: ${count}`);
  }

  return allEntries;
}

// ---------------------------------------------------------------------------
// Phase 2: Content — fetch detail pages and upsert
// ---------------------------------------------------------------------------

interface ParsedDetail {
  title: string;
  bodyText: string;
  summary: string;
  fineAmount: number | null;
  entityName: string | null;
  gdprArticles: string[];
  topics: string[];
  language: string;
}

/**
 * Extract readable text from a PDF buffer.
 *
 * Since we cannot reliably parse PDFs without a heavyweight dependency,
 * we extract what we can from the raw bytes: text streams between
 * parentheses in PDF operators, and any UTF-8 strings. This is a
 * best-effort approach; many PDFs will yield limited or garbled text.
 * For production use, consider adding pdf-parse or similar.
 */
function extractTextFromPdfBuffer(buf: Buffer): string {
  // Try to extract text between BT...ET blocks (PDF text objects)
  const str = buf.toString("latin1");
  const chunks: string[] = [];

  // Extract text from Tj and TJ operators (simple text extraction)
  const tjPattern = /\(([^)]{2,})\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tjPattern.exec(str)) !== null) {
    if (match[1]) {
      chunks.push(match[1]);
    }
  }

  // Extract text from TJ arrays: [(text) num (text) ...] TJ
  const tjArrayPattern = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjArrayPattern.exec(str)) !== null) {
    if (!match[1]) continue;
    const innerPattern = /\(([^)]*)\)/g;
    let inner: RegExpExecArray | null;
    while ((inner = innerPattern.exec(match[1])) !== null) {
      if (inner[1] && inner[1].length > 1) {
        chunks.push(inner[1]);
      }
    }
  }

  if (chunks.length > 0) {
    return chunks.join(" ").replace(/\s+/g, " ").trim();
  }

  // Fallback: extract any readable ASCII/UTF-8 sequences
  const readable = buf
    .toString("utf-8", 0, Math.min(buf.length, 500000))
    .replace(/[^\x20-\x7E\u0370-\u03FF\u1F00-\u1FFF\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return readable.slice(0, 50000);
}

/**
 * Parse an HTML detail page from the Domino NSF site.
 */
function parseHtmlDetailPage(html: string): ParsedDetail {
  const $ = cheerio.load(html);

  // Title: try various Domino patterns
  const title =
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    $(".lotusPostTitle").text().trim() ||
    "";

  // Body: Domino pages often use divs with specific classes or just raw content
  let bodyText = "";

  // Try common Domino content areas
  const contentSelectors = [
    ".lotusPostBody",
    ".lotusContent",
    ".xspTextComputedField",
    "#content",
    ".content",
    "td.xspTextComputedField",
    "form table td",
  ];

  for (const selector of contentSelectors) {
    const text = $(selector).text().trim();
    if (text.length > bodyText.length) {
      bodyText = text;
    }
  }

  // If still too short, grab all paragraph and div text from body
  if (bodyText.length < 100) {
    const paragraphs: string[] = [];
    $("p, div.content, td").each((_i, el) => {
      const text = $(el).text().trim();
      if (text.length > 20 && !text.includes("Copyright") && !text.includes("cookie")) {
        paragraphs.push(text);
      }
    });
    if (paragraphs.join("\n\n").length > bodyText.length) {
      bodyText = paragraphs.join("\n\n");
    }
  }

  // Clean up body text
  bodyText = bodyText.replace(/\s+/g, " ").trim();

  // Summary: first substantial block of text (> 80 chars)
  let summary = "";
  $("p, div").each((_i, el) => {
    if (summary) return;
    const text = $(el).text().trim();
    if (text.length > 80 && text.length < 1000) {
      summary = text;
    }
  });

  const fineAmount = extractFineAmount(bodyText || title);
  const entityName = extractEntityName(title, bodyText);
  const gdprArticles = extractGdprArticles(bodyText);
  const topics = extractTopicsFromText(bodyText);
  const language = /[\u0370-\u03FF\u1F00-\u1FFF]/.test(bodyText) ? "el" : "en";

  return {
    title,
    bodyText,
    summary,
    fineAmount,
    entityName,
    gdprArticles,
    topics,
    language,
  };
}

/**
 * Extract fine amount in EUR from text.
 * Handles Greek and English patterns, European number formatting.
 */
function extractFineAmount(text: string): number | null {
  const patterns = [
    // "EUR 20,000" or "EUR 20.000"
    /EUR\s+([\d.,]+)/gi,
    // "20.000 EUR"
    /([\d.,]+)\s*EUR/gi,
    // "20.000 ευρώ"
    /([\d.,]+)\s*ευρώ/gi,
    // "20.000€"
    /([\d.,]+)\s*€/gi,
    // "fine of EUR X" (English)
    /fine\s+of\s+(?:EUR\s+)?([\d.,]+)/gi,
    // "πρόστιμο X" (Greek: fine X)
    /πρόστιμο\s+(?:ύψους\s+)?([\d.,]+)/gi,
    // "πρόστιμο ... ευρώ"
    /πρόστιμο[^.]{0,80}?([\d.,]+)\s*(?:ευρώ|€|EUR)/gi,
    // "administrative fine of"
    /administrative\s+fine\s+of\s+(?:EUR\s*)?([\d.,]+)/gi,
    // "διοικητικό πρόστιμο"
    /διοικητικ[οό]\s+πρόστιμο[^.]{0,60}?([\d.,]+)/gi,
  ];

  let best: number | null = null;

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1];
      if (!raw) continue;
      const parsed = parseEuropeanNumber(raw);
      if (parsed !== null && parsed > 0 && (best === null || parsed > best)) {
        best = parsed;
      }
    }
  }

  return best;
}

/**
 * Parse a European-format number: "20.000" or "20,000" or "30.000,50".
 */
function parseEuropeanNumber(raw: string): number | null {
  let cleaned = raw.trim();

  // European: dots as thousands, comma as decimal (e.g. "20.000,50")
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  // US-style: commas as thousands (e.g. "20,000.50")
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, "");
  }
  // Plain integer with dot thousands (e.g. "30.000")
  else if (/^\d{1,3}\.\d{3}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Extract entity name from title or body.
 * Cypriot decisions often mention the entity in the title or early in the body.
 */
function extractEntityName(title: string, body: string): string | null {
  // Pattern: "... — Entity Name" or "... - Entity Name"
  const dashMatch = title.match(/[—–-]\s*(.+?)(?:\s*\(|$)/);
  if (dashMatch?.[1] && dashMatch[1].length > 2 && dashMatch[1].length < 100) {
    return dashMatch[1].trim();
  }

  // Pattern: "ΑΠΟΦΑΣΗ Entity" or "Decision Entity"
  const decisionMatch = title.match(
    /(?:ΑΠΟΦΑΣΗ|Απόφαση|Decision)\s+(.+?)(?:\s*[-–—.]|$)/i,
  );
  if (decisionMatch?.[1] && decisionMatch[1].length > 2 && decisionMatch[1].length < 80) {
    return decisionMatch[1].trim();
  }

  // Pattern: "κατά" (against) in body
  const kataMatch = body.match(
    /κατά\s+(?:της?\s+)?(?:εταιρείας?\s+)?(.+?)(?:\s+για\b|[.,])/i,
  );
  if (kataMatch?.[1] && kataMatch[1].length > 2 && kataMatch[1].length < 100) {
    return kataMatch[1].trim();
  }

  // Pattern: "against" in English body
  const againstMatch = body.match(
    /against\s+(?:the\s+)?(?:company\s+)?(.+?)(?:\s+for\b|[.,])/i,
  );
  if (againstMatch?.[1] && againstMatch[1].length > 2 && againstMatch[1].length < 100) {
    return againstMatch[1].trim();
  }

  return null;
}

/**
 * Extract GDPR article numbers from text.
 * Matches English and Greek patterns.
 */
function extractGdprArticles(text: string): string[] {
  const articles = new Set<string>();

  // English: "Art. 5", "Article 6(1)(a)", "Art 35"
  const enPattern = /\b(?:Art(?:icle)?\.?\s*)(\d{1,3})/gi;
  let match: RegExpExecArray | null;
  while ((match = enPattern.exec(text)) !== null) {
    if (match[1]) articles.add(match[1]);
  }

  // Greek: "άρθρο 35", "άρθρου 35", "Αρ. 5"
  const elPattern = /\b(?:άρθρ(?:ο|ου|ων|α)|Αρ\.?)\s*(\d{1,3})/gi;
  while ((match = elPattern.exec(text)) !== null) {
    if (match[1]) articles.add(match[1]);
  }

  // Filter to plausible GDPR article numbers (1–99)
  return Array.from(articles)
    .filter((n) => {
      const num = parseInt(n, 10);
      return num >= 1 && num <= 99;
    })
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

/**
 * Extract topic IDs from text by matching against known keywords.
 */
function extractTopicsFromText(text: string): string[] {
  const topics = new Set<string>();

  for (const [keyword, topicId] of Object.entries(THEMATIC_TO_TOPIC)) {
    if (text.includes(keyword)) {
      topics.add(topicId);
    }
  }

  // Additional keyword-based detection
  const keywordMap: [RegExp, string][] = [
    [/cookie|tracker|ιχνηλάτ/i, "cookies"],
    [/βιντεοεπιτήρηση|video\s+surveillance|CCTV|κάμερα/i, "video_surveillance"],
    [/εργαζ[οό]μεν|employee|εργοδ[οό]τ/i, "employee_monitoring"],
    [/παραβίαση\s+δεδομένων|data\s+breach|breach\s+notification/i, "data_breach"],
    [/συγκατάθεση|consent/i, "consent"],
    [/εκτίμηση\s+αντικτύπου|impact\s+assessment|DPIA/i, "dpia"],
    [/διαβίβαση|transfer|μεταφορ/i, "transfers"],
    [/δικαίωμα|right\s+of\s+access|right\s+to\s+erasure|data\s+subject/i, "data_subject_rights"],
  ];

  for (const [pattern, topicId] of keywordMap) {
    if (pattern.test(text)) {
      topics.add(topicId);
    }
  }

  return Array.from(topics);
}

/**
 * Classify an entry as a "decision" (for decisions table) or
 * "guideline" (for guidelines table) based on its category.
 */
function classifyEntry(categoryRaw: string): "decision" | "guideline" {
  const type = CATEGORY_MAP[categoryRaw] ?? categoryRaw.toLowerCase();
  if (
    type === "guide" ||
    type === "directive" ||
    type === "recommendation" ||
    type === "guideline" ||
    type === "circular" ||
    type === "code_of_conduct" ||
    type === "legislation" ||
    type === "annual_report"
  ) {
    return "guideline";
  }
  // Decisions, sanctions, opinions, announcements → decision table
  return "decision";
}

// ---------------------------------------------------------------------------
// Progress tracking (for --resume)
// ---------------------------------------------------------------------------

interface ProgressState {
  completedRefs: string[];
  lastUpdated: string;
}

function loadProgress(): ProgressState {
  if (existsSync(PROGRESS_PATH)) {
    try {
      return JSON.parse(
        readFileSync(PROGRESS_PATH, "utf-8"),
      ) as ProgressState;
    } catch {
      // Corrupted file — start fresh
    }
  }
  return { completedRefs: [], lastUpdated: new Date().toISOString() };
}

function saveProgress(state: ProgressState): void {
  state.lastUpdated = new Date().toISOString();
  writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

function openDb(force: boolean): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (force && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log(`Deleted existing database at ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  return db;
}

function upsertDecision(
  db: Database.Database,
  entry: IndexEntry,
  detail: ParsedDetail,
): void {
  const type = CATEGORY_MAP[entry.categoryRaw] ?? "decision";

  db.prepare(
    `INSERT INTO decisions
       (reference, title, date, type, entity_name, fine_amount, summary, full_text, topics, gdpr_articles, status)
     VALUES
       (@reference, @title, @date, @type, @entity_name, @fine_amount, @summary, @full_text, @topics, @gdpr_articles, @status)
     ON CONFLICT(reference) DO UPDATE SET
       title        = @title,
       date         = @date,
       type         = @type,
       entity_name  = COALESCE(@entity_name, decisions.entity_name),
       fine_amount  = COALESCE(@fine_amount, decisions.fine_amount),
       summary      = @summary,
       full_text    = @full_text,
       topics       = @topics,
       gdpr_articles= @gdpr_articles,
       status       = @status`,
  ).run({
    reference: entry.reference,
    title: detail.title || entry.title,
    date: entry.date || detail.bodyText.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null,
    type,
    entity_name: detail.entityName ?? null,
    fine_amount: detail.fineAmount ?? null,
    summary: detail.summary || null,
    full_text: detail.bodyText || entry.title,
    topics:
      detail.topics.length > 0 ? JSON.stringify(detail.topics) : null,
    gdpr_articles:
      detail.gdprArticles.length > 0
        ? JSON.stringify(detail.gdprArticles)
        : null,
    status: "final",
  });
}

function upsertGuideline(
  db: Database.Database,
  entry: IndexEntry,
  detail: ParsedDetail,
): void {
  const type = CATEGORY_MAP[entry.categoryRaw] ?? "guideline";

  const existing = db
    .prepare("SELECT id FROM guidelines WHERE reference = ?")
    .get(entry.reference) as { id: number } | undefined;

  const params = {
    reference: entry.reference,
    title: detail.title || entry.title,
    date: entry.date || null,
    type,
    summary: detail.summary || null,
    full_text: detail.bodyText || entry.title,
    topics:
      detail.topics.length > 0 ? JSON.stringify(detail.topics) : null,
    language: detail.language || entry.language,
  };

  if (existing) {
    db.prepare(
      `UPDATE guidelines SET
         title     = @title,
         date      = @date,
         type      = @type,
         summary   = @summary,
         full_text = @full_text,
         topics    = @topics,
         language  = @language
       WHERE reference = @reference`,
    ).run(params);
  } else {
    db.prepare(
      `INSERT INTO guidelines
         (reference, title, date, type, summary, full_text, topics, language)
       VALUES
         (@reference, @title, @date, @type, @summary, @full_text, @topics, @language)`,
    ).run(params);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Content fetch + upsert
// ---------------------------------------------------------------------------

async function fetchAndParseEntry(entry: IndexEntry): Promise<ParsedDetail> {
  const url = entry.detailUrl;

  // If the entry is a PDF, fetch binary and extract text
  if (isPdfUrl(url) || entry.pdfUrl) {
    const pdfUrl = entry.pdfUrl || url;
    console.log(`    Fetching PDF: ${pdfUrl.slice(0, 100)}...`);

    const pdfBuf = await fetchBinaryWithRetry(pdfUrl);
    const pdfText = extractTextFromPdfBuffer(pdfBuf);

    return {
      title: entry.title,
      bodyText: pdfText || entry.title,
      summary: pdfText.slice(0, 500),
      fineAmount: extractFineAmount(pdfText),
      entityName: extractEntityName(entry.title, pdfText),
      gdprArticles: extractGdprArticles(pdfText),
      topics: extractTopicsFromText(pdfText),
      language: detectLanguage(pdfUrl, pdfText),
    };
  }

  // Otherwise, fetch HTML detail page
  const html = await fetchWithRetry(url);
  const detail = parseHtmlDetailPage(html);

  // Check if the HTML page contains a PDF link we should also fetch
  const $ = cheerio.load(html);
  let pdfLink: string | null = null;
  for (const el of $("a[href]").toArray()) {
    if (pdfLink) break;
    const href = $(el).attr("href") ?? "";
    if (isPdfUrl(href)) {
      pdfLink = normaliseUrl(href);
    }
  }

  // If a PDF is found and the HTML body is short, supplement with PDF text
  if (pdfLink && detail.bodyText.length < 200) {
    console.log(`    Supplementing with PDF: ${pdfLink.slice(0, 100)}...`);
    try {
      await sleep(RATE_LIMIT_MS);
      const pdfBuf = await fetchBinaryWithRetry(pdfLink);
      const pdfText = extractTextFromPdfBuffer(pdfBuf);
      if (pdfText.length > detail.bodyText.length) {
        detail.bodyText = pdfText;
        detail.summary = pdfText.slice(0, 500);
        // Re-extract metadata from the richer text
        detail.fineAmount =
          detail.fineAmount ?? extractFineAmount(pdfText);
        detail.entityName =
          detail.entityName ?? extractEntityName(detail.title, pdfText);
        detail.gdprArticles =
          detail.gdprArticles.length > 0
            ? detail.gdprArticles
            : extractGdprArticles(pdfText);
        detail.topics =
          detail.topics.length > 0
            ? detail.topics
            : extractTopicsFromText(pdfText);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`    WARN: failed to fetch PDF: ${msg}`);
    }
  }

  return detail;
}

async function runContentPhase(
  entries: IndexEntry[],
  flags: CliFlags,
): Promise<void> {
  console.log(
    "\n=== Phase 2: Content — fetch detail pages and upsert ===\n",
  );

  if (flags.dryRun) {
    console.log("  DRY RUN — no database writes will occur.\n");
  }

  const db = flags.dryRun ? null : openDb(flags.force);

  // Load resume state
  const progress = flags.resume
    ? loadProgress()
    : { completedRefs: [], lastUpdated: "" };
  const completedSet = new Set(progress.completedRefs);

  let fetched = 0;
  let skipped = 0;
  let errors = 0;
  let decisionsUpserted = 0;
  let guidelinesUpserted = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const key = entry.reference;

    // Skip if already completed (--resume)
    if (flags.resume && completedSet.has(key)) {
      skipped++;
      continue;
    }

    // Rate limit
    if (fetched > 0) {
      await sleep(RATE_LIMIT_MS);
    }

    console.log(
      `  [${i + 1}/${entries.length}] ${entry.reference} — ${entry.title.slice(0, 70)}${entry.title.length > 70 ? "..." : ""}`,
    );

    let detail: ParsedDetail;
    try {
      detail = await fetchAndParseEntry(entry);
      fetched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ERROR fetching: ${msg}`);
      errors++;
      continue;
    }

    if (detail.bodyText.length < 20) {
      console.warn(
        `    WARN: body too short (${detail.bodyText.length} chars), may be a stub page.`,
      );
    }

    const table = classifyEntry(entry.categoryRaw);

    if (flags.dryRun) {
      console.log(
        `    [dry-run] ${table} | fine=${detail.fineAmount ?? "none"} | ` +
          `entity=${detail.entityName ?? "none"} | ` +
          `gdpr=[${detail.gdprArticles.join(",")}] | ` +
          `topics=[${detail.topics.join(",")}] | ` +
          `body=${detail.bodyText.length} chars | ` +
          `lang=${detail.language}`,
      );
    } else {
      try {
        if (table === "decision") {
          upsertDecision(db!, entry, detail);
          decisionsUpserted++;
        } else {
          upsertGuideline(db!, entry, detail);
          guidelinesUpserted++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`    ERROR inserting: ${msg}`);
        errors++;
        continue;
      }
    }

    // Track progress
    completedSet.add(key);
    progress.completedRefs = Array.from(completedSet);

    // Save progress every 25 entries
    if (!flags.dryRun && fetched % 25 === 0) {
      saveProgress(progress);
    }
  }

  // Final progress save
  if (!flags.dryRun) {
    saveProgress(progress);
  }

  if (db) {
    const decisionCount = (
      db.prepare("SELECT count(*) as cnt FROM decisions").get() as {
        cnt: number;
      }
    ).cnt;
    const guidelineCount = (
      db.prepare("SELECT count(*) as cnt FROM guidelines").get() as {
        cnt: number;
      }
    ).cnt;

    db.close();

    console.log("\n  Content phase complete.");
    console.log(`    Fetched:    ${fetched}`);
    console.log(`    Skipped:    ${skipped} (already completed)`);
    console.log(`    Errors:     ${errors}`);
    console.log(
      `    Decisions:  ${decisionsUpserted} upserted (total in DB: ${decisionCount})`,
    );
    console.log(
      `    Guidelines: ${guidelinesUpserted} upserted (total in DB: ${guidelineCount})`,
    );
  } else {
    console.log("\n  Dry run complete.");
    console.log(`    Would fetch: ${fetched}`);
    console.log(`    Skipped:     ${skipped}`);
    console.log(`    Errors:      ${errors}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags();

  console.log("CDPC Ingestion Crawler");
  console.log("======================");
  console.log(`  Database:    ${DB_PATH}`);
  console.log(`  Dry run:     ${flags.dryRun}`);
  console.log(`  Resume:      ${flags.resume}`);
  console.log(`  Force:       ${flags.force}`);
  console.log(`  Limit:       ${flags.limit || "none"}`);
  console.log(
    `  Target:      dataprotection.gov.cy (Commissioner for Personal Data Protection)`,
  );
  console.log(
    `  TLS verify:  disabled (self-signed cert on target site)`,
  );

  // Phase 1: build or load index
  let index: IndexEntry[];

  if (flags.resume && existsSync(INDEX_PATH)) {
    console.log(`\n  Loading cached index from ${INDEX_PATH}...`);
    index = JSON.parse(
      readFileSync(INDEX_PATH, "utf-8"),
    ) as IndexEntry[];
    console.log(`  Loaded ${index.length} entries from cache.`);
  } else {
    index = await runIndexPhase(flags);
  }

  if (index.length === 0) {
    console.log("\n  No entries found. Nothing to do.");
    return;
  }

  // Apply limit to content phase
  if (flags.limit > 0 && index.length > flags.limit) {
    index = index.slice(0, flags.limit);
  }

  // Phase 2: fetch detail pages and upsert
  await runContentPhase(index, flags);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(
    `\nFatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
