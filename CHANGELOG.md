# Changelog

All notable changes to the n8n-nodes-mailsafepro package will be documented in this file.

## [1.0.1] - 2026-01-04

### Fixed
- Updated base URL from `https://api.mailsafepro.com` to `https://api.mailsafepro.es`
- Removed `/v1/` prefix from all API routes to match current API structure:
  - `/v1/jobs` → `/jobs`
  - `/v1/jobs/{id}` → `/jobs/{id}`
  - `/v1/jobs/{id}/results` → `/jobs/{id}/results`
  - `/v1/jobs/{id}/cancel` → `/jobs/{id}/cancel`
  - `/v1/account/usage` → `/billing/usage`
  - `/v1/account/plan` → `/billing/subscription`
- All validation routes (`/validate/email`, `/validate/batch`) were already correct

## [1.0.0] - 2025-12-XX

### Added
- Initial release of n8n community node for MailSafePro
- Email validation operations (single, multiple, quick check)
- Batch job management (create, status, results, wait, list, cancel)
- Account operations (usage, plan)
- Risk scoring and quality analysis
- SMTP verification support
- Comprehensive error handling and retry logic
