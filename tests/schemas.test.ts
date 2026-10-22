import { describe, it, expect } from 'vitest';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  ReviewReportSchema,
  CodeQualityResultJSONSchema,
  TestCoverageResultJSONSchema,
  RefactoringSuggestionJSONSchema,
  ReviewReportJSONSchema,
} from '../src/types/index.js';
import {
  validCodeQuality,
  validTestCoverage,
  validRefactoring,
  validReport,
} from './fixtures/sample-report.js';

describe('CodeQualityResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => CodeQualityResultSchema.parse(validCodeQuality)).not.toThrow();
  });

  it('accepts an empty issues array', () => {
    const data = { ...validCodeQuality, issues: [] };
    expect(CodeQualityResultSchema.safeParse(data).success).toBe(true);
  });

  it('accepts boundary scores of 0 and 100', () => {
    expect(CodeQualityResultSchema.safeParse({ ...validCodeQuality, overallScore: 0 }).success).toBe(true);
    expect(CodeQualityResultSchema.safeParse({ ...validCodeQuality, overallScore: 100 }).success).toBe(true);
  });

  it('rejects scores outside 0-100', () => {
    expect(CodeQualityResultSchema.safeParse({ ...validCodeQuality, overallScore: 101 }).success).toBe(false);
    expect(CodeQualityResultSchema.safeParse({ ...validCodeQuality, overallScore: -1 }).success).toBe(false);
  });

  it('rejects an invalid severity value', () => {
    const data = {
      ...validCodeQuality,
      issues: [{ ...validCodeQuality.issues[0], severity: 'urgent' }],
    };
    expect(() => CodeQualityResultSchema.parse(data)).toThrow();
  });

  it('rejects an invalid category value', () => {
    const data = {
      ...validCodeQuality,
      issues: [{ ...validCodeQuality.issues[0], category: 'vibes' }],
    };
    expect(CodeQualityResultSchema.safeParse(data).success).toBe(false);
  });

  it('rejects a line number given as a string', () => {
    const data = {
      ...validCodeQuality,
      issues: [{ ...validCodeQuality.issues[0], line: '42' }],
    };
    expect(CodeQualityResultSchema.safeParse(data).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { summary: _summary, ...withoutSummary } = validCodeQuality;
    expect(CodeQualityResultSchema.safeParse(withoutSummary).success).toBe(false);
  });
});

describe('TestCoverageResultSchema', () => {
  it('accepts valid data', () => {
    expect(() => TestCoverageResultSchema.parse(validTestCoverage)).not.toThrow();
  });

  it('accepts a file with no tests and empty arrays', () => {
    const data = { ...validTestCoverage, hasTests: false, testFiles: [], untestedPaths: [], coverageEstimate: 0 };
    expect(TestCoverageResultSchema.safeParse(data).success).toBe(true);
  });

  it('rejects a coverage estimate above 100', () => {
    expect(TestCoverageResultSchema.safeParse({ ...validTestCoverage, coverageEstimate: 150 }).success).toBe(false);
  });

  it('rejects an invalid untested path type', () => {
    const data = {
      ...validTestCoverage,
      untestedPaths: [{ ...validTestCoverage.untestedPaths[0], type: 'module' }],
    };
    expect(TestCoverageResultSchema.safeParse(data).success).toBe(false);
  });

  it('rejects hasTests given as a string', () => {
    expect(TestCoverageResultSchema.safeParse({ ...validTestCoverage, hasTests: 'yes' }).success).toBe(false);
  });
});

describe('RefactoringSuggestionSchema', () => {
  it('accepts valid data', () => {
    expect(() => RefactoringSuggestionSchema.parse(validRefactoring)).not.toThrow();
  });

  it('accepts an empty suggestions array', () => {
    expect(RefactoringSuggestionSchema.safeParse({ ...validRefactoring, suggestions: [] }).success).toBe(true);
  });

  it('rejects an invalid suggestion type', () => {
    const data = {
      ...validRefactoring,
      suggestions: [{ ...validRefactoring.suggestions[0], type: 'rewrite-everything' }],
    };
    expect(RefactoringSuggestionSchema.safeParse(data).success).toBe(false);
  });

  it('rejects an invalid impact value', () => {
    const data = {
      ...validRefactoring,
      suggestions: [{ ...validRefactoring.suggestions[0], impact: 'critical' }],
    };
    expect(RefactoringSuggestionSchema.safeParse(data).success).toBe(false);
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a valid report', () => {
    expect(() => ReviewReportSchema.parse(validReport)).not.toThrow();
  });

  it('accepts empty fileReviews and recommendations', () => {
    const data = { ...validReport, fileReviews: [], recommendations: [] };
    expect(ReviewReportSchema.safeParse(data).success).toBe(true);
  });

  it('rejects a report without pullRequest info', () => {
    const { pullRequest: _pr, ...withoutPr } = validReport;
    expect(ReviewReportSchema.safeParse(withoutPr).success).toBe(false);
  });

  it('rejects a non-numeric PR number', () => {
    const data = { ...validReport, pullRequest: { ...validReport.pullRequest, number: 'one' } };
    expect(ReviewReportSchema.safeParse(data).success).toBe(false);
  });

  it('rejects an invalid recommendation priority', () => {
    const data = {
      ...validReport,
      recommendations: [{ ...validReport.recommendations[0], priority: 'asap' }],
    };
    expect(ReviewReportSchema.safeParse(data).success).toBe(false);
  });

  it('rejects a report without metadata', () => {
    const { metadata: _metadata, ...withoutMetadata } = validReport;
    expect(ReviewReportSchema.safeParse(withoutMetadata).success).toBe(false);
  });
});

describe('JSON schema export', () => {
  it('exports the report schema as a JSON object schema with all top-level properties', () => {
    expect(ReviewReportJSONSchema.type).toBe('object');
    const properties = ReviewReportJSONSchema.properties as Record<string, unknown>;
    for (const key of ['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata']) {
      expect(properties).toHaveProperty(key);
    }
  });

  it('marks the top-level report properties as required', () => {
    const required = ReviewReportJSONSchema.required as string[];
    expect(required).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
  });

  it('exports the analyzer schemas as object schemas with required fields', () => {
    expect(CodeQualityResultJSONSchema.required as string[]).toEqual(
      expect.arrayContaining(['file', 'issues', 'overallScore', 'summary'])
    );
    expect(TestCoverageResultJSONSchema.required as string[]).toEqual(
      expect.arrayContaining(['file', 'hasTests', 'testFiles', 'untestedPaths', 'coverageEstimate', 'summary'])
    );
    expect(RefactoringSuggestionJSONSchema.required as string[]).toEqual(
      expect.arrayContaining(['file', 'suggestions', 'summary'])
    );
  });

  it('keeps enum values in the exported JSON schema', () => {
    const properties = CodeQualityResultJSONSchema.properties as Record<
      string,
      { items: { properties: Record<string, { enum: string[] }> } }
    >;
    expect(properties.issues.items.properties.severity.enum).toEqual([
      'critical',
      'high',
      'medium',
      'low',
      'info',
    ]);
  });

  it('can be serialized to JSON without losing structure', () => {
    const roundTrip = JSON.parse(JSON.stringify(ReviewReportJSONSchema));
    expect(roundTrip.type).toBe('object');
    expect(roundTrip.required).toEqual(ReviewReportJSONSchema.required);
  });
});
