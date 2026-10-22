import type {
  CodeQualityResult,
  TestCoverageResult,
  RefactoringSuggestion,
  ReviewReport,
} from '../../src/types/index.js';

export const validCodeQuality: CodeQualityResult = {
  file: 'src/app.js',
  issues: [
    {
      line: 42,
      severity: 'high',
      category: 'security',
      description: 'User input is concatenated into an SQL string.',
      suggestion: 'Use a parameterized query instead.',
    },
  ],
  overallScore: 60,
  summary: 'One high-severity security issue found.',
};

export const validTestCoverage: TestCoverageResult = {
  file: 'src/app.js',
  hasTests: true,
  testFiles: ['tests/app.test.js'],
  untestedPaths: [
    {
      type: 'function',
      location: 'addTodo',
      priority: 'high',
      reasoning: 'Core function that mutates the todo list has no test.',
      suggestedTest: "addTodo('') should throw and leave the list unchanged",
    },
  ],
  coverageEstimate: 55,
  summary: 'About half of the code paths are tested.',
};

export const validRefactoring: RefactoringSuggestion = {
  file: 'src/app.js',
  suggestions: [
    {
      type: 'modernize',
      location: 'loadTodos',
      impact: 'medium',
      description: 'Replace var and callbacks with const and async/await.',
      before: 'var data = fs.readFileSync(path);',
      after: 'const data = await fs.promises.readFile(path);',
      benefits: 'Clearer scoping and non-blocking I/O.',
    },
  ],
  summary: 'One modernization opportunity.',
};

export const validReport: ReviewReport = {
  pullRequest: { owner: 'octocat', repo: 'Hello-World', number: 1 },
  fileReviews: [
    {
      file: 'src/app.js',
      codeQuality: validCodeQuality,
      testCoverage: validTestCoverage,
      refactorings: validRefactoring,
    },
  ],
  summary: {
    totalFiles: 1,
    overallScore: 70,
    criticalIssues: 0,
    highPriorityTests: 1,
    refactoringOpportunities: 1,
  },
  recommendations: [
    {
      priority: 'high',
      category: 'security',
      description: 'Fix the SQL injection risk in src/app.js.',
      files: ['src/app.js'],
    },
  ],
  metadata: {
    analyzedAt: '2026-10-08T00:00:00.000Z',
    duration: 1000,
    agentVersions: {
      'code-quality-analyzer': '1.0.0',
      'test-coverage-analyzer': '1.0.0',
      'refactoring-suggester': '1.0.0',
    },
  },
};
