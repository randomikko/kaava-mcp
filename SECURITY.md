# Security

## Reporting a vulnerability

Please report security issues privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue.

You can expect a first response within a week. Fixes are released for the latest published version.

## What Kaava does on your machine

- Runs locally over stdio. It makes no network requests and needs no credentials.
- Reads and writes files only inside the project root: the workspace root the MCP client exposes, or the directory the server was started in. Paths that resolve outside it, directly or through a symlink, are refused.
- Writes `kaava.json` and the files requested through `kaava_emit`. Existing files it did not generate are left alone unless `overwrite` is passed. It does not execute project code.

A way to make Kaava read or write outside the project root is a vulnerability and worth reporting.
