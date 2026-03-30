"""
Analyzes job descriptions to:
  1. Classify role as management vs. individual contributor
  2. Detect Indian IT staffing firms
  3. Calculate skill match score
  4. Select the appropriate resume
"""

import re
from .resume_profile import SKILLS

# ─────────────────────────────────────────────────────────
# MANAGEMENT TITLE KEYWORDS  (include)
# ─────────────────────────────────────────────────────────
MANAGEMENT_TITLES = [
    r'\bvice president\b', r'\bvp\b', r'\bvp,?\s', r'\bsvp\b', r'\bevp\b',
    r'\bdirector\b', r'\bsenior director\b', r'\bexecutive director\b',
    r'\bmanager\b', r'\bsenior manager\b', r'\bprincipal manager\b',
    r'\bhead of\b', r'\bhead,\s', r'\bchief\b', r'\"cio\b', r'\bcto\b',
    r'\bpresident\b', r'\bgm\b', r'\"general manager\b',
    r'\bplatform lead\b', r'\binfrastructure lead\b', r'\bcloud lead\b',
    r'\bteam lead\b', r'\btechnology lead\b', r'\bgroup manager\b',
    r'\bpractice manager\b', r'\bpractice lead\b',
    r'\boperations manager\b', r'\bit manager\b', r'\bcloud manager\b',
    r'\bengineering manager\b', r'\bdelivery manager\b',
]

# ─────────────────────────────────────────────────────────
# IC TITLE KEYWORDS  (exclude)
# ─────────────────────────────────────────────────────────
IC_TITLES = [
    r'\bengineer\b', r'\bdeveloper\b', r'\bprogrammer\b',
    r'\banalyst\b', r'\bspecialist\b', r'\bcoordinator\b',
    r'\bconsultant\b', r'\bimplementer\b', r'\btechnician\b',
    r'\"administrator\b', r'\boperator\b', r'\"architect\b',
    r'\bdevops engineer\b', r'\bcloud engineer\b', r'\bsre\b',
    r'\bsoftware engineer\b', r'\bstaff engineer\b',
    r'\bprincipal engineer\b', r'\bsenior engineer\b',
    r'\bdata scientist\b', r'\"data engineer\b', r'\bml engineer\b',
]

# ─────────────────────────────────────────────────────────
# IRRELEVANT TITLE KEYWORDS  (auto-skip entirely)
# These roles are completely outside Randy's background.
# ─────────────────────────────────────────────────────────
EXCLUDE_TITLES = [
    # Engineering disciplines that aren't IT/software
    r'\belectrical engineer', r'\bmechanical engineer', r'\bcivil engineer',
    r'\bchemical engineer', r'\bstructural engineer', r'\bindustrial engineer',
    r'\bmanufacturing engineer', r'\bhardware engineer', r'\brf engineer',
    r'\bfirmware engineer', r'\bembedded engineer', r'\bprocess engineer',
    # Completely different career tracks
    r'\bproduct manager\b', r'\bproduct owner\b', r'\bproduct director\b',
    r'\bscrum master\b', r'\bagile coach\b',
    r'\bsales\b', r'\baccount executive\b', r'\baccount manager\b',
    r'\bbusiness development\b', r'\bbdr\b', r'\bsdr\b',
    r'\bmarketing\b', r'\bsocial media\b', r'\bcontent strateg',
    r'\brecruit\b', r'\bhr\b', r'\bhuman resource', r'\btalent acqui',
    r'\bnurs\b', r'\bpharmac', r'\bclinical\b', r'\bphysician\b',
    r'\bmedical director\b', r'\bdental\b',
    r'\baccountant\b', r'\baudit\b', r'\btax\b', r'\bcontroller\b',
    r'\bfinancial analyst\b', r'\bcfo\b', r'\btreasur',
    r'\blegal\b', r'\battorney\b', r'\bparalegal\b', r'\bcounsel\b',
    r'\bsupply chain\b', r'\blogistics\b', r'\bwarehouse\b',
    r'\bcustomer service\b', r'\bcustomer support\b', r'\bcall center\b',
    r'\bteacher\b', r'\bprofessor\b', r'\binstructor\b', r'\bprincipal\b(?!\s*engineer)',
    r'\breal estate\b', r'\bproperty manage', r'\bconstruction manage',
    r'\bdesign\b(?!.*\b(?:system|software|cloud|infra))', r'\bgraphic design',
    r'\bux\b', r'\bui/ux\b', r'\bux/ui\b',
    # Low-level IT roles (not management)
    r'\bhelp desk\b', r'\bdesktop support\b', r'\bservice desk\b',
    r'\bintern\b', r'\bentry level\b', r'\bjunior\b',
]

# But these IC-sounding words are OK in management context
MANAGEMENT_OVERRIDE = [
    r'manage.*engineer', r'lead.*team', r'director.*engineer',
    r'vp.*engineer', r'head.*engineer',
]

# ─────────────────────────────────────────────────────────
# INDIAN IT STAFFING FIRM DETECTION
# ─────────────────────────────────────────────────────────
INDIAN_FIRM_NAMES = [
    # Major Indian IT firms
    'infosys', 'wipro', 'tata consultancy', 'tcs', 'hcl tech', 'hcltech',
    'tech mahindra', 'mphasis', 'hexaware', 'birlasoft', 'mindtree',
    'l&t infotech', 'ltimindtree', 'lti ', 'mastech', 'igate', 'patni',
    'niit tech', 'cyient', 'sasken', 'infostretch', 'coforge',
    'persistent systems', 'zensar', 'sonata software', 'kellton',
    'datamatics', 'tanla', 'subex', 'rsa security india',
    # Indian staffing / body shop firms
    'kforce india', 'staffing india', 'tek systems india',
    'syntel', 'ilink', 'isynergy', 'vdart', 'diverse lynx',
    'diaspark', 'dexian', 'siri infosolution', 'delphi',
    'ansr source', 'softpath system', 'tanisha systems',
    'apexon', 'jade global', 'vlink', 'spar group india',
    # Common "body shop" patterns
    'global it', 'us it staffing', 'corp to corp',
]

INDIAN_FIRM_PATTERNS = [
    r'c2c\b', r'corp.to.corp', r'corp2corp',
    r'h1b\s*(transfer|sponsorship)', r'h-1b\s*(transfer|sponsorship)',
    r'w2\s*(or|/)\s*c2c', r'w2\s*(or|/)\s*1099',
    r'only\s*(usc|us\s*citizen)\s*(or|and)\s*gc',
    r'immediate\s*joiners?\s*(only|preferred)',
    r'rate\s*\$\d+.*c2c',
]


def is_indian_firm(company: str, description: str = '') -> tuple[bool, str]:
    """Returns (is_indian, reason)."""
    text = (company + ' ' + description).lower()

    for firm in INDIAN_FIRM_NAMES:
        if firm in text:
            return True, f"Matches known Indian IT firm: {firm}"

    for pattern in INDIAN_FIRM_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True, f"Contains staffing pattern: {pattern}"

    return False, ""


def is_excluded_title(title: str) -> tuple[bool, str]:
    """Check if a job title is completely irrelevant to Randy's background.
    Returns (is_excluded, reason)."""
    title_lower = title.lower()
    for pat in EXCLUDE_TITLES:
        if re.search(pat, title_lower, re.IGNORECASE):
            return True, f"Excluded title pattern: {pat}"
    return False, ""


def classify_role(title: str, description: str = '') -> str:
    """Returns 'management', 'ic', 'excluded', or 'unknown'."""
    # Check for completely irrelevant roles first
    excluded, _ = is_excluded_title(title)
    if excluded:
        return 'excluded'

    text = (title + ' ' + description[:500]).lower()

    # Check for explicit management overrides first
    for pat in MANAGEMENT_OVERRIDE:
        if re.search(pat, text, re.IGNORECASE):
            return 'management'

    # Check management title patterns
    for pat in MANAGEMENT_TITLES:
        if re.search(pat, text, re.IGNORECASE):
            # Make sure it's not a pure IC title too
            is_ic = any(re.search(p, title.lower()) for p in IC_TITLES)
            if not is_ic:
                return 'management'

    # Check IC title patterns
    for pat in IC_TITLES:
        if re.search(pat, title.lower(), re.IGNORECASE):
            return 'ic'

    return 'unknown'


def calculate_match(description: str) -> tuple[float, list]:
    """
    Returns (score_0_to_100, list_of_matched_skills).
    Uses Randy's skill list against job description.
    """
    desc_lower = description.lower()
    matched = []
    total = 0

    for skill in SKILLS:
        # Create a flexible pattern (handles plurals, hyphens, etc.)
        pattern = re.escape(skill.lower()).replace(r'\ ', r'[\s\-]?')
        if re.search(r'\b' + pattern + r'\b', desc_lower):
            matched.append(skill)

    # Deduplicate (Azure/Microsoft Azure count once)
    seen = set()
    unique_matched = []
    for s in matched:
        key = s.lower().replace('microsoft ', '').replace('azure ', '')
        if key not in seen:
            seen.add(key)
            unique_matched.append(s)

    # Calculate score based on matched vs expected relevant skills
    # We weight management/cloud/Azure skills higher
    HIGH_VALUE = ['Azure', 'Cloud Architecture', 'DevOps', 'IT Strategy',
                  'IT Operations', 'IT Governance', 'HIPAA', 'FinOps',
                  'Terraform', 'Leadership', 'Budget Management']

    base_skills_in_jd = max(count_skills_in_jd(desc_lower), 1)

    high_value_matched = sum(1 for s in unique_matched if s in HIGH_VALUE)
    regular_matched = len(unique_matched) - high_value_matched

    weighted_score = (high_value_matched * 2 + regular_matched) / max(base_skills_in_jd, 5)
    score = min(100, weighted_score * 50)

    # Ensure at least a base score if we matched several skills
    if len(unique_matched) >= 3:
        score = max(score, len(unique_matched) * 3)

    score = min(100, score)
    return round(score, 1), unique_matched


def count_skills_in_jd(desc_lower: str) -> int:
    """Rough count of how many skills a JD requires."""
    tech_keywords = [
        'experience', 'proficiency', 'knowledge', 'familiar', 'expertise',
        'strong', 'required', 'preferred', 'must have', 'nice to have',
        'bachelor', 'master', 'certification', 'years of'
    ]
    return sum(1 for k in tech_keywords if k in desc_lower)


def select_resume(title: str, company: str, description: str = '') -> str:
    """
    Returns the resume type key to use for this job.
    Logic:
      - Indian firm  → contract
      - VP/CxO/Director+  → executive
      - Cloud/Azure/Infra → cloud
      - Everything else   → it_manager
    """
    indian, _ = is_indian_firm(company, description)
    if indian:
        return 'contract'

    title_lower = title.lower()

    # VP / Executive level
    exec_patterns = [
        r'\bvp\b', r'\bvice president\b', r'\"cio\b', r'\bcto\b',
        r'\bchief\b', r'\bsvp\b', r'\bevp\b', r'\bexecutive director\b',
    ]
    for p in exec_patterns:
        if re.search(p, title_lower):
            return 'executive'

    # Cloud / Infrastructure
    cloud_patterns = [
        r'\bcloud\b', r'\bazure\b', r'\binfrastructure\b', r'\bdevops\b',
        r'\bplatform\b', r'\bsite reliability\b', r'\bsre\b',
        r'\bnetwork\b', r'\bsecurity\b', r'\barchitect\b',
    ]
    for p in cloud_patterns:
        if re.search(p, title_lower):
            return 'cloud'

    return 'it_manager'


def analyze_job(title: str, company: str, description: str,
                location: str = '', salary: str = '') -> dict:
    """
    Full analysis of a job posting.
    Returns enriched dict with classification results.
    """
    role_type = classify_role(title, description)
    score, matched_skills = calculate_match(description)
    indian, indian_reason = is_indian_firm(company, description)
    resume_type = select_resume(title, company, description)

    return {
        'role_type':      role_type,
        'match_score':    score,
        'matched_skills': matched_skills,
        'is_indian_firm': indian,
        'flagged_reason': indian_reason,
        'resume_type':    resume_type,
        'meets_threshold': score >= 50 and role_type in ('management', 'unknown') and role_type != 'excluded',
    }


def should_apply(analysis: dict, min_score: float = 50.0) -> tuple[bool, str]:
    """
    Returns (should_apply, reason).
    Respects Randy's rules: management roles only, 50%+ match.
    """
    if analysis['role_type'] == 'excluded':
        return False, "Irrelevant role – not in IT/cloud/infrastructure"
    if analysis['role_type'] == 'ic':
        return False, "Individual contributor role – skipping"
    if analysis['match_score'] < min_score:
        return False, f"Match score {analysis['match_score']:.0f}% below threshold {min_score:.0f}%"
    return True, f"Match score {analysis['match_score']:.0f}% – {len(analysis['matched_skills'])} skills matched"
