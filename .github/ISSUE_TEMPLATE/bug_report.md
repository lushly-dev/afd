name: Bug Report
description: Report a bug to help us improve.
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to fill out this bug report!
  - type: textarea
    id: description
    attributes:
      label: Bug Description
      description: A clear and concise description of what the bug is.
    validations:
      required: true
  - type: textarea
    id: reproduction
    attributes:
      label: Steps to Reproduce
      description: |
        1. Install package `...`
        2. Run command `...`
        3. See error `...`
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
      description: A clear and concise description of what you expected to happen.
    validations:
      required: true
  - type: textarea
    id: environment
    attributes:
      label: Environment Info
      description: |
        - OS: [e.g. macOS, Windows, Linux]
        - Node.js version: [e.g. 20.x]
        - Package version: [e.g. 0.1.1]
    validations:
      required: true
  - type: textarea
    id: additional-context
    attributes:
      label: Additional Context
      description: Add any other context about the problem here.
