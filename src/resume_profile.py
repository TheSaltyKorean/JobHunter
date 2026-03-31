"""
User profile data loaded from config/profile.yaml.
Falls back to empty defaults if the config file doesn't exist yet.

To set up: copy config/profile.template.yaml to config/profile.yaml
and fill in your details.
"""

import os
import logging

logger = logging.getLogger(__name__)

_APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROFILE_PATH = os.path.join(_APP_ROOT, 'config', 'profile.yaml')
_PROFILE_LOADED = False


def _load_profile() -> dict:
    """Load profile from YAML config file."""
    global _PROFILE_LOADED
    try:
        import yaml
    except ImportError:
        logger.warning("PyYAML not installed. Run: pip install pyyaml")
        return {}

    if not os.path.exists(_PROFILE_PATH):
        if not _PROFILE_LOADED:
            logger.warning(
                f"Profile not found at {_PROFILE_PATH}. "
                "Copy config/profile.template.yaml to config/profile.yaml and fill in your details."
            )
            _PROFILE_LOADED = True
        return {}

    with open(_PROFILE_PATH, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f) or {}

    _PROFILE_LOADED = True
    return data


def _get(section: str, default=None):
    """Get a section from the profile."""
    profile = _load_profile()
    return profile.get(section, default if default is not None else {})


# ─────────────────────────────────────────────────────────
# PUBLIC API  (same interface as before — drop-in replacement)
# ─────────────────────────────────────────────────────────

def _build_contact():
    c = _get('contact', {})
    return {
        "first_name": c.get("first_name", ""),
        "last_name": c.get("last_name", ""),
        "full_name": f"{c.get('first_name', '')} {c.get('last_name', '')}".strip(),
        "email_primary": c.get("email_primary", ""),
        "email_screening": c.get("email_screening", c.get("email_primary", "")),
        "phone_primary": c.get("phone_primary", ""),
        "phone_screening": c.get("phone_screening", c.get("phone_primary", "")),
        "city": c.get("city", ""),
        "state": c.get("state", ""),
        "state_full": c.get("state_full", ""),
        "zip": c.get("zip", ""),
        "location": f"{c.get('city', '')}, {c.get('state', '')} {c.get('zip', '')}".strip(', '),
        "linkedin": c.get("linkedin", ""),
        "github": c.get("github", ""),
        "website": c.get("website", ""),
        "authorized_to_work": c.get("authorized_to_work", True),
        "requires_sponsorship": c.get("requires_sponsorship", False),
        "willing_to_relocate": c.get("willing_to_relocate", False),
        "preferred_work_type": c.get("preferred_work_type", ""),
    }


# These are module-level properties that reload from config on access
# For backward compatibility, we use a lazy-loading approach
class _ProfileProxy:
    """Lazy-loading proxy so profile.yaml changes are picked up without restart."""

    @property
    def CONTACT(self):
        return _build_contact()

    @property
    def RESUMES(self):
        resumes = _get('resumes', {})
        if not resumes:
            logger.warning(
                "No resumes configured in profile.yaml! "
                "Add a 'resumes' section with paths to your PDF files."
            )
            return resumes
        # Filter out entries whose files don't exist (template placeholders)
        valid = {}
        for key, path in resumes.items():
            full = os.path.join(_APP_ROOT, path)
            if os.path.exists(full):
                valid[key] = path
            else:
                logger.debug(f"Skipping resume '{key}': file not found at {full}")
        if not valid and resumes:
            logger.warning(
                "All resume paths in profile.yaml point to missing files. "
                "Upload resumes via Settings or fix the paths in profile.yaml."
            )
        return valid

    @property
    def EDUCATION(self):
        return _get('education', [])

    @property
    def CERTIFICATIONS(self):
        return _get('certifications', [])

    @property
    def SKILLS(self):
        return _get('skills', [])

    @property
    def WORK_HISTORY(self):
        return _get('work_history', [])

    @property
    def COMMON_ANSWERS(self):
        return _get('common_answers', {})

    @property
    def SUMMARIES(self):
        return _get('summaries', {})

    @property
    def AWARDS(self):
        return _get('awards', [])

    @property
    def ACTIVITIES(self):
        return _get('activities', [])

    @property
    def YEARS_OF_EXPERIENCE(self):
        cs = _get('career_summary', {})
        return cs.get('years_of_experience', 0)

    @property
    def MANAGEMENT_YEARS(self):
        cs = _get('career_summary', {})
        return cs.get('management_years', 0)

    @property
    def BUDGET_MANAGED(self):
        cs = _get('career_summary', {})
        return cs.get('budget_managed', '')

    @property
    def TEAM_SIZE_MAX(self):
        cs = _get('career_summary', {})
        return cs.get('team_size_max', 0)


_proxy = _ProfileProxy()

# Module-level names for backward compatibility
# These are accessed as: from src.resume_profile import CONTACT, SKILLS, etc.
def __getattr__(name):
    """Module-level __getattr__ for lazy loading profile data."""
    if hasattr(_proxy, name):
        return getattr(_proxy, name)
    raise AttributeError(f"module 'resume_profile' has no attribute {name}")
