# Security Policy

## Supported Versions

Only the latest release on `master` is supported with security updates.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, please email **security@primelocus.com** or use [GitHub's private vulnerability reporting](https://github.com/PrimeLocus/Hydra/security/advisories/new).

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment

We'll acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Daemon Security

Hydra's HTTP daemon binds to `127.0.0.1` (localhost only) by default. It is designed for local, single-user use and does not include authentication. Do not expose it to untrusted networks.
