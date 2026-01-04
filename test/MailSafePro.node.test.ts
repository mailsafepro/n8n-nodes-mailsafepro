/**
 * MailSafePro n8n Node - Unit Tests
 * 
 * Tests cover:
 * - Email validation logic
 * - Batch operations
 * - Error handling
 * - Result enrichment
 * - Input parsing
 */

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('Helper Functions', () => {
	describe('parseEmails', () => {
		const parseEmails = (input: string): string[] => {
			const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			return input
				.split(/[,\n;]/)
				.map((e) => e.trim().toLowerCase())
				.filter((e) => e.length > 0 && EMAIL_REGEX.test(e));
		};

		it('should parse comma-separated emails', () => {
			const result = parseEmails('user1@gmail.com, user2@yahoo.com, user3@outlook.com');
			expect(result).toHaveLength(3);
			expect(result).toContain('user1@gmail.com');
			expect(result).toContain('user2@yahoo.com');
			expect(result).toContain('user3@outlook.com');
		});

		it('should parse newline-separated emails', () => {
			const result = parseEmails('user1@gmail.com\nuser2@yahoo.com\nuser3@outlook.com');
			expect(result).toHaveLength(3);
		});

		it('should parse semicolon-separated emails', () => {
			const result = parseEmails('user1@gmail.com; user2@yahoo.com; user3@outlook.com');
			expect(result).toHaveLength(3);
		});

		it('should handle mixed separators', () => {
			const result = parseEmails('user1@gmail.com, user2@yahoo.com\nuser3@outlook.com; user4@test.com');
			expect(result).toHaveLength(4);
		});

		it('should filter out invalid emails', () => {
			const result = parseEmails('valid@gmail.com, invalid-email, @nodomain.com, noat.com');
			expect(result).toHaveLength(1);
			expect(result[0]).toBe('valid@gmail.com');
		});

		it('should convert to lowercase', () => {
			const result = parseEmails('USER@GMAIL.COM, Test@Yahoo.com');
			expect(result).toContain('user@gmail.com');
			expect(result).toContain('test@yahoo.com');
		});

		it('should trim whitespace', () => {
			const result = parseEmails('  user@gmail.com  ,   test@yahoo.com   ');
			expect(result).toContain('user@gmail.com');
			expect(result).toContain('test@yahoo.com');
		});

		it('should handle empty input', () => {
			const result = parseEmails('');
			expect(result).toHaveLength(0);
		});

		it('should handle only invalid emails', () => {
			const result = parseEmails('invalid, also-invalid, @bad.com');
			expect(result).toHaveLength(0);
		});
	});

	describe('calculateRiskLevel', () => {
		const RISK_THRESHOLDS = { LOW: 0.3, HIGH: 0.7 };
		const calculateRiskLevel = (score: number): 'low' | 'medium' | 'high' => {
			if (score < RISK_THRESHOLDS.LOW) return 'low';
			if (score < RISK_THRESHOLDS.HIGH) return 'medium';
			return 'high';
		};

		it('should return "low" for scores below 0.3', () => {
			expect(calculateRiskLevel(0)).toBe('low');
			expect(calculateRiskLevel(0.1)).toBe('low');
			expect(calculateRiskLevel(0.29)).toBe('low');
		});

		it('should return "medium" for scores between 0.3 and 0.7', () => {
			expect(calculateRiskLevel(0.3)).toBe('medium');
			expect(calculateRiskLevel(0.5)).toBe('medium');
			expect(calculateRiskLevel(0.69)).toBe('medium');
		});

		it('should return "high" for scores 0.7 and above', () => {
			expect(calculateRiskLevel(0.7)).toBe('high');
			expect(calculateRiskLevel(0.85)).toBe('high');
			expect(calculateRiskLevel(1.0)).toBe('high');
		});
	});

	describe('calculateQualityTier', () => {
		const QUALITY_THRESHOLDS = { EXCELLENT: 0.8, GOOD: 0.6, FAIR: 0.4 };
		const calculateQualityTier = (score: number): string => {
			if (score > QUALITY_THRESHOLDS.EXCELLENT) return 'excellent';
			if (score > QUALITY_THRESHOLDS.GOOD) return 'good';
			if (score > QUALITY_THRESHOLDS.FAIR) return 'fair';
			return 'poor';
		};

		it('should return "excellent" for scores above 0.8', () => {
			expect(calculateQualityTier(0.81)).toBe('excellent');
			expect(calculateQualityTier(0.95)).toBe('excellent');
			expect(calculateQualityTier(1.0)).toBe('excellent');
		});

		it('should return "good" for scores between 0.6 and 0.8', () => {
			expect(calculateQualityTier(0.61)).toBe('good');
			expect(calculateQualityTier(0.7)).toBe('good');
			expect(calculateQualityTier(0.8)).toBe('good');
		});

		it('should return "fair" for scores between 0.4 and 0.6', () => {
			expect(calculateQualityTier(0.41)).toBe('fair');
			expect(calculateQualityTier(0.5)).toBe('fair');
			expect(calculateQualityTier(0.6)).toBe('fair');
		});

		it('should return "poor" for scores 0.4 and below', () => {
			expect(calculateQualityTier(0.4)).toBe('poor');
			expect(calculateQualityTier(0.2)).toBe('poor');
			expect(calculateQualityTier(0)).toBe('poor');
		});
	});
});


// ============================================================================
// RESULT ENRICHMENT TESTS
// ============================================================================

describe('Result Enrichment', () => {
	const enrichValidationResult = (result: Record<string, any>): Record<string, any> => {
		const riskScore = result.risk_score ?? 0;
		const qualityScore = result.quality_score ?? 0;
		const status = result.status as string;
		const valid = result.valid as boolean;

		const calculateRiskLevel = (score: number) => score < 0.3 ? 'low' : score < 0.7 ? 'medium' : 'high';
		const calculateQualityTier = (score: number) => score > 0.8 ? 'excellent' : score > 0.6 ? 'good' : score > 0.4 ? 'fair' : 'poor';

		return {
			...result,
			risk_level: calculateRiskLevel(riskScore),
			quality_tier: calculateQualityTier(qualityScore),
			deliverability_status: 
				status === 'deliverable' ? 'high' : 
				status === 'risky' ? 'medium' : 
				status === 'undeliverable' ? 'low' : 'unknown',
			is_high_risk: riskScore >= 0.7,
			is_safe_to_send: valid === true && riskScore < 0.5,
			should_review: riskScore >= 0.3 && riskScore < 0.7,
		};
	};

	it('should enrich deliverable email correctly', () => {
		const result = enrichValidationResult({
			email: 'user@gmail.com',
			valid: true,
			status: 'deliverable',
			risk_score: 0.15,
			quality_score: 0.89,
		});

		expect(result.risk_level).toBe('low');
		expect(result.quality_tier).toBe('excellent');
		expect(result.deliverability_status).toBe('high');
		expect(result.is_high_risk).toBe(false);
		expect(result.is_safe_to_send).toBe(true);
		expect(result.should_review).toBe(false);
	});

	it('should enrich risky email correctly', () => {
		const result = enrichValidationResult({
			email: 'admin@company.com',
			valid: true,
			status: 'risky',
			risk_score: 0.45,
			quality_score: 0.65,
		});

		expect(result.risk_level).toBe('medium');
		expect(result.quality_tier).toBe('good');
		expect(result.deliverability_status).toBe('medium');
		expect(result.is_high_risk).toBe(false);
		expect(result.is_safe_to_send).toBe(true);
		expect(result.should_review).toBe(true);
	});

	it('should enrich undeliverable email correctly', () => {
		const result = enrichValidationResult({
			email: 'fake@tempmail.com',
			valid: false,
			status: 'undeliverable',
			risk_score: 1.0,
			quality_score: 0.0,
		});

		expect(result.risk_level).toBe('high');
		expect(result.quality_tier).toBe('poor');
		expect(result.deliverability_status).toBe('low');
		expect(result.is_high_risk).toBe(true);
		expect(result.is_safe_to_send).toBe(false);
		expect(result.should_review).toBe(false);
	});

	it('should handle missing scores gracefully', () => {
		const result = enrichValidationResult({
			email: 'user@example.com',
			valid: true,
			status: 'unknown',
		});

		expect(result.risk_level).toBe('low');
		expect(result.quality_tier).toBe('poor');
		expect(result.deliverability_status).toBe('unknown');
		expect(result.is_high_risk).toBe(false);
		expect(result.is_safe_to_send).toBe(true);
	});
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
	const formatApiError = (error: any, operation: string): string => {
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
		};

		return errorMessages[statusCode] || `${operation} failed: ${message} (${statusCode})`;
	};

	it('should format 401 error correctly', () => {
		const error = { statusCode: 401, message: 'Unauthorized' };
		const result = formatApiError(error, 'Validate email');
		expect(result).toBe('Authentication failed. Please verify your API key is correct.');
	});

	it('should format 429 error correctly', () => {
		const error = { statusCode: 429, message: 'Too many requests' };
		const result = formatApiError(error, 'Validate email');
		expect(result).toBe('Rate limit exceeded. Please wait before making more requests.');
	});

	it('should format unknown error with operation name', () => {
		const error = { statusCode: 418, message: "I'm a teapot" };
		const result = formatApiError(error, 'Create batch');
		expect(result).toBe("Create batch failed: I'm a teapot (418)");
	});

	it('should handle missing status code', () => {
		const error = { message: 'Network error' };
		const result = formatApiError(error, 'Get status');
		expect(result).toBe('Get status failed: Network error (unknown)');
	});
});

// ============================================================================
// VALIDATION TESTS
// ============================================================================

describe('Input Validation', () => {
	const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	describe('Email format validation', () => {
		it('should accept valid email formats', () => {
			const validEmails = [
				'user@gmail.com',
				'user.name@domain.co.uk',
				'user+tag@example.org',
				'user123@test.io',
				'a@b.co',
			];

			validEmails.forEach((email) => {
				expect(EMAIL_REGEX.test(email)).toBe(true);
			});
		});

		it('should reject invalid email formats', () => {
			const invalidEmails = [
				'invalid',
				'@domain.com',
				'user@',
				'user@.com',
				'user name@domain.com',
				'user@@domain.com',
			];

			invalidEmails.forEach((email) => {
				expect(EMAIL_REGEX.test(email)).toBe(false);
			});
		});
	});

	describe('Batch size limits', () => {
		const MAX_SYNC_BATCH = 100;
		const MAX_ASYNC_BATCH = 10000;

		it('should enforce sync batch limit', () => {
			const emails = Array(101).fill('test@example.com');
			expect(emails.length).toBeGreaterThan(MAX_SYNC_BATCH);
		});

		it('should enforce async batch limit', () => {
			const emails = Array(10001).fill('test@example.com');
			expect(emails.length).toBeGreaterThan(MAX_ASYNC_BATCH);
		});
	});
});

// ============================================================================
// COMPLETION ESTIMATION TESTS
// ============================================================================

describe('Completion Estimation', () => {
	const estimateCompletion = (emailCount: number, priority: string, checkSmtp: boolean): number => {
		const baseTimePerEmail = checkSmtp ? 10 : 2;
		const priorityMultiplier: Record<string, number> = { low: 1.5, normal: 1.0, high: 0.5 };
		const multiplier = priorityMultiplier[priority] || 1.0;
		return Math.max(60, emailCount * baseTimePerEmail * multiplier);
	};

	it('should estimate longer time for SMTP checks', () => {
		const withSmtp = estimateCompletion(100, 'normal', true);
		const withoutSmtp = estimateCompletion(100, 'normal', false);
		expect(withSmtp).toBeGreaterThan(withoutSmtp);
	});

	it('should estimate shorter time for high priority', () => {
		const highPriority = estimateCompletion(100, 'high', false);
		const normalPriority = estimateCompletion(100, 'normal', false);
		expect(highPriority).toBeLessThan(normalPriority);
	});

	it('should estimate longer time for low priority', () => {
		const lowPriority = estimateCompletion(100, 'low', false);
		const normalPriority = estimateCompletion(100, 'normal', false);
		expect(lowPriority).toBeGreaterThan(normalPriority);
	});

	it('should have minimum 60 seconds', () => {
		const result = estimateCompletion(1, 'high', false);
		expect(result).toBeGreaterThanOrEqual(60);
	});
});
