# Reporting a security issue

If you find an issue that may expose credentials, run unexpected Git operations, or allow repository-list paths to escape the scan root, contact the maintainer through the private security reporting channel of this source repository. Do not publish exploitable details before a fix is available.

The extension runs read-only Git commands. Do not put credential-bearing URLs in the `remote` field of a repository list.
