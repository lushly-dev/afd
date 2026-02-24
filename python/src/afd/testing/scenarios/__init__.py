"""
JTBD Scenario Testing for AFD.

Port of @lushly-dev/afd-testing scenario system.
Provides YAML-based scenario definition, execution, evaluation, and reporting.
"""

from afd.testing.scenarios.coverage import (
    CommandCoverage,
    CoverageReport,
    CoverageSummary,
    ErrorCoverage,
    JobCoverage,
    scenario_coverage,
)
from afd.testing.scenarios.evaluator import (
    EvaluationResult,
    evaluate_result,
    get_value_at_path,
)
from afd.testing.scenarios.executor import (
    InProcessExecutor,
    InProcessExecutorConfig,
    ScenarioValidationResult,
    create_in_process_executor,
    resolve_step_references,
    validate_scenario,
)
from afd.testing.scenarios.parser import (
    ParseError,
    ParseResult,
    ParseSuccess,
    parse_scenario,
    parse_scenario_dir,
    parse_scenario_file,
)
from afd.testing.scenarios.reporter import (
    TerminalReporter,
    create_json_reporter,
    create_reporter,
    create_verbose_reporter,
)
from afd.testing.scenarios.commands import (
    scenario_coverage_command,
    scenario_create_command,
    scenario_evaluate_command,
    scenario_list_command,
    scenario_suggest_command,
)
from afd.testing.scenarios.types import (
    AssertionMatcher,
    AssertionResult,
    Expectation,
    FixtureConfig,
    Scenario,
    ScenarioOutcome,
    ScenarioResult,
    Step,
    StepError,
    StepOutcome,
    StepResult,
    TestReport,
    TestSummary,
    Verification,
    calculate_summary,
    create_empty_summary,
    create_step_error,
    is_assertion_matcher,
    is_scenario,
)

__all__ = [
    # Scenario types
    'Scenario',
    'Step',
    'Expectation',
    'AssertionMatcher',
    'FixtureConfig',
    'Verification',
    # Report types
    'StepOutcome',
    'ScenarioOutcome',
    'StepError',
    'AssertionResult',
    'StepResult',
    'ScenarioResult',
    'TestSummary',
    'TestReport',
    # Type guards
    'is_assertion_matcher',
    'is_scenario',
    # Factory functions
    'create_empty_summary',
    'calculate_summary',
    'create_step_error',
    # Parser
    'ParseSuccess',
    'ParseError',
    'ParseResult',
    'parse_scenario',
    'parse_scenario_file',
    'parse_scenario_dir',
    # Evaluator
    'EvaluationResult',
    'evaluate_result',
    'get_value_at_path',
    # Executor
    'InProcessExecutor',
    'InProcessExecutorConfig',
    'ScenarioValidationResult',
    'create_in_process_executor',
    'resolve_step_references',
    'validate_scenario',
    # Coverage
    'CommandCoverage',
    'ErrorCoverage',
    'JobCoverage',
    'CoverageSummary',
    'CoverageReport',
    'scenario_coverage',
    # Reporter
    'TerminalReporter',
    'create_reporter',
    'create_json_reporter',
    'create_verbose_reporter',
    # Commands
    'scenario_list_command',
    'scenario_evaluate_command',
    'scenario_coverage_command',
    'scenario_create_command',
    'scenario_suggest_command',
]
