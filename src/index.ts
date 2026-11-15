#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  console.log(VERSION);
} else if (arg === '--help' || arg === '-h') {
  console.log(`kaava-mcp ${VERSION}
MCP server that generates and maintains a project's design system.

It speaks MCP over stdio and is meant to be launched by an MCP client:

  Claude Code:   claude mcp add kaava -- npx -y kaava-mcp
  Other clients: { "command": "npx", "args": ["-y", "kaava-mcp"] }

The project root is the client's workspace root, or the directory the server is started in.`);
} else {
  // stdout carries the protocol; anything human-readable must go to stderr.
  await createServer().connect(new StdioServerTransport());
}
