#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { runCli } from './cli.js';
import { createServer } from './server.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  // stdout carries the protocol; anything human-readable must go to stderr.
  await createServer().connect(new StdioServerTransport());
} else {
  // exitCode rather than exit(), so piped output is flushed before the process ends.
  process.exitCode = await runCli(args, {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
  });
}
