import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * MailSafePro API Credentials
 * 
 * Supports:
 * - API Key authentication (X-API-Key header)
 * - Configurable base URL for self-hosted instances
 */
export class MailSafeProApi implements ICredentialType {
	name = 'mailSafeProApi';
	displayName = 'MailSafePro API';
	documentationUrl = 'https://docs.mailsafepro.com/authentication';
	
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Your MailSafePro API Key. Get it from your <a href="https://mailsafepro.com/dashboard" target="_blank">dashboard</a>.',
			placeholder: 'msp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.mailsafepro.com',
			required: true,
			description: 'Base URL for the MailSafePro API. Only change for self-hosted instances.',
			placeholder: 'https://api.mailsafepro.com',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
				'X-Client-Platform': 'n8n',
			},
		},
	};

	// Test credentials by calling an authenticated endpoint
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/billing/usage',
			method: 'GET',
			timeout: 10000,
		},
	};
}
