"""
ATS (Applicant Tracking System) Credential Manager.

Stores per-platform login credentials in config/ats_credentials.json.
Auto-generates secure passwords for new accounts when needed.
"""

import json
import logging
import os
import secrets
import string
from datetime import datetime

logger = logging.getLogger(__name__)

_APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CREDS_PATH = os.path.join(_APP_ROOT, 'config', 'ats_credentials.json')

# Known ATS platforms and how to detect them from URLs
ATS_PLATFORMS = {
    'workday': {
        'url_patterns': ['myworkdayjobs.com', 'workday.com', 'wd1.myworkdayjobs', 'wd3.myworkdayjobs', 'wd5.myworkdayjobs'],
        'name': 'Workday',
    },
    'successfactors': {
        'url_patterns': ['successfactors.com', 'successfactors.eu', 'sap.com/careers'],
        'name': 'SAP SuccessFactors',
    },
    'lever': {
        'url_patterns': ['lever.co', 'jobs.lever.co'],
        'name': 'Lever',
    },
    'greenhouse': {
        'url_patterns': ['greenhouse.io', 'boards.greenhouse.io'],
        'name': 'Greenhouse',
    },
    'icims': {
        'url_patterns': ['icims.com', 'jobs-*.icims.com'],
        'name': 'iCIMS',
    },
    'taleo': {
        'url_patterns': ['taleo.net', 'oracle.com/careers', 'oraclecloud.com'],
        'name': 'Oracle/Taleo',
    },
    'smartrecruiters': {
        'url_patterns': ['smartrecruiters.com', 'jobs.smartrecruiters.com'],
        'name': 'SmartRecruiters',
    },
    'jobvite': {
        'url_patterns': ['jobvite.com', 'jobs.jobvite.com'],
        'name': 'Jobvite',
    },
    'bamboohr': {
        'url_patterns': ['bamboohr.com'],
        'name': 'BambooHR',
    },
    'ashby': {
        'url_patterns': ['ashbyhq.com', 'jobs.ashby.com'],
        'name': 'Ashby',
    },
    'linkedin': {
        'url_patterns': ['linkedin.com'],
        'name': 'LinkedIn',
    },
    'indeed': {
        'url_patterns': ['indeed.com'],
        'name': 'Indeed',
    },
}


def _load_creds() -> dict:
    """Load credentials from JSON file."""
    if not os.path.exists(_CREDS_PATH):
        return {'platforms': {}, 'generated_accounts': []}
    with open(_CREDS_PATH, 'r') as f:
        return json.load(f)


def _save_creds(data: dict):
    """Save credentials to JSON file."""
    os.makedirs(os.path.dirname(_CREDS_PATH), exist_ok=True)
    with open(_CREDS_PATH, 'w') as f:
        json.dump(data, f, indent=2)


def generate_password(length: int = 20) -> str:
    """Generate a secure random password that meets most ATS requirements."""
    # Ensure at least one of each required character type
    upper = secrets.choice(string.ascii_uppercase)
    lower = secrets.choice(string.ascii_lowercase)
    digit = secrets.choice(string.digits)
    special = secrets.choice('!@#$%&*')

    # Fill the rest with a mix
    remaining = length - 4
    pool = string.ascii_letters + string.digits + '!@#$%&*'
    rest = ''.join(secrets.choice(pool) for _ in range(remaining))

    # Shuffle so the required chars aren't always at the start
    password = list(upper + lower + digit + special + rest)
    secrets.SystemRandom().shuffle(password)
    return ''.join(password)


def detect_platform(url: str) -> str:
    """Detect which ATS platform a URL belongs to. Returns platform key or 'unknown'."""
    url_lower = url.lower()
    for platform_key, info in ATS_PLATFORMS.items():
        for pattern in info['url_patterns']:
            if pattern in url_lower:
                return platform_key
    return 'unknown'


def detect_company_platform_key(url: str) -> str:
    """
    For ATS platforms that use per-company instances (Workday, SuccessFactors, etc.),
    return a company-specific key like 'workday_microsoft' or 'successfactors_sap'.
    Falls back to the generic platform key if no company subdomain is detected.
    """
    from urllib.parse import urlparse
    platform = detect_platform(url)
    if platform in ('workday', 'successfactors', 'taleo', 'icims'):
        parsed = urlparse(url)
        hostname = parsed.hostname or ''
        # Extract company name from subdomain
        # e.g., 'microsoft.wd1.myworkdayjobs.com' → 'microsoft'
        # e.g., 'jobs-careers-microsoft.icims.com' → 'microsoft'
        parts = hostname.split('.')
        if len(parts) > 2:
            company = parts[0].replace('jobs-', '').replace('careers-', '').replace('career-', '')
            if company and company not in ('www', 'jobs', 'career', 'careers', 'apply'):
                return f"{platform}_{company}"
    return platform


def get_credentials(platform: str) -> dict:
    """
    Get stored credentials for a platform.
    Returns {'email': '...', 'password': '...'} or empty dict if none stored.
    """
    creds = _load_creds()
    return creds.get('platforms', {}).get(platform, {})


def get_or_create_credentials(platform: str, email: str) -> dict:
    """
    Get existing credentials for a platform, or create new ones with
    a generated password. Returns {'email': '...', 'password': '...'}.
    """
    creds = _load_creds()
    platforms = creds.get('platforms', {})

    if platform in platforms and platforms[platform].get('password'):
        return platforms[platform]

    # Auto-generate a new password
    password = generate_password()
    entry = {
        'email': email,
        'password': password,
        'created': datetime.now().isoformat(),
        'platform_name': ATS_PLATFORMS.get(platform, {}).get('name', platform),
    }

    platforms[platform] = entry
    creds['platforms'] = platforms

    # Also log to generated_accounts for easy reference
    generated = creds.get('generated_accounts', [])
    generated.append({
        'platform': platform,
        'platform_name': entry['platform_name'],
        'email': email,
        'password': password,
        'created': entry['created'],
    })
    creds['generated_accounts'] = generated

    _save_creds(creds)
    logger.info(f"Generated new credentials for {platform} ({entry['platform_name']})")
    return entry


def set_credentials(platform: str, email: str, password: str):
    """Manually set credentials for a platform."""
    creds = _load_creds()
    platforms = creds.get('platforms', {})
    platforms[platform] = {
        'email': email,
        'password': password,
        'platform_name': ATS_PLATFORMS.get(platform, {}).get('name', platform),
        'updated': datetime.now().isoformat(),
    }
    creds['platforms'] = platforms
    _save_creds(creds)


def get_all_platforms() -> dict:
    """Get all stored platform credentials (passwords masked for display)."""
    creds = _load_creds()
    result = {}
    for platform, info in creds.get('platforms', {}).items():
        result[platform] = {
            'email': info.get('email', ''),
            'password_set': bool(info.get('password')),
            'platform_name': info.get('platform_name', platform),
            'created': info.get('created', ''),
        }
    return result


def get_generated_accounts() -> list:
    """Get list of all auto-generated accounts (includes passwords for user reference)."""
    creds = _load_creds()
    return creds.get('generated_accounts', [])
