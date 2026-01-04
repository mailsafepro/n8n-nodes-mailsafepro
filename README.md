# n8n-nodes-mailsafepro

<div align="center">

![n8n](https://img.shields.io/badge/n8n-community--node-orange?logo=n8n)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)

**Enterprise email validation node for [n8n](https://n8n.io) workflow automation**

[Features](#-features) • [Installation](#-installation) • [Operations](#-operations) • [Examples](#-example-workflows) • [Support](#-support)

</div>

---

## 🎯 Features

| Feature | Description |
|---------|-------------|
| ✅ **Single Validation** | Validate individual emails with full analysis |
| 📊 **Batch Validation** | Process up to 10,000 emails asynchronously |
| ⏳ **Wait for Completion** | Built-in polling to wait for batch jobs |
| 🔍 **SMTP Verification** | Real mailbox existence checking |
| ⚠️ **Risk Scoring** | Multi-factor risk assessment (0-100) |
| 🛡️ **DNS Security** | SPF, DKIM, DMARC validation |
| 🚫 **Spam Trap Detection** | Identify honeypot addresses |
| 📧 **Disposable Detection** | Block 10,000+ temporary email services |
| 🏢 **Role Email Detection** | Identify generic addresses (admin@, info@) |
| 📈 **Account Usage** | Monitor your API usage and plan |

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

---

## 🔑 Configuration

### Get Your API Key

1. Sign up at [mailsafepro.com](https://mailsafepro.com)
2. Go to your **Dashboard**
3. Copy your **API Key**

### Add Credentials

1. In n8n, go to **Credentials** → **New**
2. Search for **MailSafePro**
3. Enter your API Key
4. *(Optional)* Change Base URL for self-hosted instances
5. Click **Save**

---

## 📋 Operations

### Email Resource

#### Validate (Single)

Validate a single email with full analysis.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Email | string | ✅ | Email address to validate |
| Check SMTP | boolean | ❌ | Real SMTP verification (slower) |
| Include Raw DNS | boolean | ❌ | Include full DNS records |
| Timeout | number | ❌ | Request timeout (10-60s) |

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

#### Validate Many (Sync)

Validate multiple emails synchronously (max 100).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Emails | string | ✅ | Comma/newline separated emails |
| Check SMTP | boolean | ❌ | SMTP verification |
| Return Individual Results | boolean | ❌ | Split into separate items |

### Batch Resource

#### Create Job

Create an async batch validation job (up to 10,000 emails).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Emails | string | ✅ | List of emails |
| Check SMTP | boolean | ❌ | SMTP verification |
| Priority | select | ❌ | low / normal / high |
| Callback URL | string | ❌ | Webhook for completion |
| Job Name | string | ❌ | Identifier for the job |
| Deduplicate | boolean | ❌ | Remove duplicates (default: true) |

#### Get Status

Check the status of a batch job.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Job ID | string | ✅ | The batch job ID |

#### Get Results

Retrieve results from a completed job.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Job ID | string | ✅ | The batch job ID |
| Page | number | ❌ | Page number |
| Page Size | number | ❌ | Results per page (max 1000) |
| Filter Status | select | ❌ | Filter by status |
| Return Individual Results | boolean | ❌ | Split into items |

#### List Jobs

List all your batch jobs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Limit | number | ❌ | Max jobs to return |
| Status Filter | select | ❌ | Filter by job status |

#### Cancel Job

Cancel a pending or processing job.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Job ID | string | ✅ | The batch job ID |

#### Wait for Completion ⭐

Poll until a job completes (with timeout).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| Job ID | string | ✅ | The batch job ID |
| Max Wait Time | number | ❌ | Timeout in seconds (default: 300) |
| Poll Interval | number | ❌ | Check frequency (default: 10s) |
| Fetch Results | boolean | ❌ | Auto-fetch results on complete |

### Account Resource

#### Get Usage

Get current API usage statistics.

#### Get Plan

Get subscription plan details.

---

## 🔄 Example Workflows

### 1. Validate Signups in Real-Time

```
[Webhook] → [MailSafePro: Validate] → [IF: is_safe_to_send] 
                                           ├─ true → [Create User]
                                           └─ false → [Reject & Log]
```

### 2. Weekly Email List Cleanup

```
[Schedule: Weekly] → [Get Subscribers] → [MailSafePro: Create Batch Job]
                                                    ↓
[Remove Invalid] ← [Get Results] ← [Wait for Completion]
```

### 3. Lead Scoring with Email Quality

```
[CRM Trigger] → [MailSafePro: Validate] → [Code: Calculate Score]
                                                    ↓
                                          [Update CRM Lead Score]
```

### 4. Form Validation with Feedback

```
[Form Submit] → [MailSafePro: Validate] → [Switch: status]
                                               ├─ deliverable → [Save]
                                               ├─ risky → [Flag for Review]
                                               └─ undeliverable → [Return Error]
```

---

## 📊 Understanding Results

### Risk Levels

| Score | Level | Action |
|-------|-------|--------|
| 0-29 | 🟢 Low | Safe to send |
| 30-69 | 🟡 Medium | Review recommended |
| 70-100 | 🔴 High | Avoid or verify manually |

### Status Values

| Status | Description |
|--------|-------------|
| `deliverable` | Valid email, mailbox exists |
| `undeliverable` | Invalid or non-existent |
| `risky` | Valid but has risk factors |
| `unknown` | Could not fully verify |

### Computed Fields

The node automatically adds these fields for easier workflow logic:

| Field | Type | Description |
|-------|------|-------------|
| `risk_level` | string | low / medium / high |
| `quality_tier` | string | excellent / good / fair / poor |
| `is_safe_to_send` | boolean | Safe to send (valid + low risk) |
| `is_high_risk` | boolean | Risk score ≥ 0.7 |
| `should_review` | boolean | Medium risk, needs review |
| `deliverability_status` | string | high / medium / low / unknown |

---

## ⚡ Rate Limits

| Plan | Requests/Min | Batch Size |
|------|--------------|------------|
| FREE | 1 | 50 |
| PREMIUM | 100 | 1,000 |
| ENTERPRISE | 1,000 | 10,000 |

---

## 🛠️ Development

```bash
# Clone
git clone https://github.com/mailsafepro/n8n-nodes-mailsafepro.git
cd n8n-nodes-mailsafepro

# Install
npm install

# Develop (with hot reload)
npm run dev

# Test
npm test
npm run test:coverage

# Build
npm run build

# Lint
npm run lint
npm run lint:fix
```

---

## 🆘 Support

| Resource | Link |
|----------|------|
| 📚 Documentation | [docs.mailsafepro.com](https://docs.mailsafepro.com) |
| 💬 n8n Community | [community.n8n.io](https://community.n8n.io) |
| 🐛 Issues | [GitHub Issues](https://github.com/mailsafepro/n8n-nodes-mailsafepro/issues) |
| 📧 Email | support@mailsafepro.com |

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 📝 Changelog

### v1.0.0 (2026-01-04)

- ✨ Initial release
- ✅ Single email validation with enriched results
- ✅ Sync batch validation (up to 100 emails)
- ✅ Async batch jobs (up to 10,000 emails)
- ✅ Wait for completion with auto-polling
- ✅ Job management (list, status, results, cancel)
- ✅ Account usage and plan info
- ✅ Comprehensive error handling
- ✅ Example workflows included
