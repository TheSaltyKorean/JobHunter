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
import shutil
import json
import sys
import os
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler

DEFAULT_PORT = 3847

# Resolve the claude CLI executable — checks common Windows + Mac/Linux paths
def find_claude_cli(override_path=None):
    if override_path and os.path.isfile(override_path):
        return override_path

    # 1. Check if it's on PATH
    found = shutil.which('claude')
    if found:
        return found

    # 2. Common Windows locations (npm global installs)
    if sys.platform == 'win32':
        candidates = [
            os.path.expandvars(r'%APPDATA%\npm\claude.cmd'),
            os.path.expandvars(r'%APPDATA%\npm\claude'),
            os.path.expandvars(r'%LOCALAPPDATA%\Programs\claude\claude.exe'),
            os.path.expandvars(r'%USERPROFILE%\.claude\local\claude.exe'),
            # npx fallback — npm should be on PATH
            shutil.which('npx'),
        ]
    else:
        candidates = [
            os.path.expanduser('~/.npm-global/bin/claude'),
            os.path.expanduser('~/.local/bin/claude'),
            '/usr/local/bin/claude',
        ]

    for c in candidates:
        if c and os.path.isfile(c):
            return c

    return None

CLAUDE_PATH = None  # Set in main()

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

        if not CLAUDE_PATH:
            print("ERROR: claude CLI not found. Use --claude-path or install it.")
            self.send_json(500, {'error': 'claude CLI not installed'})
            return

        # Build command — if the path ends in npx, use "npx claude"
        if CLAUDE_PATH.endswith('npx') or CLAUDE_PATH.endswith('npx.cmd'):
            cmd = [CLAUDE_PATH, 'claude', '-p', '--no-markdown', prompt]
        else:
            cmd = [CLAUDE_PATH, '-p', '--no-markdown', prompt]

        try:
            env = {**os.environ, 'CLAUDE_SYSTEM_PROMPT': SYSTEM_PROMPT}
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30, env=env
            )
            answer = result.stdout.strip()
            if result.returncode != 0:
                print(f"  claude CLI error (code {result.returncode}): {result.stderr.strip()}")
                # Try alternate invocation without --no-markdown
                cmd_alt = cmd[:-2] + [cmd[-1]]  # remove --no-markdown
                result = subprocess.run(
                    cmd_alt, capture_output=True, text=True, timeout=30
                )
                answer = result.stdout.strip()

            if not answer:
                self.send_json(200, {'answer': None, 'error': 'empty response'})
            else:
                print(f"  Q: {question[:60]}... -> A: {answer[:60]}...")
                self.send_json(200, {'answer': answer})

        except FileNotFoundError:
            print(f"ERROR: Could not execute '{CLAUDE_PATH}'. Check the path.")
            self.send_json(500, {'error': 'claude CLI not found at configured path'})
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
    global CLAUDE_PATH

    parser = argparse.ArgumentParser(description='JobHunter Claude CLI companion server')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help=f'Port to listen on (default: {DEFAULT_PORT})')
    parser.add_argument('--claude-path', type=str, default=None,
                        help='Full path to claude CLI executable (auto-detected if omitted)')
    args = parser.parse_args()

    # Find claude CLI
    CLAUDE_PATH = find_claude_cli(args.claude_path)

    if CLAUDE_PATH:
        print(f"Claude CLI found: {CLAUDE_PATH}")
        try:
            if CLAUDE_PATH.endswith('npx') or CLAUDE_PATH.endswith('npx.cmd'):
                result = subprocess.run([CLAUDE_PATH, 'claude', '--version'],
                                        capture_output=True, text=True, timeout=10)
            else:
                result = subprocess.run([CLAUDE_PATH, '--version'],
                                        capture_output=True, text=True, timeout=10)
            ver = result.stdout.strip() or result.stderr.strip()
            if ver:
                print(f"Version: {ver}")
        except Exception as e:
            print(f"Could not check version: {e}")
    else:
        print("WARNING: 'claude' CLI not found!")
        print("Install it:  npm install -g @anthropic-ai/claude-code")
        print("Or specify:  python claude_server.py --claude-path C:\\path\\to\\claude.exe")
        print("Server will start but requests will fail until claude is available.\n")

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
