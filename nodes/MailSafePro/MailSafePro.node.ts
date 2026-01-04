import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IDataObject,
	IHttpRequestMethods,
	NodeApiError,
	INodePropertyOptions,
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

const RISK_THRESHOLDS = {
	LOW: 0.3,
	HIGH: 0.7,
} as const;

const QUALITY_THRESHOLDS = {
	EXCELLENT: 0.8,
	GOOD: 0.6,
	FAIR: 0.4,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function parseEmails(input: string): string[] {
	return input
		.split(/[,\n;]/)
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.length > 0 && EMAIL_REGEX.test(e));
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


function enrichValidationResult(result: IDataObject): IDataObject {
	const riskScore = (result.risk_score as number) ?? 0;
	const qualityScore = (result.quality_score as number) ?? 0;
	const status = result.status as string;
	const valid = result.valid as boolean;

	return {
		...result,
		// Computed fields for workflow logic
		risk_level: calculateRiskLevel(riskScore),
		quality_tier: calculateQualityTier(qualityScore),
		deliverability_status: 
			status === 'deliverable' ? 'high' : 
			status === 'risky' ? 'medium' : 
			status === 'undeliverable' ? 'low' : 'unknown',
		is_high_risk: riskScore >= RISK_THRESHOLDS.HIGH,
		is_safe_to_send: valid === true && riskScore < 0.5,
		should_review: riskScore >= RISK_THRESHOLDS.LOW && riskScore < RISK_THRESHOLDS.HIGH,
		validated_at: new Date().toISOString(),
	};
}

function formatApiError(error: any, operation: string): string {
	const statusCode = error.statusCode || error.httpCode || 'unknown';
	const message = error.message || 'Unknown error';
	
	const errorMessages: Record<number, string> = {
		400: 'Invalid request. Please check your input parameters.',
		401: 'Authentication failed. Please verify your API key is correct.',
		403: 'Access denied. Your plan may not include this feature.',
		404: 'Resource not found. The job ID may be invalid.',
		422: 'Validation error. Please check the email format.',
		429: 'Rate limit exceeded. Please wait before making more requests.',
		500: 'Server error. Please try again later.',
		502: 'Service temporarily unavailable. Please try again.',
		503: 'Service maintenance. Please try again later.',
	};

	return errorMessages[statusCode] || `${operation} failed: ${message} (${statusCode})`;
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
		description: 'Enterprise email validation with risk scoring, SMTP verification, and deliverability analysis',
		defaults: {
			name: 'MailSafePro',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'mailSafeProApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': `n8n-MailSafePro/${API_VERSION}`,
				'X-Client-Platform': 'n8n',
			},
		},
		properties: [
			// ============ RESOURCE SELECTOR ============
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Email',
						value: 'email',
						description: 'Validate email addresses',
					},
					{
						name: 'Batch Job',
						value: 'batch',
						description: 'Manage batch validation jobs',
					},
					{
						name: 'Account',
						value: 'account',
						description: 'Account information and usage',
					},
				],
				default: 'email',
			},

			// ============ EMAIL OPERATIONS ============
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['email'] } },
				options: [
					{
						name: 'Validate',
						value: 'validate',
						description: 'Validate a single email address',
						action: 'Validate an email',
					},
					{
						name: 'Validate Many',
						value: 'validateMany',
						description: 'Validate multiple emails synchronously (up to 100)',
						action: 'Validate multiple emails',
					},
				],
				default: 'validate',
			},

			// ============ BATCH OPERATIONS ============
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
						description: 'Create a new batch validation job',
						action: 'Create a batch job',
					},
					{
						name: 'Get Status',
						value: 'getStatus',
						description: 'Get the status of a batch job',
						action: 'Get batch job status',
					},
					{
						name: 'Get Results',
						value: 'getResults',
						description: 'Get the results of a completed batch job',
						action: 'Get batch job results',
					},
					{
						name: 'List Jobs',
						value: 'listJobs',
						description: 'List all batch jobs',
						action: 'List batch jobs',
					},
					{
						name: 'Cancel Job',
						value: 'cancelJob',
						description: 'Cancel a pending batch job',
						action: 'Cancel a batch job',
					},
					{
						name: 'Wait for Completion',
						value: 'waitForCompletion',
						description: 'Poll until job completes (with timeout)',
						action: 'Wait for job completion',
					},
				],
				default: 'createJob',
			},

			// ============ ACCOUNT OPERATIONS ============
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
						description: 'Get current usage statistics',
						action: 'Get usage statistics',
					},
					{
						name: 'Get Plan',
						value: 'getPlan',
						description: 'Get current subscription plan details',
						action: 'Get plan details',
					},
				],
				default: 'getUsage',
			},

			// ============ EMAIL VALIDATE FIELDS ============
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'], operation: ['validate'] } },
				placeholder: 'user@example.com',
				description: 'The email address to validate',
				validateType: 'string',
			},
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
						default: false,
						description: 'Whether to perform real SMTP mailbox verification (slower but more accurate)',
					},
					{
						displayName: 'Include Raw DNS',
						name: 'includeRawDns',
						type: 'boolean',
						default: false,
						description: 'Whether to include full SPF, DKIM, and DMARC records',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						default: 30,
						description: 'Request timeout in seconds (10-60)',
						typeOptions: { minValue: 10, maxValue: 60 },
					},
				],
			},

			// ============ EMAIL VALIDATE MANY FIELDS ============
			{
				displayName: 'Emails',
				name: 'emails',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'], operation: ['validateMany'] } },
				placeholder: 'user1@example.com\nuser2@example.com',
				description: 'Email addresses to validate (comma, semicolon, or newline separated). Maximum 100.',
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
						description: 'Whether to perform real SMTP mailbox verification',
					},
					{
						displayName: 'Return Individual Results',
						name: 'splitResults',
						type: 'boolean',
						default: true,
						description: 'Whether to return each email as a separate item (useful for further processing)',
					},
				],
			},

			// ============ BATCH CREATE JOB FIELDS ============
			{
				displayName: 'Emails',
				name: 'batchEmails',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['batch'], operation: ['createJob'] } },
				placeholder: 'user1@example.com\nuser2@example.com\nuser3@example.com',
				description: 'List of emails to validate (one per line or comma-separated). Max 10,000 for Enterprise.',
			},
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
						description: 'Whether to perform SMTP verification on each email',
					},
					{
						displayName: 'Priority',
						name: 'priority',
						type: 'options',
						options: [
							{ name: 'Low (Up to 24h)', value: 'low' },
							{ name: 'Normal (Up to 6h)', value: 'normal' },
							{ name: 'High - Enterprise (Up to 1h)', value: 'high' },
						],
						default: 'normal',
						description: 'Processing priority for the batch job',
					},
					{
						displayName: 'Callback URL',
						name: 'callbackUrl',
						type: 'string',
						default: '',
						placeholder: 'https://your-domain.com/webhook',
						description: 'Webhook URL to notify when the job completes',
					},
					{
						displayName: 'Job Name',
						name: 'jobName',
						type: 'string',
						default: '',
						placeholder: 'Customer list validation - Jan 2026',
						description: 'Optional name to identify this batch job',
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

			// ============ BATCH JOB ID FIELD ============
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['batch'],
						operation: ['getStatus', 'getResults', 'cancelJob', 'waitForCompletion'],
					},
				},
				placeholder: 'batch_550e8400-e29b-41d4-a716-446655440000',
				description: 'The ID of the batch job',
			},

			// ============ BATCH GET RESULTS OPTIONS ============
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
						description: 'Number of results per page (max 1000)',
						typeOptions: { minValue: 1, maxValue: 1000 },
					},
					{
						displayName: 'Filter Status',
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
						description: 'Whether to return each email as a separate item',
					},
				],
			},

			// ============ BATCH LIST JOBS OPTIONS ============
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
						displayName: 'Status Filter',
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

			// ============ WAIT FOR COMPLETION OPTIONS ============
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
						description: 'Maximum time to wait for completion (in seconds)',
						typeOptions: { minValue: 30, maxValue: 3600 },
					},
					{
						displayName: 'Poll Interval (Seconds)',
						name: 'pollInterval',
						type: 'number',
						default: 10,
						description: 'How often to check job status (in seconds)',
						typeOptions: { minValue: 5, maxValue: 60 },
					},
					{
						displayName: 'Fetch Results on Complete',
						name: 'fetchResults',
						type: 'boolean',
						default: true,
						description: 'Whether to automatically fetch results when job completes',
					},
				],
			},
		],
	};


	// ============================================================================
	// EXECUTE METHOD
	// ============================================================================

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[];

				// Route to appropriate handler
				if (resource === 'email') {
					responseData = await this.handleEmailOperation(operation, i);
				} else if (resource === 'batch') {
					responseData = await this.handleBatchOperation(operation, i);
				} else if (resource === 'account') {
					responseData = await this.handleAccountOperation(operation, i);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, { itemIndex: i });
				}

				// Handle array results (for split results option)
				if (Array.isArray(responseData)) {
					for (const item of responseData) {
						returnData.push({ json: item, pairedItem: { item: i } });
					}
				} else {
					returnData.push({ json: responseData, pairedItem: { item: i } });
				}

			} catch (error) {
				if (this.continueOnFail()) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					returnData.push({
						json: { 
							error: errorMessage,
							success: false,
							resource,
							operation,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}

	// ============================================================================
	// EMAIL OPERATIONS
	// ============================================================================

	private async handleEmailOperation(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		switch (operation) {
			case 'validate':
				return this.validateEmail(itemIndex);
			case 'validateMany':
				return this.validateMany(itemIndex);
			default:
				throw new NodeOperationError(this.getNode(), `Unknown email operation: ${operation}`, { itemIndex });
		}
	}

	private async validateEmail(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
		const email = (this.getNodeParameter('email', itemIndex) as string).trim().toLowerCase();
		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

		// Validate email format before sending
		if (!EMAIL_REGEX.test(email)) {
			throw new NodeOperationError(
				this.getNode(),
				`Invalid email format: "${email}"`,
				{ itemIndex, description: 'Please provide a valid email address' },
			);
		}

		const body: IDataObject = { email };
		if (options.checkSmtp) body.check_smtp = true;
		if (options.includeRawDns) body.include_raw_dns = true;

		const timeout = ((options.timeout as number) || 30) * 1000;

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'mailSafeProApi',
				{
					method: 'POST' as IHttpRequestMethods,
					url: '/v1/validate/email',
					body,
					json: true,
					timeout,
				},
			);
			return enrichValidationResult(response as IDataObject);
		} catch (error: any) {
			throw new NodeOperationError(
				this.getNode(),
				formatApiError(error, 'Email validation'),
				{ itemIndex },
			);
		}
	}


	private async validateMany(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject | IDataObject[]> {
		const emailsInput = this.getNodeParameter('emails', itemIndex) as string;
		const options = this.getNodeParameter('validateManyOptions', itemIndex, {}) as IDataObject;

		const emails = parseEmails(emailsInput);

		if (emails.length === 0) {
			throw new NodeOperationError(
				this.getNode(),
				'No valid emails provided',
				{ itemIndex, description: 'Please provide at least one valid email address' },
			);
		}

		if (emails.length > MAX_SYNC_BATCH) {
			throw new NodeOperationError(
				this.getNode(),
				`Too many emails (${emails.length}). Maximum is ${MAX_SYNC_BATCH} for synchronous validation.`,
				{ itemIndex, description: 'Use "Batch Job > Create Job" for larger lists' },
			);
		}

		const body: IDataObject = { emails };
		if (options.checkSmtp) body.check_smtp = true;

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'mailSafeProApi',
				{
					method: 'POST' as IHttpRequestMethods,
					url: '/v1/validate/batch',
					body,
					json: true,
					timeout: DEFAULT_TIMEOUT * 2, // Longer timeout for batch
				},
			);

			const results = ((response as IDataObject).results as IDataObject[]) || [];
			const enrichedResults = results.map((r) => enrichValidationResult(r));

			// Return as individual items or single object based on option
			if (options.splitResults !== false) {
				return enrichedResults;
			}

			return {
				total: emails.length,
				results: enrichedResults,
				summary: {
					deliverable: enrichedResults.filter((r) => r.status === 'deliverable').length,
					undeliverable: enrichedResults.filter((r) => r.status === 'undeliverable').length,
					risky: enrichedResults.filter((r) => r.status === 'risky').length,
					unknown: enrichedResults.filter((r) => r.status === 'unknown').length,
				},
				validated_at: new Date().toISOString(),
			};
		} catch (error: any) {
			throw new NodeOperationError(
				this.getNode(),
				formatApiError(error, 'Batch validation'),
				{ itemIndex },
			);
		}
	}

	// ============================================================================
	// BATCH OPERATIONS
	// ============================================================================

	private async handleBatchOperation(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject | IDataObject[]> {
		switch (operation) {
			case 'createJob':
				return this.createBatchJob(itemIndex);
			case 'getStatus':
				return this.getBatchStatus(itemIndex);
			case 'getResults':
				return this.getBatchResults(itemIndex);
			case 'listJobs':
				return this.listBatchJobs(itemIndex);
			case 'cancelJob':
				return this.cancelBatchJob(itemIndex);
			case 'waitForCompletion':
				return this.waitForCompletion(itemIndex);
			default:
				throw new NodeOperationError(this.getNode(), `Unknown batch operation: ${operation}`, { itemIndex });
		}
	}

	private async createBatchJob(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
		const emailsInput = this.getNodeParameter('batchEmails', itemIndex) as string;
		const options = this.getNodeParameter('batchOptions', itemIndex, {}) as IDataObject;

		let emails = parseEmails(emailsInput);

		if (emails.length === 0) {
			throw new NodeOperationError(
				this.getNode(),
				'No valid emails provided',
				{ itemIndex, description: 'Please provide at least one valid email address' },
			);
		}

		// Deduplicate if option is enabled (default: true)
		if (options.deduplicate !== false) {
			const originalCount = emails.length;
			emails = [...new Set(emails)];
			const duplicatesRemoved = originalCount - emails.length;
			if (duplicatesRemoved > 0) {
				// Will be included in response
			}
		}

		if (emails.length > MAX_ASYNC_BATCH) {
			throw new NodeOperationError(
				this.getNode(),
				`Too many emails (${emails.length}). Maximum is ${MAX_ASYNC_BATCH}.`,
				{ itemIndex },
			);
		}

		const body: IDataObject = { emails };
		if (options.checkSmtp) body.check_smtp = true;
		if (options.priority) body.priority = options.priority;
		if (options.callbackUrl) body.callback_url = options.callbackUrl;
		if (options.jobName) body.batch_name = options.jobName;

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'mailSafeProApi',
				{
					method: 'POST' as IHttpRequestMethods,
					url: '/v1/jobs',
					body,
					json: true,
				},
			);

			return {
				...(response as IDataObject),
				total_emails: emails.length,
				submitted_at: new Date().toISOString(),
				estimated_completion: this.estimateCompletion(emails.length, options.priority as string, !!options.checkSmtp),
			};
		} catch (error: any) {
			throw new NodeOperationError(
				this.getNode(),
				formatApiError(error, 'Create batch job'),
				{ itemIndex },
			);
		}
	}


	private async getBatchStatus(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
		const jobId = (this.getNodeParameter('jobId', itemIndex) as string).trim();

		if (!jobId) {
			throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex });
		}

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'mailSafeProApi',
				{
					method: 'GET' as IHttpRequestMethods,
					url: `/v1/jobs/${encodeURIComponent(jobId)}`,
					json: true,
				},
			);

			const result = response as IDataObject;
			return {
				...result,
				is_completed: result.status === 'completed',
				is_failed: result.status === 'failed',
				is_processing: result.status === 'processing' || result.status === 'pending',
			};
		} catch (error: any) {
			throw new NodeOperationError(
				this.getNode(),
				formatApiError(error, 'Get batch status'),
				{ itemIndex },
			);
		}
	}

	private async getBatchResults(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject | IDataObject[]> {
		const jobId = (this.getNodeParameter('jobId', itemIndex) as string).trim();
		const options = this.getNodeParameter('resultsOptions', itemIndex, {}) as IDataObject;

		if (!jobId) {
			throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex });
		}

		const qs: IDataObject = {};
		if (options.page) qs.page = options.page;
		if (options.pageSize) qs.page_size = options.pageSize;
		if (options.filterStatus) qs.status = options.filterStatus;

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'mailSafeProApi',
				{
					method: 'GET' as IHttpRequestMethods,
					url: `/v1/jobs/${encodeURIComponent(jobId)}/results`,
					qs,
					json: true,
				},
			);

			const result = response as IDataObject;
			const results = (result.results as IDataObject[]) || [];
			const enrichedResults = results.map((r) => enrichValidationResult(r));

			// Return as individual items if option is enabled
			if (options.splitResults) {
				return enrichedResults;
			}

			return {
				...result,
				results: enrichedResults,
			};
		} catch (error: any) {
			throw new NodeOperationError(
				this.getNode(),
				formatApiError(error, 'Get batch results'),
				{ itemIndex },
			);
		}
	}

	private async listBatchJobs(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
		const options = this.getNodeParameter('listOptions', itemIndex, {}) as IDataObject;

		const qs: IDataObject = {};
		if (options.limit) qs.limit = options.limit;
		if (options.status) qs.status = options.status;

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'mailSafeProApi',
				{
					method: 'GET' as IHttpRequestMethods,
					url: '/v1/jobs',
					qs,
					json: true,
				},
			);

			return response as IDataObject;
		} catch (error: any) {
			throw new NodeOperationError(
				this.getNode(),
				formatApiError(error, 'List batch jobs'),
				{ itemIndex },
			);
		}
	}

	private async cancelBatchJob(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
		const jobId = (this.getNodeParameter('jobId', itemIndex) as string).trim();

		if (!jobId) {
			throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex });
		}

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'mailSafeProApi',
				{
					method: 'POST' as IHttpRequestMethods,
					url: `/v1/jobs/${encodeURIComponent(jobId)}/cancel`,
					json: true,
				},
			);

			return {
				...(response as IDataObject),
				cancelled_at: new Date().toISOString(),
			};
		} catch (error: any) {
			throw new NodeOperationError(
				this.getNode(),
				formatApiError(error, 'Cancel batch job'),
				{ itemIndex },
			);
		}
	}


	private async waitForCompletion(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
		const jobId = (this.getNodeParameter('jobId', itemIndex) as string).trim();
		const options = this.getNodeParameter('waitOptions', itemIndex, {}) as IDataObject;

		if (!jobId) {
			throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex });
		}

		const maxWait = ((options.maxWait as number) || 300) * 1000; // Convert to ms
		const pollInterval = ((options.pollInterval as number) || 10) * 1000; // Convert to ms
		const fetchResults = options.fetchResults !== false;

		const startTime = Date.now();
		let lastStatus: IDataObject = {};

		while (Date.now() - startTime < maxWait) {
			try {
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'mailSafeProApi',
					{
						method: 'GET' as IHttpRequestMethods,
						url: `/v1/jobs/${encodeURIComponent(jobId)}`,
						json: true,
					},
				);

				lastStatus = response as IDataObject;
				const status = lastStatus.status as string;

				if (status === 'completed') {
					if (fetchResults) {
						// Fetch first page of results
						const resultsResponse = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'mailSafeProApi',
							{
								method: 'GET' as IHttpRequestMethods,
								url: `/v1/jobs/${encodeURIComponent(jobId)}/results`,
								qs: { page: 1, page_size: 100 },
								json: true,
							},
						);

						const resultsData = resultsResponse as IDataObject;
						const results = (resultsData.results as IDataObject[]) || [];

						return {
							...lastStatus,
							is_completed: true,
							wait_time_seconds: Math.round((Date.now() - startTime) / 1000),
							results: results.map((r) => enrichValidationResult(r)),
							results_summary: {
								total: resultsData.total || results.length,
								page: 1,
								has_more: (resultsData.total as number) > 100,
							},
						};
					}

					return {
						...lastStatus,
						is_completed: true,
						wait_time_seconds: Math.round((Date.now() - startTime) / 1000),
					};
				}

				if (status === 'failed' || status === 'cancelled') {
					return {
						...lastStatus,
						is_completed: false,
						is_failed: status === 'failed',
						is_cancelled: status === 'cancelled',
						wait_time_seconds: Math.round((Date.now() - startTime) / 1000),
					};
				}

				// Wait before next poll
				await new Promise((resolve) => setTimeout(resolve, pollInterval));

			} catch (error: any) {
				throw new NodeOperationError(
					this.getNode(),
					formatApiError(error, 'Wait for completion'),
					{ itemIndex },
				);
			}
		}

		// Timeout reached
		return {
			...lastStatus,
			is_completed: false,
			is_timeout: true,
			wait_time_seconds: Math.round((Date.now() - startTime) / 1000),
			message: `Timeout after ${Math.round(maxWait / 1000)} seconds. Job is still ${lastStatus.status}.`,
		};
	}

	// ============================================================================
	// ACCOUNT OPERATIONS
	// ============================================================================

	private async handleAccountOperation(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<IDataObject> {
		switch (operation) {
			case 'getUsage':
				return this.getUsage(itemIndex);
			case 'getPlan':
				return this.getPlan(itemIndex);
			default:
				throw new NodeOperationError(this.getNode(), `Unknown account operation: ${operation}`, { itemIndex });
		}
	}

	private async getUsage(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'mailSafeProApi',
				{
					method: 'GET' as IHttpRequestMethods,
					url: '/billing/usage',
					json: true,
				},
			);

			return response as IDataObject;
		} catch (error: any) {
			throw new NodeOperationError(
				this.getNode(),
				formatApiError(error, 'Get usage'),
				{ itemIndex },
			);
		}
	}

	private async getPlan(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'mailSafeProApi',
				{
					method: 'GET' as IHttpRequestMethods,
					url: '/billing/subscription',
					json: true,
				},
			);

			return response as IDataObject;
		} catch (error: any) {
			throw new NodeOperationError(
				this.getNode(),
				formatApiError(error, 'Get plan'),
				{ itemIndex },
			);
		}
	}

	// ============================================================================
	// UTILITY METHODS
	// ============================================================================

	private estimateCompletion(emailCount: number, priority: string, checkSmtp: boolean): string {
		const baseTimePerEmail = checkSmtp ? 10 : 2; // seconds
		const priorityMultiplier: Record<string, number> = { low: 1.5, normal: 1.0, high: 0.5 };
		const multiplier = priorityMultiplier[priority] || 1.0;
		const totalSeconds = Math.max(60, emailCount * baseTimePerEmail * multiplier);
		return new Date(Date.now() + totalSeconds * 1000).toISOString();
	}
}
