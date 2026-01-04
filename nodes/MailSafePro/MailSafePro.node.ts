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

const RISK_THRESHOLDS = { LOW: 0.3, HIGH: 0.7 };
const QUALITY_THRESHOLDS = { EXCELLENT: 0.8, GOOD: 0.6, FAIR: 0.4 };

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function parseEmails(input: string): string[] {
	return input
		.split(/[,\n;]/)
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.length > 0 && EMAIL_REGEX.test(e));
}

function enrichValidationResult(result: IDataObject): IDataObject {
	const riskScore = (result.risk_score as number) ?? 0;
	const qualityScore = (result.quality_score as number) ?? 0;
	const status = result.status as string;
	const valid = result.valid as boolean;

	const riskLevel = riskScore < RISK_THRESHOLDS.LOW ? 'low' : riskScore < RISK_THRESHOLDS.HIGH ? 'medium' : 'high';
	const qualityTier = qualityScore > QUALITY_THRESHOLDS.EXCELLENT ? 'excellent' : 
		qualityScore > QUALITY_THRESHOLDS.GOOD ? 'good' : 
		qualityScore > QUALITY_THRESHOLDS.FAIR ? 'fair' : 'poor';

	return {
		...result,
		risk_level: riskLevel,
		quality_tier: qualityTier,
		deliverability_status: status === 'deliverable' ? 'high' : status === 'risky' ? 'medium' : status === 'undeliverable' ? 'low' : 'unknown',
		is_high_risk: riskScore >= RISK_THRESHOLDS.HIGH,
		is_safe_to_send: valid === true && riskScore < 0.5,
		should_review: riskScore >= RISK_THRESHOLDS.LOW && riskScore < RISK_THRESHOLDS.HIGH,
		validated_at: new Date().toISOString(),
	};
}


function formatApiError(error: any, operation: string): string {
	const statusCode = error.statusCode || error.httpCode || 'unknown';
	const errorMessages: Record<number, string> = {
		400: 'Invalid request. Please check your input parameters.',
		401: 'Authentication failed. Please verify your API key is correct.',
		403: 'Access denied. Your plan may not include this feature.',
		404: 'Resource not found. The job ID may be invalid.',
		422: 'Validation error. Please check the email format.',
		429: 'Rate limit exceeded. Please wait before making more requests.',
		500: 'Server error. Please try again later.',
	};
	return errorMessages[statusCode] || `${operation} failed: ${error.message || 'Unknown error'} (${statusCode})`;
}

function estimateCompletion(emailCount: number, priority: string, checkSmtp: boolean): string {
	const baseTimePerEmail = checkSmtp ? 10 : 2;
	const priorityMultiplier: Record<string, number> = { low: 1.5, normal: 1.0, high: 0.5 };
	const multiplier = priorityMultiplier[priority] || 1.0;
	const totalSeconds = Math.max(60, emailCount * baseTimePerEmail * multiplier);
	return new Date(Date.now() + totalSeconds * 1000).toISOString();
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
			// Resource
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Email', value: 'email', description: 'Validate email addresses' },
					{ name: 'Batch Job', value: 'batch', description: 'Manage batch validation jobs' },
				],
				default: 'email',
			},
			// Email Operations
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['email'] } },
				options: [
					{ name: 'Validate', value: 'validate', description: 'Validate a single email', action: 'Validate an email' },
					{ name: 'Validate Many', value: 'validateMany', description: 'Validate multiple emails (up to 100)', action: 'Validate multiple emails' },
				],
				default: 'validate',
			},
			// Batch Operations
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['batch'] } },
				options: [
					{ name: 'Create Job', value: 'createJob', description: 'Create a batch validation job', action: 'Create a batch job' },
					{ name: 'Get Status', value: 'getStatus', description: 'Get batch job status', action: 'Get batch job status' },
					{ name: 'Get Results', value: 'getResults', description: 'Get batch job results', action: 'Get batch job results' },
					{ name: 'Cancel Job', value: 'cancelJob', description: 'Cancel a batch job', action: 'Cancel a batch job' },
				],
				default: 'createJob',
			},

			// Email field
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'], operation: ['validate'] } },
				placeholder: 'user@example.com',
				description: 'The email address to validate',
			},
			// Email options
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['email'], operation: ['validate'] } },
				options: [
					{ displayName: 'Check SMTP', name: 'checkSmtp', type: 'boolean', default: false, description: 'Whether to perform SMTP verification' },
					{ displayName: 'Include Raw DNS', name: 'includeRawDns', type: 'boolean', default: false, description: 'Whether to include DNS records' },
				],
			},
			// Emails for validateMany
			{
				displayName: 'Emails',
				name: 'emails',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['email'], operation: ['validateMany'] } },
				placeholder: 'user1@example.com, user2@example.com',
				description: 'Comma or newline separated emails (max 100)',
			},
			// ValidateMany options
			{
				displayName: 'Options',
				name: 'validateManyOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['email'], operation: ['validateMany'] } },
				options: [
					{ displayName: 'Check SMTP', name: 'checkSmtp', type: 'boolean', default: false, description: 'Whether to perform SMTP verification' },
					{ displayName: 'Return Individual Results', name: 'splitResults', type: 'boolean', default: true, description: 'Whether to return each email as separate item' },
				],
			},
			// Batch emails
			{
				displayName: 'Emails',
				name: 'batchEmails',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['batch'], operation: ['createJob'] } },
				placeholder: 'user1@example.com\nuser2@example.com',
				description: 'List of emails (max 10,000 for Enterprise)',
			},
			// Batch options
			{
				displayName: 'Options',
				name: 'batchOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['batch'], operation: ['createJob'] } },
				options: [
					{ displayName: 'Check SMTP', name: 'checkSmtp', type: 'boolean', default: false, description: 'Whether to perform SMTP verification' },
					{ displayName: 'Priority', name: 'priority', type: 'options', options: [{ name: 'Low', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'High', value: 'high' }], default: 'normal', description: 'Processing priority' },
					{ displayName: 'Callback URL', name: 'callbackUrl', type: 'string', default: '', description: 'Webhook URL for completion notification' },
					{ displayName: 'Job Name', name: 'jobName', type: 'string', default: '', description: 'Optional job identifier' },
				],
			},
			// Job ID
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['batch'], operation: ['getStatus', 'getResults', 'cancelJob'] } },
				placeholder: 'batch_550e8400-e29b-41d4-a716-446655440000',
				description: 'The batch job ID',
			},
			// Results options
			{
				displayName: 'Options',
				name: 'resultsOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['batch'], operation: ['getResults'] } },
				options: [
					{ displayName: 'Page', name: 'page', type: 'number', default: 1, description: 'Page number' },
					{ displayName: 'Page Size', name: 'pageSize', type: 'number', default: 100, description: 'Results per page (max 1000)' },
					{ displayName: 'Filter Status', name: 'filterStatus', type: 'options', options: [{ name: 'All', value: '' }, { name: 'Deliverable', value: 'deliverable' }, { name: 'Undeliverable', value: 'undeliverable' }, { name: 'Risky', value: 'risky' }], default: '', description: 'Filter by status' },
				],
			},
		],
	};


	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[];

				if (resource === 'email' && operation === 'validate') {
					// Single email validation
					const email = (this.getNodeParameter('email', i) as string).trim().toLowerCase();
					const options = this.getNodeParameter('options', i, {}) as IDataObject;

					if (!EMAIL_REGEX.test(email)) {
						throw new NodeOperationError(this.getNode(), `Invalid email format: "${email}"`, { itemIndex: i });
					}

					const body: IDataObject = { email };
					if (options.checkSmtp) body.check_smtp = true;
					if (options.includeRawDns) body.include_raw_dns = true;

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'POST' as IHttpRequestMethods,
						url: '/v1/validate/email',
						body,
						json: true,
						timeout: DEFAULT_TIMEOUT,
					});
					responseData = enrichValidationResult(response as IDataObject);

				} else if (resource === 'email' && operation === 'validateMany') {
					// Multiple emails validation
					const emailsInput = this.getNodeParameter('emails', i) as string;
					const options = this.getNodeParameter('validateManyOptions', i, {}) as IDataObject;
					const emails = parseEmails(emailsInput);

					if (emails.length === 0) {
						throw new NodeOperationError(this.getNode(), 'No valid emails provided', { itemIndex: i });
					}
					if (emails.length > MAX_SYNC_BATCH) {
						throw new NodeOperationError(this.getNode(), `Too many emails (${emails.length}). Max is ${MAX_SYNC_BATCH}. Use Batch Job for larger lists.`, { itemIndex: i });
					}

					const body: IDataObject = { emails };
					if (options.checkSmtp) body.check_smtp = true;

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'POST' as IHttpRequestMethods,
						url: '/v1/validate/batch',
						body,
						json: true,
						timeout: DEFAULT_TIMEOUT * 2,
					});

					const results = ((response as IDataObject).results as IDataObject[]) || [];
					const enrichedResults = results.map((r) => enrichValidationResult(r));

					if (options.splitResults !== false) {
						responseData = enrichedResults;
					} else {
						responseData = {
							total: emails.length,
							results: enrichedResults,
							validated_at: new Date().toISOString(),
						};
					}

				} else if (resource === 'batch' && operation === 'createJob') {
					// Create batch job
					const emailsInput = this.getNodeParameter('batchEmails', i) as string;
					const options = this.getNodeParameter('batchOptions', i, {}) as IDataObject;
					const emails = [...new Set(parseEmails(emailsInput))]; // Deduplicate

					if (emails.length === 0) {
						throw new NodeOperationError(this.getNode(), 'No valid emails provided', { itemIndex: i });
					}
					if (emails.length > MAX_ASYNC_BATCH) {
						throw new NodeOperationError(this.getNode(), `Too many emails (${emails.length}). Max is ${MAX_ASYNC_BATCH}.`, { itemIndex: i });
					}

					const body: IDataObject = { emails };
					if (options.checkSmtp) body.check_smtp = true;
					if (options.priority) body.priority = options.priority;
					if (options.callbackUrl) body.callback_url = options.callbackUrl;
					if (options.jobName) body.batch_name = options.jobName;

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'POST' as IHttpRequestMethods,
						url: '/v1/jobs',
						body,
						json: true,
					});

					responseData = {
						...(response as IDataObject),
						total_emails: emails.length,
						submitted_at: new Date().toISOString(),
						estimated_completion: estimateCompletion(emails.length, options.priority as string || 'normal', !!options.checkSmtp),
					};

				} else if (resource === 'batch' && operation === 'getStatus') {
					// Get batch status
					const jobId = (this.getNodeParameter('jobId', i) as string).trim();
					if (!jobId) throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex: i });

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'GET' as IHttpRequestMethods,
						url: `/v1/jobs/${encodeURIComponent(jobId)}`,
						json: true,
					});

					const result = response as IDataObject;
					responseData = {
						...result,
						is_completed: result.status === 'completed',
						is_failed: result.status === 'failed',
						is_processing: result.status === 'processing' || result.status === 'pending',
					};

				} else if (resource === 'batch' && operation === 'getResults') {
					// Get batch results
					const jobId = (this.getNodeParameter('jobId', i) as string).trim();
					const options = this.getNodeParameter('resultsOptions', i, {}) as IDataObject;
					if (!jobId) throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex: i });

					const qs: IDataObject = {};
					if (options.page) qs.page = options.page;
					if (options.pageSize) qs.page_size = options.pageSize;
					if (options.filterStatus) qs.status = options.filterStatus;

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'GET' as IHttpRequestMethods,
						url: `/v1/jobs/${encodeURIComponent(jobId)}/results`,
						qs,
						json: true,
					});

					const result = response as IDataObject;
					const results = (result.results as IDataObject[]) || [];
					responseData = { ...result, results: results.map((r) => enrichValidationResult(r)) };

				} else if (resource === 'batch' && operation === 'cancelJob') {
					// Cancel batch job
					const jobId = (this.getNodeParameter('jobId', i) as string).trim();
					if (!jobId) throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex: i });

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'mailSafeProApi', {
						method: 'POST' as IHttpRequestMethods,
						url: `/v1/jobs/${encodeURIComponent(jobId)}/cancel`,
						json: true,
					});

					responseData = { ...(response as IDataObject), cancelled_at: new Date().toISOString() };

				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${resource}/${operation}`, { itemIndex: i });
				}

				// Handle array results
				if (Array.isArray(responseData)) {
					for (const item of responseData) {
						returnData.push({ json: item, pairedItem: { item: i } });
					}
				} else {
					returnData.push({ json: responseData, pairedItem: { item: i } });
				}

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message, success: false },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
