# Cypriot Data Protection MCP

<!-- ANSVAR-CTA-BEGIN -->
> **The Cypriot data-protection corpus is now served through the Ansvar Gateway.** Connect your AI assistant (Claude, Copilot, Cursor, custom MCP client) to `https://gateway.ansvar.eu/mcp` — one OAuth connection, free tier available, covering this corpus plus EU regulations, national law across dozens of audited jurisdictions (Europe + the US), and CVE/security intelligence, every result with a verbatim source citation. Start at https://ansvar.eu/docs/quickstart

### Connect

**Claude Code** (one line):

```bash
claude mcp add ansvar --transport http https://gateway.ansvar.eu/mcp
```

**Claude Desktop / Cursor** — add to `claude_desktop_config.json` (or `mcp.json`):

```json
{
  "mcpServers": {
    "ansvar": {
      "type": "url",
      "url": "https://gateway.ansvar.eu/mcp"
    }
  }
}
```

**Claude.ai** — Settings → Connectors → Add custom connector → paste `https://gateway.ansvar.eu/mcp`

First request opens an OAuth signup flow (setup details: [ansvar.eu/docs/quickstart](https://ansvar.eu/docs/quickstart)). After signup, your client is bound to your account; tier (free / premium / team / company) determines fan-out, quota, and which downstream MCPs are reachable.

---

## Self-host this MCP

You can also clone this repo and build the corpus yourself. The schema,
fetcher, and tool implementations all live here. What is not in the repo is
the pre-built database — TDM and standards-licensing constraints on the
upstream sources mean we host the corpus on Ansvar infrastructure rather
than redistribute it as a public artifact.

Build your own: run this repo's ingestion script (entry-point varies per
repo — typically `scripts/ingest.sh`, `npm run ingest`, or `make ingest`;
check the repo root).
<!-- ANSVAR-CTA-END -->


**Cypriot data protection data for AI compliance tools.**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CI](https://github.com/Ansvar-Systems/cypriot-data-protection-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/cypriot-data-protection-mcp/actions/workflows/ci.yml)

Query Cypriot data protection data -- regulations, decisions, and requirements from Commissioner for Personal Data Protection -- directly from Claude, Cursor, or any MCP-compatible client.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Available Tools (8)

| Tool | Description |
|------|-------------|
| `cy_dp_search_decisions` | Full-text search across CDPC decisions and sanctions. Returns matching decisions with reference, entity name, fine amount, and GDPR articles cited. |
| `cy_dp_get_decision` | Get a specific CDPC decision by reference number. |
| `cy_dp_search_guidelines` | Search CDPC guidance documents: recommendations, guidelines, and FAQs on GDPR implementation in Cyprus. |
| `cy_dp_get_guideline` | Get a specific CDPC guidance document by its database ID. |
| `cy_dp_list_topics` | List all covered data protection topics with English names. Use topic IDs to filter decisions and guidelines. |
| `cy_dp_about` | Return metadata about this MCP server: version, data source, coverage, and tool list. |
| `cy_dp_list_sources` | List all data sources with provenance metadata (authority, URL, data types, languages, known limitations). |
| `cy_dp_check_data_freshness` | Report record counts and latest dates per source to check how current the data is. |

All tools return structured data. See [TOOLS.md](TOOLS.md) for full parameter documentation.

---

## Data Sources and Freshness

All content is sourced from official Cypriot regulatory publications:

- **Commissioner for Personal Data Protection** -- Official regulatory authority

### Data Currency

- Database updates are periodic and may lag official publications
- Freshness checks run via GitHub Actions workflows
- Last-updated timestamps in tool responses indicate data age

See [COVERAGE.md](COVERAGE.md) for full corpus scope and `data/coverage.json` for machine-readable provenance metadata.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Not Regulatory Advice

> **THIS TOOL IS NOT REGULATORY OR LEGAL ADVICE**
>
> Regulatory data is sourced from official publications by Commissioner for Personal Data Protection. However:
> - This is a **research tool**, not a substitute for professional regulatory counsel
> - **Verify all references** against primary sources before making compliance decisions
> - **Coverage may be incomplete** -- do not rely solely on this for regulatory research

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. See [PRIVACY.md](PRIVACY.md) for details.

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/cypriot-data-protection-mcp
cd cypriot-data-protection-mcp
npm install
npm run build
```

### Running Locally

```bash
npm run dev                                       # Start MCP server (HTTP)
npx @anthropic/mcp-inspector node dist/src/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run seed     # Seed SQLite database with sample data
npm run ingest   # Ingest data from official CDPC sources
```

---

## More Ansvar MCPs

Full fleet coverage at [ansvar.eu/coverage](https://ansvar.eu/coverage).
## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

**License code:** `Cyprus-PSI` — statutory Cyprus public-sector information re-use regime.

**Statutory basis:** Cyprus Law 143(I)/2021 transposes [EU Directive 2019/1024](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32019L1024) on Open Data and the re-use of public sector information. Article 8 of the directive mandates commercial re-use of public-sector documents.

The Office of the Commissioner for Personal Data Protection (CDPC) is a public-sector body of the Republic of Cyprus within scope of Law 143(I)/2021. The CDPC [disclaimer page](https://web.archive.org/web/2025/http://www.dataprotection.gov.cy/dataprotection/dataprotection.nsf/disclaimer_en/disclaimer_en?OpenDocument) is silent on reuse; the Republic-of-Cyprus copyright assertion does not displace the statutory PSI regime.

Commercial reuse, derivatives, and redistribution are permitted with attribution. See `sources.yml` for the anchored URL pattern and full provenance metadata; see `data/coverage.json` for corpus scope.

**Operational note:** the upstream TLS certificate at `dataprotection.gov.cy` returns a not-trusted error to direct browsers. This is an upstream-publisher issue tracked in the at-risk register under operational blockers, not licensing.

Attribution: "Source: Office of the Commissioner for Personal Data Protection, Republic of Cyprus. Reproduced under Cyprus public-sector information re-use regime (Law 143(I)/2021, transposing EU Directive 2019/1024)."

---

## About Ansvar Systems

We build AI-powered compliance and legal research tools for the European market. Our MCP fleet provides structured, verified regulatory data to AI assistants -- so compliance professionals can work with accurate sources instead of guessing.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
