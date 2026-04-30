# Security Policy

## Supported versions

Security fixes are supported for the latest published release on the `main` line.

| Version | Supported |
|---------|-----------|
| latest release | yes |
| older releases | no |
| prerelease / canary | best effort |

## Reporting a vulnerability

Please do not report vulnerabilities in public GitHub issues.

Use one of these private channels:
- GitHub Security Advisories for this repository
- direct maintainer contact if a private channel is available

When reporting, include:
- affected version
- impact summary
- reproduction steps or proof of concept
- suggested mitigation if known

You can expect:
- acknowledgement as soon as practical
- triage and severity assessment
- a coordinated fix/release plan when confirmed

## Scope

This project analyzes local TypeScript codebases and exposes results through CLI and MCP interfaces.
Security-relevant reports may include:
- command execution risks
- unsafe path handling
- unintended filesystem access
- data exposure through MCP responses
- dependency vulnerabilities with practical impact
