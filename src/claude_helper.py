"""
Claude Q&A Helper.

Priority order:
  1. `claude` CLI (Claude Code) – fully automated, uses Claude subscription
  2. Anthropic API key (if set in settings)
  3. Clipboard + open Claude.ai (semi-automated, Randy pastes the answer)

Detects which method is available at runtime.
"""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

from .resume_profile import (CONTACT, WORK_HISTORY, SKILLS, EDUCATION,
                              CERTIFICATIONS, AWARDS, SUMMARIES, COMMON_ANSWERS)

logger = logging.getLogger(__name__)

# Will be populated by settings loader at startup
_settings = {}


def load_settings(settings: dict):
    global _settings
    _settings = settings


# ─────────────────────────────────────────────────────────
# Build the context prompt  (used by all methods)
# ─────────────────────────────────────────────────────────

def build_context(resume_type: str = 'it_manager') -> str:
    """Build a rich context string from Randy's profile for Claude to use."""
    contact = CONTACT
    summary = SUMMARIES.get(resume_type, SUMMARIES['it_manager'])

    work_str = '\n'.join(
        f"- {w['title']} at {w['company']} ({w['start']} – {w['end']}): {w['summary']}"
        for w in WORK_HISTORY
    )
    skills_str = ', '.join(SKILLS[:40])
    edu_str = ', '.join(
        f"{e['degree']} – {e['school']} ({e['start_year']}-{e['end_year']})"
        for e in EDUCATION
    )
    certs_str = ', '.join(c['name'] for c in CERTIFICATIONS)
    awards_str = '\n'.join(f"- {a}" for a in AWARDS)

    return f"""You are helping Randy Walker fill out a job application. Answer the question below AS Randy, in first person, using his real background. Keep answers concise (1-3 sentences unless asked for more). Do NOT add caveats or explain that you are an AI.

=== RANDY'S PROFILE ===
Name: {contact['full_name']}
Location: {contact['location']}
Summary: {summary}

Work History:
{work_str}

Skills: {skills_str}

Education: {edu_str}
Certifications: {certs_str}

Awards: {awards_str}

Key Facts:
- 20 years of experience in IT and cloud infrastructure
- 10+ years in management roles
- Largest team: ~25-30 engineers and architects
- Largest budget managed: $12MM annually (Performance Food Group, Fortune 80)
- Deep expertise in Microsoft Azure, DevOps, and IT governance
- Industries: Healthcare, Finance, CPG, Food Distribution, Public Sector
- Authorized to work in the US, no sponsorship needed
- Located in Austin, TX — prefers remote or hybrid
- Salary expectation: $180,000+

=== QUESTION ===
"""


# ─────────────────────────────────────────────────────────
# Method 1: Claude Code CLI
# ─────────────────────────────────────────────────────────

def _claude_cli_available() -> bool:
    """Check if `claude` CLI is available on PATH."""
    return shutil.which('claude') is not None


def _ask_via_cli(question: str, context: str) -> str:
    """Call the claude CLI and return its response."""
    prompt = context + question
    try:
        result = subprocess.run(
            ['claude', '--print', prompt],
            capture_output=True,
            text=True,
            timeout=60,
            encoding='utf-8'
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        else:
            logger.warning(f"Claude CLI error: {result.stderr}")
    except subprocess.TimeoutExpired:
        logger.warning("Claude CLI timed out")
    except Exception as e:
        logger.warning(f"Claude CLI failed: {e}")
    return ''


# ─────────────────────────────────────────────────────────
# Method 2: Anthropic API
# ─────────────────────────────────────────────────────────

def _ask_via_api(question: str, context: str, api_key: str) -> str:
    """Call Anthropic API directly."""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=512,
            messages=[{
                'role': 'user',
                'content': context + question
            }]
        )
        return message.content[0].text.strip()
    except ImportError:
        logger.warning("anthropic package not installed. pip install anthropic")
    except Exception as e:
        logger.warning(f"Anthropic API error: {e}")
    return ''


# ─────────────────────────────────────────────────────────
# Method 3: Clipboard + Claude.ai (semi-automated)
# ─────────────────────────────────────────────────────────

_pending_answers: dict = {}   # question_hash → answer (populated when user pastes back)


def _copy_to_clipboard(text: str):
    """Copy text to Windows clipboard."""
    try:
        if sys.platform == 'win32':
            subprocess.run(['clip'], input=text.encode('utf-16'), check=True)
        elif sys.platform == 'darwin':
            subprocess.run(['pbcopy'], input=text.encode(), check=True)
        else:
            subprocess.run(['xclip', '-selection', 'clipboard'],
                           input=text.encode(), check=True)
    except Exception as e:
        logger.debug(f"Clipboard copy failed: {e}")


def _ask_via_clipboard(question: str, context: str) -> str:
    """
    Semi-automated mode:
    1. Copy the full prompt to clipboard
    2. Open Claude.ai in browser
    3. Show notification to paste, get answer, and return to app
    4. Wait for user to provide the answer via the web UI
    """
    prompt = context + question

    # Copy to clipboard
    _copy_to_clipboard(prompt)

    # Open Claude.ai
    webbrowser.open('https://claude.ai/new')

    # Signal the web UI that we need input
    import hashlib
    q_hash = hashlib.md5(question.encode()).hexdigest()[:8]

    # Store pending question in a temp file the web UI can read
    pending_path = Path(__file__).parent.parent / 'data' / 'pending_question.json'
    pending_path.parent.mkdir(exist_ok=True)
    with open(str(pending_path), 'w') as f:
        json.dump({'hash': q_hash, 'question': question, 'prompt_copied': True}, f)

    logger.info(f"[CLIPBOARD] Prompt copied. Open Claude.ai, paste (Ctrl+V), copy answer, return to app.")

    # Wait up to 3 minutes for answer to be submitted via web UI
    answer_path = Path(__file__).parent.parent / 'data' / f'answer_{q_hash}.txt'
    for _ in range(180):  # 3 minute timeout
        time.sleep(1)
        if answer_path.exists():
            answer = answer_path.read_text(encoding='utf-8').strip()
            answer_path.unlink(missing_ok=True)
            pending_path.unlink(missing_ok=True)
            return answer

    logger.warning("Timed out waiting for clipboard answer")
    pending_path.unlink(missing_ok=True)
    return ''


# ─────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────

async def get_answer(question: str, job_context: str = '',
                     resume_type: str = 'it_manager') -> str:
    """
    Get an answer for a job application question.
    Tries methods in order: CLI → API → clipboard.
    Falls back to common answers first.
    """
    if not question.strip():
        return ''

    # Build full context
    context = build_context(resume_type)
    if job_context:
        context += f"\n=== JOB CONTEXT ===\n{job_context}\n\n=== QUESTION ===\n"

    # Method 1: Claude CLI
    if _settings.get('use_claude_cli', True) and _claude_cli_available():
        answer = await asyncio.get_event_loop().run_in_executor(
            None, _ask_via_cli, question, context
        )
        if answer:
            logger.info(f"CLI answered: {question[:60]}...")
            return answer

    # Method 2: Anthropic API
    api_key = _settings.get('anthropic_api_key', '') or os.environ.get('ANTHROPIC_API_KEY', '')
    if api_key:
        answer = await asyncio.get_event_loop().run_in_executor(
            None, _ask_via_api, question, context, api_key
        )
        if answer:
            logger.info(f"API answered: {question[:60]}...")
            return answer

    # Method 3: Clipboard + Claude.ai
    answer = await asyncio.get_event_loop().run_in_executor(
        None, _ask_via_clipboard, question, context
    )
    if answer:
        return answer

    # Last resort: return empty and let the applicator handle it
    logger.warning(f"Could not get answer for: {question[:80]}")
    return ''


def check_claude_cli() -> dict:
    """Return status info about Claude CLI availability."""
    available = _claude_cli_available()
    if available:
        try:
            result = subprocess.run(['claude', '--version'], capture_output=True,
                                    text=True, timeout=5)
            version = result.stdout.strip()
        except:
            version = 'unknown'
    else:
        version = None

    return {
        'available': available,
        'version': version,
        'method': 'claude_cli' if available else (
            'api' if (_settings.get('anthropic_api_key') or os.environ.get('ANTHROPIC_API_KEY'))
            else 'clipboard'
        )
    }
