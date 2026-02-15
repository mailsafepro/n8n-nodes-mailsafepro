# n8n-nodes-mailsafepro

<div align="center">

![n8n](https://img.shields.io/badge/n8n-community--node-orange?logo=n8n)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.1-green)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![Tests](https://img.shields.io/badge/tests-32%20passing-success)

**Enterprise-grade email validation node for [n8n](https://n8n.io) workflow automation**

[Features](#-features) • [Installation](#-installation) • [Operations](#-operations) • [Examples](#-example-workflows) • [API Reference](#-api-reference) • [Support](#-support)

</div>

---

## 🎯 Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| ✅ **Single Validation** | Real-time email validation with full analysis |
| 📊 **Batch Validation** | Process up to 10,000 emails asynchronously |
| ⏳ **Wait for Completion** | Built-in polling with configurable timeout |
| ⚡ **Quick Check** | Fast syntax/domain validation without SMTP |
| 🔄 **Auto-Retry** | Exponential backoff for rate limit handling |
| 📈 **Statistics** | Automatic batch statistics calculation |

### Validation Features

| Feature | Description |
|---------|-------------|
| 🔍 **SMTP Verification** | Real mailbox existence checking |
| ⚠️ **Risk Scoring** | Multi-factor risk assessment (0-1 scale) |
| 🛡️ **DNS Security** | SPF, DKIM, DMARC validation |
| 🚫 **Spam Trap Detection** | Identify honeypot addresses |
| 📧 **Disposable Detection** | Block 10,000+ temporary email services |
| 🏢 **Role Email Detection** | Identify generic addresses (admin@, info@) |
| 🎯 **Catch-All Detection** | Identify domains accepting all emails |

### Enriched Output

Every validation result includes computed fields for easy workflow logic:

| Field | Type | Description |
|-------|------|-------------|
| `risk_level` | string | `low` / `medium` / `high` |
| `quality_tier` | string | `excellent` / `good` / `fair` / `poor` |
| `is_safe_to_send` | boolean | Safe to send (valid + low risk) |
| `is_high_risk` | boolean | Risk score ≥ 0.7 |
| `should_review` | boolean | Medium risk, needs manual review |
| `recommendation` | string | Human-readable action recommendation |
| `deliverability_status` | string | `high` / `medium` / `low` / `unknown` |

---

## 📦 Installation

### Community Nodes (Recommended)

1. Go to **Settings** → **Community Nodes**
2. Click **Install**
3. Enter `n8n-nodes-mailsafepro`
4. Click **Install**

### Manual Installation

```bash
cd ~/.n8n
npm install n8n-nodes-mailsafepro
```

### Docker

```yaml
# docker-compose.yml
services:
  n8n:
    image: n8nio/n8n
    environment:
      - N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom
    volumes:
      - ./custom:/home/node/.n8n/custom
```

Then install the package in the custom directory.

---

## ☁️ n8n Cloud (No Community Nodes)

If you're using **n8n Cloud**, you can still use MailSafePro with the built-in **HTTP Request** node. Follow these steps:

### 1. Get Your API Key

1. Sign up at [mailsafepro.com](https://mailsafepro.com)
2. Go to your **Dashboard** → **API Keys**
3. Copy your **Default API Key**

### 2. Add Credentials

1. Go to **Credentials** → **New**
2. Select **Header Auth**
3. Name: `MailSafePro API`
4. Add header:
   - **Name:** `X-API-Key`
   - **Value:** Your MailSafePro API Key (e.g., `msp_live_xxxxxxxxxxxx`)
5. Click **Save**

### 3. Use in Workflows

#### Validate Single Email

1. Add an **HTTP Request** node
2. Configure:
   - **Method:** `POST`
   - **URL:** `https://mailsafepro-api.fly.dev/api/v1/validate/email`
   - **Authentication:** `Header Auth` → Select `MailSafePro API`
   - **Body Content Type:** `JSON`
   - **Body:** `{ "email": "{{ $json.email }}" }`
3. Connect to your data source

#### Validate Multiple Emails (Batch)

1. Add an **HTTP Request** node
2. Configure:
   - **Method:** `POST`
   - **URL:** `https://mailsafepro-api.fly.dev/api/v1/validate/batch/sync`
   - **Authentication:** `Header Auth` → Select `MailSafePro API`
   - **Body Content Type:** `JSON`
   - **Body:** `{ "emails": "{{ $json.emails }}" }`
   - *(emails should be a comma-separated string)*

#### Quick Check (Fast)

1. Add an **HTTP Request** node
2. Configure:
   - **Method:** `POST`
   - **URL:** `https://mailsafepro-api.fly.dev/api/v1/validate/quick`
   - **Authentication:** `Header Auth` → Select `MailSafePro API`
   - **Body Content Type:** `JSON`
   - **Body:** `{ "email": "{{ $json.email }}" }`

### 4. Import Example Workflows

We provide ready-to-use workflow templates for n8n Cloud:

| Workflow | Description | File |
|----------|-------------|------|
| Validate Signups | Validate new user signups in real-time | `n8n-cloud-validate-signups.json` |
| Batch Cleanup | Clean your email list weekly | `n8n-cloud-clean-email-list.json` |
| Lead Scoring | Score leads based on email quality | `n8n-cloud-lead-scoring.json` |

**To import:**
1. In n8n, go to **Workflows** → **Import from File**
2. Select the JSON file
3. Update the credentials reference if needed
4. Configure your webhook URLs (replace `https://your-api.com/...` with your actual endpoints)

### Example: Form Submission Validation

```
[Webhook: Form] → [HTTP Request: Validate] → [IF: is_safe_to_send]
                                                   ├─ true → [Create Row]
                                                   └─ false → [Return Error]
```

---

## 🔑 Configuration

### Get Your API Key

1. Sign up at [mailsafepro.com](https://mailsafepro.com)
2. Go to your **Dashboard**
3. Copy your **API Key**

### Add Credentials in n8n

1. Go to **Credentials** → **New**
2. Search for **MailSafePro**
3. Enter your API Key
4. *(Optional)* Change Base URL for self-hosted instances
5. Click **Save**

---

## 📋 Operations

### Email Resource

#### Validate Single

Full validation of a single email address with SMTP verification.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Email | string | ✅ | - | Email address to validate |
| Check SMTP | boolean | ❌ | true | Perform SMTP mailbox verification |
| Include Raw DNS | boolean | ❌ | false | Include full DNS records |
| Timeout | number | ❌ | 30 | Request timeout in seconds |

<details>
<summary><b>Example Output</b></summary>

```json
{
  "email": "user@gmail.com",
  "valid": true,
  "status": "deliverable",
  "risk_score": 0.15,
  "quality_score": 0.89,
  "risk_level": "low",
  "quality_tier": "excellent",
  "is_safe_to_send": true,
  "is_high_risk": false,
  "should_review": false,
  "recommendation": "✅ Safe to send",
  "deliverability_status": "high",
  "provider_analysis": {
    "provider": "google",
    "reputation": 0.95
  },
  "smtp_validation": {
    "checked": true,
    "mailbox_exists": true
  },
  "validated_at": "2026-01-04T12:00:00.000Z"
}
```
</details>

#### Validate Multiple (Sync)

Validate multiple emails synchronously (max 100).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Emails | string | ✅ | - | Comma/newline/semicolon separated |
| Check SMTP | boolean | ❌ | false | SMTP verification |
| Return Individual Results | boolean | ❌ | true | Split into separate items |
| Include Statistics | boolean | ❌ | true | Include batch statistics |

#### Quick Check

Fast syntax and domain validation without SMTP (ideal for real-time form validation).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Email | string | ✅ | Email address to check |

---

### Batch Job Resource

#### Create Job

Create an async batch validation job for large lists.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Emails | string | ✅ | - | List of emails (max 10,000) |
| Check SMTP | boolean | ❌ | false | SMTP verification |
| Priority | select | ❌ | normal | `low` / `normal` / `high` |
| Callback URL | string | ❌ | - | Webhook for completion |
| Job Name | string | ❌ | - | Identifier for the job |
| Deduplicate | boolean | ❌ | true | Remove duplicates |

#### Get Status

Check the current status of a batch job.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Job ID | string | ✅ | The batch job ID |

**Returns:** Status with `progress_percent`, `is_completed`, `is_processing`, `is_failed`

#### Get Results

Retrieve validation results from a completed job.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Job ID | string | ✅ | - | The batch job ID |
| Page | number | ❌ | 1 | Page number |
| Page Size | number | ❌ | 100 | Results per page (max 1000) |
| Filter Status | select | ❌ | All | Filter by validation status |
| Return Individual Results | boolean | ❌ | false | Split into items |
| Include Statistics | boolean | ❌ | true | Include batch stats |

#### Wait for Completion ⭐

Poll until a job completes with automatic result fetching.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Job ID | string | ✅ | - | The batch job ID |
| Max Wait Time | number | ❌ | 300 | Timeout in seconds |
| Poll Interval | number | ❌ | 10 | Check frequency in seconds |
| Fetch Results | boolean | ❌ | true | Auto-fetch on complete |
| Include Statistics | boolean | ❌ | true | Include batch stats |

#### List Jobs

List all batch jobs for your account.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Limit | number | ❌ | 20 | Max jobs to return |
| Filter Status | select | ❌ | All | Filter by job status |

#### Cancel Job

Cancel a pending or processing batch job.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Job ID | string | ✅ | The batch job ID |

---

### Account Resource

#### Get Usage

Get current API usage statistics.

**Returns:**
- `validations_used` - Number of validations used
- `validations_limit` - Plan limit
- `validations_remaining` - Remaining validations
- `usage_percent` - Usage percentage
- `is_near_limit` - True if usage ≥ 80%
- `is_at_limit` - True if usage ≥ 100%

#### Get Plan

Get subscription plan details and limits.

---

## 🔄 Example Workflows

### 1. Real-Time Signup Validation

```
[Webhook: Form Submit] → [MailSafePro: Validate Single] → [IF: is_safe_to_send]
                                                              ├─ true → [Create User]
                                                              └─ false → [Return Error]
```

### 2. Weekly Email List Cleanup

```
[Schedule: Weekly] → [Get Subscribers from DB] → [MailSafePro: Create Batch Job]
                                                          ↓
[Update DB: Remove Invalid] ← [MailSafePro: Wait for Completion]
```

### 3. Lead Scoring with Email Quality

```
[CRM Trigger: New Lead] → [MailSafePro: Validate Single] → [Code: Calculate Score]
                                                                    ↓
                                                          [Update CRM Lead Score]
```

### 4. Form Validation with Detailed Feedback

```
[Form Submit] → [MailSafePro: Quick Check] → [Switch: status]
                                                  ├─ deliverable → [Save Lead]
                                                  ├─ risky → [Flag for Review]
                                                  └─ undeliverable → [Return Error Message]
```

### 5. Batch Processing with Statistics

```
[Read CSV] → [MailSafePro: Validate Multiple] → [Split by: risk_level]
                                                     ├─ low → [Safe List]
                                                     ├─ medium → [Review Queue]
                                                     └─ high → [Reject List]
```

---

## 📊 Understanding Results

### Risk Levels

| Score | Level | Emoji | Recommended Action |
|-------|-------|-------|-------------------|
| 0.00 - 0.29 | 🟢 Low | ✅ | Safe to send |
| 0.30 - 0.49 | 🟡 Medium-Low | ✓ | Safe with monitoring |
| 0.50 - 0.69 | 🟠 Medium | ⚡ | Consider verification |
| 0.70 - 1.00 | 🔴 High | ⚠️ | Manual review required |

### Status Values

| Status | Description | Action |
|--------|-------------|--------|
| `deliverable` | Valid email, mailbox exists | ✅ Send |
| `undeliverable` | Invalid or non-existent | ❌ Remove |
| `risky` | Valid but has risk factors | ⚠️ Review |
| `unknown` | Could not fully verify | 🔄 Retry later |

### Quality Tiers

| Tier | Score Range | Description |
|------|-------------|-------------|
| Excellent | > 0.80 | High-quality, engaged email |
| Good | 0.61 - 0.80 | Reliable email address |
| Fair | 0.41 - 0.60 | Acceptable with some concerns |
| Poor | ≤ 0.40 | Low quality, high risk |

---

## ⚡ Rate Limits

| Plan | Requests/Min | Sync Batch | Async Batch |
|------|--------------|------------|-------------|
| FREE | 1 | 10 | 50 |
| PREMIUM | 100 | 100 | 1,000 |
| ENTERPRISE | 1,000 | 100 | 10,000 |

The node includes automatic retry with exponential backoff for rate limit errors (HTTP 429).

---

## 🛠️ Development

```bash
# Clone
git clone https://github.com/mailsafepro/n8n-nodes-mailsafepro.git
cd n8n-nodes-mailsafepro

# Install dependencies
npm install

# Development with hot reload
npm run dev

# Run tests
npm test
npm run test:coverage

# Build for production
npm run build

# Lint
npm run lint
npm run lint:fix

# Type check
npm run typecheck
```

### Project Structure

```
n8n-nodes-mailsafepro/
├── credentials/
│   └── MailSafeProApi.credentials.ts
├── nodes/
│   └── MailSafePro/
│       ├── MailSafePro.node.ts
│       └── mailsafepro.svg
├── test/
│   └── MailSafePro.node.test.ts
├── examples/
│   └── workflows/
│       ├── validate-signups.json
│       ├── clean-email-list.json
│       └── lead-scoring.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🆘 Support

| Resource | Link |
|----------|------|
| 📚 API Documentation | [docs.mailsafepro.com](https://docs.mailsafepro.com) |
| 💬 n8n Community | [community.n8n.io](https://community.n8n.io) |
| 🐛 Report Issues | [GitHub Issues](https://github.com/mailsafepro/n8n-nodes-mailsafepro/issues) |
| 📧 Email Support | support@mailsafepro.com |
| 🌐 Website | [mailsafepro.com](https://mailsafepro.com) |

---

## 🚀 Submit to n8n Integrations

Your community node is already published to npm. To get it listed in the official n8n integrations directory:

### Option 1: Get Verified for n8n Cloud (Recommended)

1. **Ensure your node follows n8n standards:**
   - Package name must start with `n8n-nodes-` ✓ (already correct)
   - Include proper documentation ✓
   - Add keywords to package.json: `n8n-community-node-package`, `n8n`

2. **Submit for review:**
   - Go to [n8n Community Forum](https://community.n8n.io)
   - Create a new topic in **"Help me Build my Workflow"** category
   - Title: "Request to submit a new n8n community node for review"
   - Include: package name, npm link, brief description, and GitHub repository

3. **Wait for verification** (can take weeks)

### Option 2: List on n8n Workflow Templates

1. Create workflows using your node
2. Export them as JSON
3. Submit to [n8n Workflow Templates](https://n8n.io/workflows/submit/)

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 📝 Changelog

### v1.0.0 (2026-01-04)

**Initial Release**

- ✨ Email validation with enriched results
  - Single email validation with SMTP
  - Quick check (syntax/domain only)
  - Multiple emails sync validation (up to 100)
- ✨ Batch job management
  - Create async jobs (up to 10,000 emails)
  - Get job status with progress
  - Get paginated results with filters
  - Wait for completion with auto-polling
  - List all jobs
  - Cancel pending jobs
- ✨ Account management
  - Get usage statistics
  - Get plan details
- ✨ Advanced features
  - Automatic retry with exponential backoff
  - Batch statistics calculation
  - Email deduplication
  - Configurable timeouts
  - Comprehensive error handling
- ✨ Developer experience
  - Full TypeScript support
  - 32 unit tests
  - Example workflows included
  - Detailed documentation

---

<div align="center">

**Made with ❤️ by [MailSafePro](https://mailsafepro.com)**

</div>
