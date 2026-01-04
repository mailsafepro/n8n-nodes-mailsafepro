import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IDataObject,
	IHttpRequestMethods,
} from 'n8n-workflow';

// ============================================================================
// CONSTANTS
// ============================================================================

const API_VERSION = '1.0.0';
const NODE_VERSION = 1;
const DEFAULT_TIMEOUT = 30000;
const MAX_SYNC_BATCH = 100;
const MAX_ASYNC_BATCH = 10000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_POLL_INTERVAL = 10;
const DEFAULT_MAX_WAIT = 300;
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000;

const RISK_THRESHOLDS = { LOW: 0.3, MEDIUM: 0.5, HIGH: 0.7 };
const QUALITY_THRESHOLDS = { EXCELLENT: 0.8, GOOD: 0.6, FAIR: 0.4 };

// ============================================================================
// TYPES
// ============================================================================

interface ValidationResult extends IDataObject {
	email: string;
	valid: boolean;
	status: string;
	risk_score?: number;
	quality_score?: number;
}

interface BatchJobResponse extends IDataObject {
	job_id: string;
	status: string;
	total_emails?: number;
	processed?: number;
	progress?: number;
}

interface EnrichedResult extends ValidationResult {
	risk_level: 'low' | 'medium' | 'high';
	quality_tier: 'excellent' | 'good' | 'fair' | 'poor';
	deliverability_status: 'high' | 'medium' | 'low' | 'unknown';
	is_high_risk: boolean;
	is_safe_to_send: boolean;
	should_review: boolean;
	recommendation: string;
	validated_at: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function parseEmails(input: string): string[] {
	return input
		.split(/[,\n;\r\t]+/)
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.length > 0 && EMAIL_REGEX.test(e));
}

function deduplicateEmails(emails: string[]): { unique: string[]; duplicates: number } {
	const unique = [...new Set(emails)];
	return { unique, duplicates: emails.length - unique.length };
}

function calculateRiskLevel(score: number): 'low' | 'medium' | 'high' {
	if (score < RISK_THRESHOLDS.LOW) return 'low';
	if (score < RISK_THRESHOLDS.HIGH) return 'medium';
	return 'high';
}

function calculateQualityTier(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
	if (score > QUALITY_THRESHOLDS.EXCELLENT) return 'excellent';
	if (score > QUALITY_THRESHOLDS.GOOD) return 'good';
	if (score > QUALITY_THRESHOLDS.FAIR) return 'fair';
	return 'poor';
}

function getRecommendation(result: ValidationResult): string {
	const riskScore = result.risk_score ?? 0;
	const valid = result.valid;
	const status = result.status;

	if (!valid) return '❌ Do not send - Invalid email';
	if (status === 'undeliverable') return '❌ Do not send - Undeliverable';
	if (riskScore >= RISK_THRESHOLDS.HIGH) return '⚠️ High risk - Manual review required';
	if (riskScore >= RISK_THRESHOLDS.MEDIUM) return '⚡ Medium risk - Consider verification';
	if (riskScore >= RISK_THRESHOLDS.LOW) return '✓ Low risk - Safe with monitoring';
	return '✅ Safe to send';
}

function enrichValidationResult(result: ValidationResult): EnrichedResult {
	const riskScore = result.risk_score ?? 0;
	const qualityScore = result.quality_score ?? 0;
	const status = result.status;
	const valid = result.valid;

	const riskLevel = calculateRiskLevel(riskScore);
	const qualityTier = calculateQualityTier(qualityScore);

	return {
		...result,
		risk_level: riskLevel,
		quality_tier: qualityTier,
		deliverability_status:
			status === 'deliverable' ? 'high' :
			status === 'risky' ? 'medium' :
			status === 'undeliverable' ? 'low' : 'unknown',
		is_high_risk: riskScore >= RISK_THRESHOLDS.HIGH,
		is_safe_to_send: valid === true && riskScore < RISK_THRESHOLDS.MEDIUM,
		should_review: riskScore >= RISK_THRESHOLDS.LOW && riskScore < RISK_THRESHOLDS.HIGH,
		recommendation: getRecommendation(result),
		validated_at: new Date().toISOString(),
	};
}

function formatApiError(statusCode: number, operation: string, message?: string): string {
	const errorMessages: Record<number, string> = {
		400: 'Invalid request. Please check your input parameters.',
		401: 'Authentication failed. Please verify your API key is correct and active.',
		403: 'Access denied. Your subscription plan may not include this feature.',
		404: 'Resource not found. The job ID may be invalid or expired.',
		422: 'Validation error. Please check the email format and parameters.',
		429: 'Rate limit exceeded. Please wait before making more requests or upgrade your plan.',
		500: 'Server error. The MailSafePro service is temporarily unavailable.',
		502: 'Bad gateway. Please try again in a few moments.',
		503: 'Service unavailable. The API is under maintenance.',
	};
	return errorMessages[statusCode] || `${operation} failed: ${message || 'Unknown error'} (HTTP ${statusCode})`;
}

function estimateCompletion(emailCount: number, priority: string, checkSmtp: boolean): string {
	const baseTimePerEmail = checkSmtp ? 8 : 2;
	const priorityMultiplier: Record<string, number> = { low: 1.5, normal: 1.0, high: 0.6 };
	const multiplier = priorityMultiplier[priority] || 1.0;
	const totalSeconds = Math.max(30, Math.ceil(emailCount * baseTimePerEmail * multiplier));
	return new Date(Date.now() + totalSeconds * 1000).toISOString();
}

function calculateBatchStatistics(results: EnrichedResult[]): IDataObject {
	const total = results.length;
	if (total === 0) return { total: 0 };

	const deliverable = results.filter(r => r.status === 'deliverable').length;
	const undeliverable = results.filter(r => r.status === 'undeliverable').length;
	const risky = results.filter(r => r.status === 'risky').length;
	const unknown = results.filter(r => r.status === 'unknown').length;

	const safeToSend = results.filter(r => r.is_safe_to_send).length;
	const needsReview = results.filter(r => r.should_review).length;
	const highRisk = results.filter(r => r.is_high_risk).length;

	const avgRiskScore = results.reduce((sum, r) => sum + (r.risk_score ?? 0), 0) / total;
	const avgQualityScore = results.reduce((sum, r) => sum + (r.quality_score ?? 0), 0) / total;

	return {
		total,
		by_status: { deliverable, undeliverable, risky, unknown },
		by_action: { safe_to_send: safeToSend, needs_review: needsReview, high_risk: highRisk },
		rates: {
			deliverability_rate: Math.round((deliverable / total) * 100 * 100) / 100,
			risk_rate: Math.round((highRisk / total) * 100 * 100) / 100,
			quality_rate: Math.round((safeToSend / total) * 100 * 100) / 100,
		},
		averages: {
			risk_score: Math.round(avgRiskScore * 100) / 100,
			quality_score: Math.round(avgQualityScore * 100) / 100,
		},
	};
}

async function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// NODE DEFINITION
// ============================================================================

export class MailSafePro implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MailSafePro',
		name: 'mailSafePro',
		icon: 'file:mailsafepro.svg',
		group: ['transform'],
		version: NODE_VERSION,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Enterprise email validation with risk scoring, SMTP verification, deliverability analysis, and batch processing',
		defaults: { name: 'MailSafePro' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'mailSafeProApi', required: true }],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': `n8n-MailSafePro/${API_VERSION}`,
			},
		},
		properties: [
			// ================================================================
			// RESOURCE SELECTOR
			// ================================================================
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Email',
						value: 'email',
						description: 'Validate email addresses in real-time',
					},
					{
						name: 'Batch Job',
						value: 'batch',
						description: 'Manage asynchronous batch validation jobs',
					},
					{
						name: 'Account',
						value: 'account',
						description: 'View account usage and subscription info',
					},
				],
				default: 'email',
			},

			// ================================================================
			// EMAIL OPERATIONS
			// ================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['email'] } },
				options: [
					{
						name: 'Validate Single',
						value: 'validate',
						description: 'Validate a single email address with full analysis',
						action: 'Validate a single email',
					},
					{
						name: 'Validate Multiple',
						value: 'validateMany',
						description: 'Validate multiple emails synchronously (max 100)',
						action: 'Validate multiple emails',
					},
					{
						name: 'Quick Check',
						value: 'quickCheck',
						description: 'Fast syntax and domain validation without SMTP',
						action: 'Quick check an email',
					},
				],
				default: 'validate',
			},

			// ================================================================
			// BATCH OPERATIONS
			// ================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['batch'] } },
				options: [
					{
						name: 'Create Job',
						value: 'createJob',
						description: 'Create an async batch validation job (up to 10,000 emails)',
						action: 'Create a batch job',
					},
					{
						name: 'Get Status',
						value: 'getStatus',
						description: 'Check the current status of a batch job',
						action: 'Get batch job status',
					},
					{
						name: 'Get Results',
						value: 'getResults',
						description: 'Retrieve validation results from a completed job',
						action: 'Get batch job results',
					},
					{
						name: 'Wait for Completion',
						value: 'waitForCompletion',
						description: 'Poll until job completes and optionally fetch results',
						action: 'Wait for batch job completion',
					},
					{
						name: 'List Jobs',
						value: 'listJobs',
						description: 'List all batch jobs for your account',
						action: 'List batch jobs',
					},
					{
						name: 'Cancel Job',
						value: 'cancelJob',
						description: 'Cancel a pending or processing batch job',
						action: 'Cancel a batch job',
					},
				],
				default: 'createJob',
			},

			// ================================================================
			// ACCOUNT OPERATIONS
			// ================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Get Usage',
						value: 'getUsage',
						description: 'Get current API usage statistics',
						action: 'Get account usage',
					},
					{
						name: 'Get Plan',
						value: 'getPlan',
						description: 'Get subscription plan details and limits',
						action: 'Get subscription plan',
					},
				],
				default: 'getUsage',
			},

			// ================================================================
			// EMAIL FIELDS
			// ================================================================
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'], operation: ['validate', 'quickCheck'] } },
				placeholder: 'user@example.com',
				description: 'The email address to validate',
			},
			{
				displayName: 'Emails',
				name: 'emails',
				type: 'string',
				typeOptions: { rows: 5 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'], operation: ['validateMany'] } },
				placeholder: 'user1@example.com\nuser2@example.com\nuser3@example.com',
				description: 'Email addresses separated by comma, semicolon, or newline (max 100)',
			},

			// ================================================================
			// EMAIL OPTIONS
			// ================================================================
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['email'], operation: ['validate'] } },
				options: [
					{
						displayName: 'Check SMTP',
						name: 'checkSmtp',
						type: 'boolean',
						default: true,
						description: 'Whether to perform real SMTP mailbox verification (slower but more accurate)',
					},
					{
						displayName: 'Include Raw DNS',
						name: 'includeRawDns',
						type: 'boolean',
						default: false,
						description: 'Whether to include full DNS records in the response',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						default: 30,
						description: 'Maximum time to wait for validation',
						typeOptions: { minValue: 5, maxValue: 60 },
					},
				],
			},
			{
				displayName: 'Options',
				name: 'validateManyOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['email'], operation: ['validateMany'] } },
				options: [
					{
						displayName: 'Check SMTP',
						name: 'checkSmtp',
						type: 'boolean',
						default: false,
						description: 'Whether to perform SMTP verification for each email',
					},
					{
						displayName: 'Return Individual Results',
						name: 'splitResults',
						type: 'boolean',
						default: true,
						description: 'Whether to return each email as a separate output item',
					},
					{
						displayName: 'Include Statistics',
						name: 'includeStats',
						type: 'boolean',
						default: true,
						description: 'Whether to include batch statistics summary',
					},
					{
						displayName: 'Continue on Invalid',
						name: 'continueOnInvalid',
						type: 'boolean',
						default: true,
						description: 'Whether to continue processing if some emails are invalid',
					},
				],
			},

			// ================================================================
			// BATCH FIELDS
			// ================================================================
			{
				displayName: 'Emails',
				name: 'batchEmails',
				type: 'string',
				typeOptions: { rows: 8 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['batch'], operation: ['createJob'] } },
				placeholder: 'user1@example.com\nuser2@example.com\n...',
				description: 'List of emails to validate (max 10,000 for Enterprise)',
			},
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['batch'], operation: ['getStatus', 'getResults', 'cancelJob', 'waitForCompletion'] } },
				placeholder: 'batch_550e8400-e29b-41d4-a716-446655440000',
				description: 'The unique batch job identifier',
			},

			// ================================================================
			// BATCH OPTIONS
			// ================================================================
			{
				displayName: 'Options',
				name: 'batchOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['batch'], operation: ['createJob'] } },
				options: [
					{
						displayName: 'Check SMTP',
						name: 'checkSmtp',
						type: 'boolean',
						default: false,
						description: 'Whether to perform SMTP verification (increases processing time)',
					},
					{
						displayName: 'Priority',
						name: 'priority',
						type: 'options',
						options: [
							{ name: 'Low', value: 'low', description: 'Lowest priority, longest wait' },
							{ name: 'Normal', value: 'normal', description: 'Standard processing' },
							{ name: 'High', value: 'high', description: 'Priority processing (Enterprise)' },
						],
						default: 'normal',
						description: 'Processing priority level',
					},
					{
						displayName: 'Callback URL',
						name: 'callbackUrl',
						type: 'string',
						default: '',
						placeholder: 'https://your-webhook.com/callback',
						description: 'Webhook URL to notify when job completes',
					},
					{
						displayName: 'Job Name',
						name: 'jobName',
						type: 'string',
						default: '',
						placeholder: 'Weekly newsletter cleanup',
						description: 'Optional name to identify this job',
					},
					{
						displayName: 'Deduplicate',
						name: 'deduplicate',
						type: 'boolean',
						default: true,
						description: 'Whether to remove duplicate emails before processing',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'waitOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['batch'], operation: ['waitForCompletion'] } },
				options: [
					{
						displayName: 'Max Wait Time (Seconds)',
						name: 'maxWait',
						type: 'number',
						default: 300,
						description: 'Maximum time to wait for completion',
						typeOptions: { minValue: 30, maxValue: 3600 },
					},
					{
						displayName: 'Poll Interval (Seconds)',
						name: 'pollInterval',
						type: 'number',
						default: 10,
						description: 'How often to check job status',
						typeOptions: { minValue: 5, maxValue: 60 },
					},
					{
						displayName: 'Fetch Results on Complete',
						name: 'fetchResults',
						type: 'boolean',
						default: true,
						description: 'Whether to automatically fetch results when job completes',
					},
					{
						displayName: 'Include Statistics',
						name: 'includeStats',
						type: 'boolean',
						default: true,
						description: 'Whether to include batch statistics in output',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'resultsOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['batch'], operation: ['getResults'] } },
				options: [
					{
						displayName: 'Page',
						name: 'page',
						type: 'number',
						default: 1,
						description: 'Page number for paginated results',
						typeOptions: { minValue: 1 },
					},
					{
						displayName: 'Page Size',
						name: 'pageSize',
						type: 'number',
						default: 100,
						description: 'Number of results per page',
						typeOptions: { minValue: 1, maxValue: 1000 },
					},
					{
						displayName: 'Filter by Status',
						name: 'filterStatus',
						type: 'options',
						options: [
							{ name: 'All', value: '' },
							{ name: 'Deliverable', value: 'deliverable' },
							{ name: 'Undeliverable', value: 'undeliverable' },
							{ name: 'Risky', value: 'risky' },
							{ name: 'Unknown', value: 'unknown' },
						],
						default: '',
						description: 'Filter results by validation status',
					},
					{
						displayName: 'Return Individual Results',
						name: 'splitResults',
						type: 'boolean',
						default: false,
						description: 'Whether to return each email as a separate output item',
					},
					{
						displayName: 'Include Statistics',
						name: 'includeStats',
						type: 'boolean',
						default: true,
						description: 'Whether to include batch statistics',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'listOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['batch'], operation: ['listJobs'] } },
				options: [
					{
						displayName: 'Limit',
						name: 'limit',
						type: 'number',
						default: 20,
						description: 'Maximum number of jobs to return',
						typeOptions: { minValue: 1, maxValue: 100 },
					},
					{
						displayName: 'Filter by Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'All', value: '' },
							{ name: 'Pending', value: 'pending' },
							{ name: 'Processing', value: 'processing' },
							{ name: 'Completed', value: 'completed' },
							{ name: 'Failed', value: 'failed' },
							{ name: 'Cancelled', value: 'cancelled' },
						],
						default: '',
						description: 'Filter jobs by status',
					},
				],
			},
		],
	};



	// ================================================================
	// EXECUTE METHOD
	// ================================================================
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};

				// ============================================================
				// EMAIL: VALIDATE SINGLE
				// ============================================================
				if (resource === 'email' && operation === 'validate') {
					const email = (this.getNodeParameter('email', i) as string).trim().toLowerCase();
					const options = this.getNodeParameter('options', i, {}) as IDataObject;

					if (!EMAIL_REGEX.test(email)) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid email format: "${email}". Please provide a valid email address.`,
							{ itemIndex: i }
						);
					}

					const body: IDataObject = { email };
					if (options.checkSmtp !== false) body.check_smtp = true;
					if (options.includeRawDns) body.include_raw_dns = true;

					const timeout = ((options.timeout as number) || 30) * 1000;

					let response: IDataObject;
					let retries = 0;

					while (retries < MAX_RETRIES) {
						try {
							response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
								method: 'POST' as IHttpRequestMethods,
								url: '/validate/email',
								body,
								json: true,
								timeout,
							}) as IDataObject;
							break;
						} catch (error: any) {
							if (error.statusCode === 429 && retries < MAX_RETRIES - 1) {
								retries++;
								await sleep(RETRY_DELAY_BASE * Math.pow(2, retries));
								continue;
							}
							throw error;
						}
					}

					responseData = enrichValidationResult(response! as ValidationResult);
				}

				// ============================================================
				// EMAIL: QUICK CHECK
				// ============================================================
				else if (resource === 'email' && operation === 'quickCheck') {
					const email = (this.getNodeParameter('email', i) as string).trim().toLowerCase();

					if (!EMAIL_REGEX.test(email)) {
						responseData = {
							email,
							valid: false,
							status: 'invalid',
							reason: 'Invalid email format',
							is_safe_to_send: false,
							checked_at: new Date().toISOString(),
						};
					} else {
						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
							method: 'POST' as IHttpRequestMethods,
							url: '/validate/email',
							body: { email, check_smtp: false },
							json: true,
							timeout: 10000,
						}) as IDataObject;

						responseData = {
							...response,
							is_safe_to_send: response.valid === true,
							checked_at: new Date().toISOString(),
						};
					}
				}

				// ============================================================
				// EMAIL: VALIDATE MULTIPLE
				// ============================================================
				else if (resource === 'email' && operation === 'validateMany') {
					const emailsInput = this.getNodeParameter('emails', i) as string;
					const options = this.getNodeParameter('validateManyOptions', i, {}) as IDataObject;

					const parsedEmails = parseEmails(emailsInput);

					if (parsedEmails.length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'No valid email addresses found. Please check your input format.',
							{ itemIndex: i }
						);
					}

					if (parsedEmails.length > MAX_SYNC_BATCH) {
						throw new NodeOperationError(
							this.getNode(),
							`Too many emails (${parsedEmails.length}). Maximum for sync validation is ${MAX_SYNC_BATCH}. Use "Create Batch Job" for larger lists.`,
							{ itemIndex: i }
						);
					}

					const { unique: emails, duplicates } = deduplicateEmails(parsedEmails);

					const body: IDataObject = { emails };
					if (options.checkSmtp) body.check_smtp = true;

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'POST' as IHttpRequestMethods,
						url: '/validate/batch',
						body,
						json: true,
						timeout: DEFAULT_TIMEOUT * 3,
					}) as IDataObject;

					const results = ((response.results as IDataObject[]) || []).map((r) =>
						enrichValidationResult(r as ValidationResult)
					);

					if (options.splitResults !== false) {
						// Return each result as separate item
						const stats = options.includeStats !== false ? calculateBatchStatistics(results) : null;

						for (const result of results) {
							returnData.push({
								json: {
									...result,
									...(stats ? { _batch_statistics: stats } : {}),
								},
								pairedItem: { item: i },
							});
						}
						continue; // Skip the normal push at the end
					} else {
						const stats = calculateBatchStatistics(results);
						responseData = {
							total_submitted: parsedEmails.length,
							total_unique: emails.length,
							duplicates_removed: duplicates,
							results,
							statistics: stats,
							validated_at: new Date().toISOString(),
						};
					}
				}

				// ============================================================
				// BATCH: CREATE JOB
				// ============================================================
				else if (resource === 'batch' && operation === 'createJob') {
					const emailsInput = this.getNodeParameter('batchEmails', i) as string;
					const options = this.getNodeParameter('batchOptions', i, {}) as IDataObject;

					const parsedEmails = parseEmails(emailsInput);

					if (parsedEmails.length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'No valid email addresses found. Please check your input format.',
							{ itemIndex: i }
						);
					}

					if (parsedEmails.length > MAX_ASYNC_BATCH) {
						throw new NodeOperationError(
							this.getNode(),
							`Too many emails (${parsedEmails.length}). Maximum is ${MAX_ASYNC_BATCH}.`,
							{ itemIndex: i }
						);
					}

					let emails = parsedEmails;
					let duplicatesRemoved = 0;

					if (options.deduplicate !== false) {
						const { unique, duplicates } = deduplicateEmails(parsedEmails);
						emails = unique;
						duplicatesRemoved = duplicates;
					}

					const body: IDataObject = { emails };
					if (options.checkSmtp) body.check_smtp = true;
					if (options.priority) body.priority = options.priority;
					if (options.callbackUrl) body.callback_url = options.callbackUrl;
					if (options.jobName) body.batch_name = options.jobName;

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'POST' as IHttpRequestMethods,
						url: '/jobs',
						body,
						json: true,
					}) as IDataObject;

					responseData = {
						...response,
						total_submitted: parsedEmails.length,
						total_unique: emails.length,
						duplicates_removed: duplicatesRemoved,
						submitted_at: new Date().toISOString(),
						estimated_completion: estimateCompletion(
							emails.length,
							(options.priority as string) || 'normal',
							!!options.checkSmtp
						),
					};
				}

				// ============================================================
				// BATCH: GET STATUS
				// ============================================================
				else if (resource === 'batch' && operation === 'getStatus') {
					const jobId = (this.getNodeParameter('jobId', i) as string).trim();

					if (!jobId) {
						throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex: i });
					}

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'GET' as IHttpRequestMethods,
						url: `/jobs/${encodeURIComponent(jobId)}`,
						json: true,
					}) as BatchJobResponse;

					const progress = response.total_emails && response.processed
						? Math.round((response.processed / response.total_emails) * 100)
						: response.progress || 0;

					responseData = {
						...response,
						progress_percent: progress,
						is_completed: response.status === 'completed',
						is_failed: response.status === 'failed',
						is_processing: response.status === 'processing' || response.status === 'pending',
						is_cancelled: response.status === 'cancelled',
						checked_at: new Date().toISOString(),
					};
				}

				// ============================================================
				// BATCH: GET RESULTS
				// ============================================================
				else if (resource === 'batch' && operation === 'getResults') {
					const jobId = (this.getNodeParameter('jobId', i) as string).trim();
					const options = this.getNodeParameter('resultsOptions', i, {}) as IDataObject;

					if (!jobId) {
						throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex: i });
					}

					const qs: IDataObject = {};
					if (options.page) qs.page = options.page;
					if (options.pageSize) qs.page_size = options.pageSize;
					if (options.filterStatus) qs.status = options.filterStatus;

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'GET' as IHttpRequestMethods,
						url: `/jobs/${encodeURIComponent(jobId)}/results`,
						qs,
						json: true,
					}) as IDataObject;

					const results = ((response.results as IDataObject[]) || []).map((r) =>
						enrichValidationResult(r as ValidationResult)
					);

					if (options.splitResults) {
						const stats = options.includeStats !== false ? calculateBatchStatistics(results) : null;

						for (const result of results) {
							returnData.push({
								json: {
									...result,
									job_id: jobId,
									...(stats ? { _batch_statistics: stats } : {}),
								},
								pairedItem: { item: i },
							});
						}
						continue;
					} else {
						const stats = options.includeStats !== false ? calculateBatchStatistics(results) : null;
						responseData = {
							job_id: jobId,
							...response,
							results,
							...(stats ? { statistics: stats } : {}),
							retrieved_at: new Date().toISOString(),
						};
					}
				}

				// ============================================================
				// BATCH: WAIT FOR COMPLETION
				// ============================================================
				else if (resource === 'batch' && operation === 'waitForCompletion') {
					const jobId = (this.getNodeParameter('jobId', i) as string).trim();
					const options = this.getNodeParameter('waitOptions', i, {}) as IDataObject;

					if (!jobId) {
						throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex: i });
					}

					const maxWait = ((options.maxWait as number) || DEFAULT_MAX_WAIT) * 1000;
					const pollInterval = ((options.pollInterval as number) || DEFAULT_POLL_INTERVAL) * 1000;
					const startTime = Date.now();

					let status: BatchJobResponse = {} as BatchJobResponse;
					let pollCount = 0;
					let jobCompleted = false;

					while (Date.now() - startTime < maxWait) {
						pollCount++;

						status = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
							method: 'GET' as IHttpRequestMethods,
							url: `/jobs/${encodeURIComponent(jobId)}`,
							json: true,
						}) as BatchJobResponse;

						if (status.status === 'completed') {
							let results: EnrichedResult[] = [];
							let stats: IDataObject | null = null;

							if (options.fetchResults !== false) {
								const resultsResponse = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
									method: 'GET' as IHttpRequestMethods,
									url: `/jobs/${encodeURIComponent(jobId)}/results`,
									json: true,
								}) as IDataObject;

								results = ((resultsResponse.results as IDataObject[]) || []).map((r) =>
									enrichValidationResult(r as ValidationResult)
								);

								if (options.includeStats !== false) {
									stats = calculateBatchStatistics(results);
								}
							}

							responseData = {
								...status,
								requested_job_id: jobId,
								final_status: 'completed',
								wait_time_seconds: Math.round((Date.now() - startTime) / 1000),
								poll_count: pollCount,
								...(results.length > 0 ? { results } : {}),
								...(stats ? { statistics: stats } : {}),
								completed_at: new Date().toISOString(),
							};
							jobCompleted = true;
							break;
						}

						if (status.status === 'failed') {
							throw new NodeOperationError(
								this.getNode(),
								`Batch job failed: ${status.error || 'Unknown error'}`,
								{ itemIndex: i }
							);
						}

						if (status.status === 'cancelled') {
							throw new NodeOperationError(
								this.getNode(),
								'Batch job was cancelled',
								{ itemIndex: i }
							);
						}

						await sleep(pollInterval);
					}

					if (!jobCompleted) {
						throw new NodeOperationError(
							this.getNode(),
							`Timeout waiting for job completion after ${Math.round(maxWait / 1000)} seconds. Job is still ${status.status}.`,
							{ itemIndex: i }
						);
					}
				}

				// ============================================================
				// BATCH: LIST JOBS
				// ============================================================
				else if (resource === 'batch' && operation === 'listJobs') {
					const options = this.getNodeParameter('listOptions', i, {}) as IDataObject;

					const qs: IDataObject = {};
					if (options.limit) qs.limit = options.limit;
					if (options.status) qs.status = options.status;

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'GET' as IHttpRequestMethods,
						url: '/jobs',
						qs,
						json: true,
					}) as IDataObject;

					const jobs = (response.jobs as IDataObject[]) || [];

					responseData = {
						total: jobs.length,
						jobs: jobs.map((job) => ({
							...job,
							is_completed: job.status === 'completed',
							is_processing: job.status === 'processing' || job.status === 'pending',
						})),
						retrieved_at: new Date().toISOString(),
					};
				}

				// ============================================================
				// BATCH: CANCEL JOB
				// ============================================================
				else if (resource === 'batch' && operation === 'cancelJob') {
					const jobId = (this.getNodeParameter('jobId', i) as string).trim();

					if (!jobId) {
						throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex: i });
					}

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'POST' as IHttpRequestMethods,
						url: `/jobs/${encodeURIComponent(jobId)}/cancel`,
						json: true,
					}) as IDataObject;

					responseData = {
						...response,
						job_id: jobId,
						cancelled_at: new Date().toISOString(),
					};
				}

				// ============================================================
				// ACCOUNT: GET USAGE
				// ============================================================
				else if (resource === 'account' && operation === 'getUsage') {
					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'GET' as IHttpRequestMethods,
						url: '/billing/usage',
						json: true,
					}) as IDataObject;

					const used = (response.validations_used as number) || 0;
					const limit = (response.validations_limit as number) || 0;
					const remaining = limit > 0 ? limit - used : 0;
					const usagePercent = limit > 0 ? Math.round((used / limit) * 100) : 0;

					responseData = {
						...response,
						validations_remaining: remaining,
						usage_percent: usagePercent,
						is_near_limit: usagePercent >= 80,
						is_at_limit: usagePercent >= 100,
						retrieved_at: new Date().toISOString(),
					};
				}

				// ============================================================
				// ACCOUNT: GET PLAN
				// ============================================================
				else if (resource === 'account' && operation === 'getPlan') {
					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'GET' as IHttpRequestMethods,
						url: '/billing/subscription',
						json: true,
					}) as IDataObject;

					responseData = {
						...response,
						retrieved_at: new Date().toISOString(),
					};
				}

				// ============================================================
				// UNKNOWN OPERATION
				// ============================================================
				else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation: ${resource}/${operation}`,
						{ itemIndex: i }
					);
				}

				// Push result
				if (Array.isArray(responseData)) {
					for (const item of responseData) {
						returnData.push({ json: item, pairedItem: { item: i } });
					}
				} else {
					returnData.push({ json: responseData, pairedItem: { item: i } });
				}

			} catch (error: any) {
				if (this.continueOnFail()) {
					const statusCode = error.statusCode || error.httpCode;
					returnData.push({
						json: {
							error: statusCode
								? formatApiError(statusCode, `${resource}/${operation}`, error.message)
								: error.message,
							error_code: statusCode || 'UNKNOWN',
							success: false,
							operation: `${resource}/${operation}`,
							timestamp: new Date().toISOString(),
						},
						pairedItem: { item: i },
					});
					continue;
				}

				// Re-throw with better error message
				const statusCode = error.statusCode || error.httpCode;
				if (statusCode) {
					throw new NodeOperationError(
						this.getNode(),
						formatApiError(statusCode, `${resource}/${operation}`, error.message),
						{ itemIndex: i }
					);
				}
				throw error;
			}
		}

		return [returnData];
	}
}
