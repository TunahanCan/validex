@e2e @performance @performance-workbench
Feature: Configure and compare URL performance runs
  As an API developer
  I want controlled load, useful live results, and comparable reports
  So that benchmark findings are reproducible

  Background:
    Given Validex is running with a deterministic native bridge
    And I am in the "Performance" workspace

  @presets
  Scenario: Apply each benchmark preset without starting requests
    When I select every performance workload preset
    Then each preset configures its documented workload without sending requests

  @concurrency @warmup @live @filters
  Scenario: Exclude warmup while measuring concurrent requests and status failures
    Given a controlled concurrent performance run with one warmup request
    When I start the controlled performance run
    Then warmup is shown before two measured requests run concurrently
    When the first measured performance response arrives
    Then live results contain only the completed measured response
    When the remaining measured performance responses arrive
    Then the completed benchmark excludes warmup and flags unexpected status and target failures
    And sample filters and ordering preserve the aggregate benchmark
    And the diagnostics workspace has no uncaught frontend error

  @baseline @history @export
  Scenario: Compare a later run and export the recorded benchmark
    Given a completed performance baseline with two successful samples
    When I retain that performance run as a baseline and run a slower benchmark
    Then the comparison marks latency regression and retains both runs
    When I copy and export the latest performance report
    Then the copied summary and JSON and CSV reports describe the same measured run
    When I restore the earlier performance run from history
    Then the earlier samples return without additional network requests
    And the retained performance baseline can be cleared
    And the diagnostics workspace has no uncaught frontend error
