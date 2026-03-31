#!/usr/bin/env python3
"""
JobHunter — Claude CLI Companion Server

A lightweight local HTTP server that wraps the `claude` CLI tool.
The Chrome extension calls this server when it encounters application
questions it can't answer with built-in rules or custom Q&A pairs.

Usage:
    python claude_server.py              # default port 3847
    python claude_server.py --port 4000  # custom port

Requires:
    - `claude` CLI installed and authenticated (claude.ai subscription)
"""

import subprocess
import json
import sys
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler

DEFAULT_PORT = 3847

SYSTEM_PROMPT = """You are helping fill out a job application. Given the applicant's profile and a question from the application form, provide ONLY the answer text — no explanation, no quotes, no extra formatting. If it's a yes/no or multiple choice question, respond with just the matching option. Keep answers concise (1-3 words for simple fields, 1-2 sentences max for text areas). If you truly cannot determine an answer from the profile, respond with exactly: SKIP"""


class ClaudeHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_json(200, {'status': 'ok', 'service': 'jobhunter-claude'})
        else:
            self.send_json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/ask':
            self.send_json(404, {'error': 'not found'})
            return

        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except (json.JSONDecodeError, ValueError):
            self.send_json(400, {'error': 'invalid JSON'})
            return

        question = body.get('question', '').strip()
        profile  = body.get('profile', '')
        qa       = body.get('qa', '')

        if not question:
            self.send_json(400, {'error': 'missing question'})
            return

        prompt = f"Applicant profile:\n{profile}\n\nKnown Q&A:\n{qa}\n\nApplication question: \"{question}\"\n\nProvide the best answer:"

        try:
            result = subprocess.run(
                ['claude', '-p', '--no-markdown', prompt],
                capture_output=True, text=True, timeout=30,
                env={**dict(__import__('os').environ), 'CLAUDE_SYSTEM_PROMPT': SYSTEM_PROMPT}
            )
            answer = result.stdout.strip()
            if result.returncode != 0:
                print(f"  claude CLI error (code {result.returncode}): {result.stderr.strip()}")
                # Try alternate invocation without --no-markdown
                result = subprocess.run(
                    ['claude', '-p', prompt],
                    capture_output=True, text=True, timeout=30
                )
                answer = result.stdout.strip()

            if not answer:
                self.send_json(200, {'answer': None, 'error': 'empty response'})
            else:
                print(f"  Q: {question[:60]}... -> A: {answer[:60]}...")
                self.send_json(200, {'answer': answer})

        except FileNotFoundError:
            print("ERROR: 'claude' CLI not found. Install it first.")
            self.send_json(500, {'error': 'claude CLI not installed'})
        except subprocess.TimeoutExpired:
            print(f"  Timeout on question: {question[:60]}...")
            self.send_json(504, {'error': 'timeout'})
        except Exception as e:
            print(f"  Error: {e}")
            self.send_json(500, {'error': str(e)})

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[JobHunter] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description='JobHunter Claude CLI companion server')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help=f'Port to listen on (default: {DEFAULT_PORT})')
    args = parser.parse_args()

    # Verify claude CLI is available
    try:
        result = subprocess.run(['claude', '--version'], capture_output=True, text=True, timeout=5)
        print(f"Claude CLI: {result.stdout.strip()}")
    except FileNotFoundError:
        print("WARNING: 'claude' CLI not found in PATH.")
        print("Install it from: https://docs.anthropic.com/en/docs/claude-code")
        print("Server will start but requests will fail until claude is installed.\n")
    except Exception as e:
        print(f"WARNING: Could not check claude CLI: {e}\n")

    server = HTTPServer(('127.0.0.1', args.port), ClaudeHandler)
    print(f"\nJobHunter Claude CLI Server")
    print(f"Listening on http://localhost:{args.port}")
    print(f"Health check: http://localhost:{args.port}/health")
    print(f"Press Ctrl+C to stop\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()


if __name__ == '__main__':
    main()
