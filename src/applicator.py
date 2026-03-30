"""
Application automation for LinkedIn Easy Apply, Workday, Indeed, and external ATS platforms.
Handles form filling, resume upload, Q&A answering, and ATS login/account creation.
"""

import asyncio
import logging
import os
import re
import time
import random
from pathlib import Path
from urllib.parse import urlparse

from .resume_profile import CONTACT, RESUMES, EDUCATION, WORK_HISTORY, COMMON_ANSWERS, CERTIFICATIONS
from .claude_helper import get_answer
from . import ats_credentials

logger = logging.getLogger(__name__)

APP_ROOT = Path(__file__).parent.parent


def _resume_path(resume_type: str) -> str:
    rel = RESUMES.get(resume_type, RESUMES['it_manager'])
    full = APP_ROOT / rel
    if not full.exists():
        raise FileNotFoundError(f"Resume not found: {full}")
    return str(full)


def _contact_for_resume(resume_type: str) -> dict:
    """Return correct contact details based on resume type (screening vs primary)."""
    if resume_type == 'contract':
        return {**CONTACT,
                'email': CONTACT['email_screening'],
                'phone': CONTACT['phone_screening']}
    return {**CONTACT,
            'email': CONTACT['email_primary'],
            'phone': CONTACT['phone_primary']}


def _random_delay(min_s=0.8, max_s=2.5):
    time.sleep(random.uniform(min_s, max_s))


async def _async_delay(min_s=1.0, max_s=3.0):
    await asyncio.sleep(random.uniform(min_s, max_s))


# ─────────────────────────────────────────────────────────
# ATS LOGIN / ACCOUNT CREATION
# ─────────────────────────────────────────────────────────

async def _detect_login_wall(page) -> bool:
    """Check if the current page is a login/signup wall."""
    url_lower = page.url.lower()
    if any(kw in url_lower for kw in ['signin', 'sign-in', 'login', 'log-in', '/auth', 'createaccount', 'register']):
        return True
    # Check for login form elements
    login_indicators = await page.query_selector_all(
        'input[type="password"], '
        'form[action*="login"], form[action*="signin"], '
        'button:has-text("Sign In"), button:has-text("Log In"), '
        'a:has-text("Create Account"), a:has-text("Sign Up")'
    )
    return len(login_indicators) >= 2


async def _ats_login(page, platform: str, contact: dict) -> bool:
    """
    Attempt to log into an ATS platform using stored credentials.
    Returns True if login succeeded, False if it couldn't log in.
    """
    creds = ats_credentials.get_credentials(platform)
    if not creds.get('email') or not creds.get('password'):
        # Auto-create credentials using the contact email
        email = contact.get('email', '')
        if not email:
            logger.warning(f"No email available for {platform} login")
            return False
        creds = ats_credentials.get_or_create_credentials(platform, email)
        logger.info(f"Auto-generated credentials for {platform}: {creds['email']}")

    email = creds['email']
    username = creds.get('username', '') or email  # Taleo uses username, not email
    password = creds['password']

    # Try to find and fill the login identifier field
    # Some platforms use email, others use username (e.g. Taleo)
    email_filled = False

    # First try username-specific fields (Taleo, etc.)
    username_selectors = [
        'input[name*="username" i]', 'input[name*="userid" i]', 'input[name*="user" i]',
        'input[id*="username" i]', 'input[id*="userid" i]',
        'input[autocomplete="username"]',
        'input[data-automation-id="userName"]',
        'input[aria-label*="username" i]', 'input[aria-label*="user id" i]',
        'input[placeholder*="username" i]', 'input[placeholder*="user id" i]',
    ]
    for sel in username_selectors:
        el = await page.query_selector(sel)
        if el:
            try:
                await el.triple_click()
                await el.fill(username)
                email_filled = True
                logger.debug(f"Filled username field with: {username}")
                break
            except:
                continue

    # Then try email-specific fields
    if not email_filled:
        email_selectors = [
            'input[type="email"]',
            'input[name*="email" i]',
            'input[id*="email" i]',
            'input[autocomplete="email"]',
            'input[data-automation-id="email"]',
            'input[aria-label*="email" i]',
            'input[placeholder*="email" i]',
        ]
        for sel in email_selectors:
            el = await page.query_selector(sel)
            if el:
                try:
                    await el.triple_click()
                    await el.fill(email)
                    email_filled = True
                    break
                except:
                    continue

    if not email_filled:
        logger.warning(f"Could not find email/username field on {platform} login page")
        return False

    # Try to find and fill password field
    pw_filled = False
    pw_selectors = [
        'input[type="password"]',
        'input[name*="password" i]', 'input[id*="password" i]',
        'input[data-automation-id="password"]',
        'input[autocomplete="current-password"]',
    ]
    for sel in pw_selectors:
        el = await page.query_selector(sel)
        if el:
            try:
                await el.triple_click()
                await el.fill(password)
                pw_filled = True
                break
            except:
                continue

    if not pw_filled:
        logger.warning(f"Could not find password field on {platform} login page")
        return False

    await _async_delay(0.5, 1.0)

    # Click the sign-in/login button
    login_btn_selectors = [
        'button[type="submit"]',
        'button:has-text("Sign In")', 'button:has-text("Log In")',
        'button:has-text("Login")', 'button:has-text("Submit")',
        'input[type="submit"]',
        'button[data-automation-id="signInButton"]',
        'button[data-automation-id="loginButton"]',
    ]
    for sel in login_btn_selectors:
        btn = await page.query_selector(sel)
        if btn:
            try:
                await btn.click()
                await _async_delay(3, 5)
                # Check if we're still on the login page
                if not await _detect_login_wall(page):
                    logger.info(f"Successfully logged into {platform}")
                    return True
                # May have failed — check for error messages
                error_el = await page.query_selector(
                    '.error-message, .alert-danger, [role="alert"], '
                    '.error, .form-error, .login-error'
                )
                if error_el:
                    error_text = await error_el.inner_text()
                    logger.warning(f"{platform} login error: {error_text}")
                break
            except:
                continue

    return False


async def _ats_create_account(page, platform: str, contact: dict) -> bool:
    """
    Try to create a new account on an ATS platform.
    Clicks 'Create Account' / 'Sign Up', fills form, submits.
    Returns True if account creation succeeded.
    """
    # Look for a create account link/button
    create_selectors = [
        'a:has-text("Create Account")', 'a:has-text("Sign Up")',
        'a:has-text("Register")', 'a:has-text("New User")',
        'button:has-text("Create Account")', 'button:has-text("Sign Up")',
        'a:has-text("Create an Account")', 'a:has-text("Create a new account")',
        'a[data-automation-id="createAccountLink"]',
        'a[href*="register"]', 'a[href*="signup"]', 'a[href*="createaccount"]',
    ]
    create_link = None
    for sel in create_selectors:
        create_link = await page.query_selector(sel)
        if create_link:
            break

    if not create_link:
        logger.info(f"No 'Create Account' link found on {platform}")
        return False

    await create_link.click()
    await _async_delay(2, 4)

    # Get or create credentials
    email = contact.get('email', '')
    creds = ats_credentials.get_or_create_credentials(platform, email)
    password = creds['password']

    # Fill the registration form
    # Email
    for sel in ['input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]',
                'input[data-automation-id="email"]', 'input[aria-label*="email" i]']:
        el = await page.query_selector(sel)
        if el:
            try:
                await el.fill(email)
                break
            except:
                continue

    # Password (often two fields: password + confirm)
    pw_fields = await page.query_selector_all('input[type="password"]')
    for pf in pw_fields:
        try:
            await pf.fill(password)
        except:
            continue

    # Name fields
    for sel in ['input[name*="firstName" i]', 'input[id*="firstName" i]',
                'input[data-automation-id="firstName"]', 'input[aria-label*="first name" i]']:
        el = await page.query_selector(sel)
        if el:
            try:
                await el.fill(contact.get('first_name', ''))
                break
            except:
                continue

    for sel in ['input[name*="lastName" i]', 'input[id*="lastName" i]',
                'input[data-automation-id="lastName"]', 'input[aria-label*="last name" i]']:
        el = await page.query_selector(sel)
        if el:
            try:
                await el.fill(contact.get('last_name', ''))
                break
            except:
                continue

    # Accept terms checkbox if present
    terms = await page.query_selector(
        'input[type="checkbox"][name*="terms" i], '
        'input[type="checkbox"][name*="agree" i], '
        'input[type="checkbox"][name*="consent" i], '
        'input[type="checkbox"][id*="terms" i]'
    )
    if terms:
        try:
            checked = await terms.is_checked()
            if not checked:
                await terms.click()
        except:
            pass

    await _async_delay(0.5, 1.0)

    # Submit
    submit_selectors = [
        'button[type="submit"]',
        'button:has-text("Create Account")', 'button:has-text("Sign Up")',
        'button:has-text("Register")', 'button:has-text("Submit")',
        'input[type="submit"]',
    ]
    for sel in submit_selectors:
        btn = await page.query_selector(sel)
        if btn:
            try:
                await btn.click()
                await _async_delay(3, 5)

                # Check for verification page or success
                page_text = (await page.inner_text('body'))[:2000].lower()
                if any(phrase in page_text for phrase in [
                    'verify your email', 'check your email', 'verification',
                    'account created', 'welcome', 'my information',
                ]):
                    logger.info(f"Account created on {platform} for {email}")
                    return True

                # Check if we got past the login wall
                if not await _detect_login_wall(page):
                    logger.info(f"Account created and logged into {platform}")
                    return True

                break
            except:
                continue

    logger.warning(f"Account creation may have failed on {platform}")
    return False


async def _handle_ats_auth(page, platform: str, contact: dict) -> bool:
    """
    Handle ATS authentication: try login first, then account creation.
    Returns True if authentication succeeded.
    """
    # First try logging in with existing credentials
    if await _ats_login(page, platform, contact):
        return True

    # If login failed, try creating a new account
    logger.info(f"Login failed for {platform}, attempting account creation")

    # Navigate back to the login page if needed
    if 'error' in page.url.lower() or 'invalid' in page.url.lower():
        await page.go_back()
        await _async_delay(1, 2)

    if await _ats_create_account(page, platform, contact):
        return True

    return False


# ─────────────────────────────────────────────────────────
# CROSS-SITE REDIRECT DETECTION
# ─────────────────────────────────────────────────────────

async def _detect_external_apply(page) -> str:
    """
    Check if the current page has an 'Apply on company site' button that
    redirects to an external ATS. Returns the destination URL or empty string.
    """
    external_selectors = [
        # LinkedIn external apply
        'a.jobs-apply-button[href*="http"]',
        'a[data-tracking-control-name*="applyUrl"]',
        'a:has-text("Apply on company website")',
        'a:has-text("Apply on company site")',
        'button:has-text("Apply on company")',
        # Indeed external apply
        'a:has-text("Apply on company site")',
        'a.indeed-apply-button-label[href*="http"]',
        # Generic
        'a:has-text("Apply externally")',
        'a:has-text("Apply at")',
    ]
    for sel in external_selectors:
        el = await page.query_selector(sel)
        if el:
            href = await el.get_attribute('href')
            if href and href.startswith('http'):
                return href
            # If it's a button, click it and see where it goes
            try:
                original_url = page.url
                await el.click()
                await _async_delay(2, 4)
                new_url = page.url
                if new_url != original_url:
                    return new_url
            except:
                continue
    return ''


# ─────────────────────────────────────────────────────────
# COMMON ANSWER LOOKUP
# ─────────────────────────────────────────────────────────

def _lookup_common_answer(question: str) -> str:
    """
    Check if a question matches a pre-built answer from COMMON_ANSWERS.
    Returns the answer string, or empty string if no match.
    """
    if not question:
        return ''

    q_lower = question.lower().strip()

    # Salary questions
    if any(w in q_lower for w in ['salary', 'compensation', 'pay expectation', 'desired pay']):
        if 'minimum' in q_lower or 'min' in q_lower:
            return COMMON_ANSWERS.get('salary_min', '')
        if 'maximum' in q_lower or 'max' in q_lower:
            return COMMON_ANSWERS.get('salary_max', '')
        if 'hourly' in q_lower or 'rate' in q_lower:
            return COMMON_ANSWERS.get('hourly_rate', '')
        return COMMON_ANSWERS.get('salary_expectation', '')

    # Work authorization
    if any(w in q_lower for w in ['authorized', 'authorization', 'legally', 'eligible to work']):
        return COMMON_ANSWERS.get('work_authorization', '')

    # Sponsorship
    if any(w in q_lower for w in ['sponsorship', 'visa', 'sponsor']):
        return COMMON_ANSWERS.get('sponsorship_required', '')

    # Relocation
    if 'relocat' in q_lower:
        return COMMON_ANSWERS.get('willing_to_relocate', '')

    # Start date / notice period
    if any(w in q_lower for w in ['start date', 'when can you start', 'available to start']):
        return COMMON_ANSWERS.get('start_date', '')
    if 'notice' in q_lower:
        return COMMON_ANSWERS.get('notice_period', '')

    # Years of experience
    if 'years' in q_lower and 'experience' in q_lower:
        return COMMON_ANSWERS.get('years_of_experience', '')

    # Management experience
    if 'management' in q_lower and 'experience' in q_lower:
        return COMMON_ANSWERS.get('management_experience', '')

    # Education
    if any(w in q_lower for w in ['education', 'degree', 'highest level']):
        return COMMON_ANSWERS.get('highest_education', '')

    # Remote / work preference
    if any(w in q_lower for w in ['remote', 'hybrid', 'on-site', 'work arrangement']):
        return COMMON_ANSWERS.get('remote_preference', '')

    # Veteran status
    if 'veteran' in q_lower:
        return COMMON_ANSWERS.get('veteran_status', '')

    # Disability
    if 'disab' in q_lower:
        return COMMON_ANSWERS.get('disability_status', '')

    # Gender
    if 'gender' in q_lower:
        return COMMON_ANSWERS.get('gender', '')

    # Ethnicity / race
    if any(w in q_lower for w in ['ethnicity', 'race', 'demographic']):
        return COMMON_ANSWERS.get('ethnicity', '')

    return ''


# ─────────────────────────────────────────────────────────
# SHARED FORM HELPERS
# ─────────────────────────────────────────────────────────

async def _safe_fill(page, selector: str, value: str, timeout=3000):
    """Fill a form field safely, handling various input types."""
    try:
        el = await page.wait_for_selector(selector, timeout=timeout)
        if el:
            tag = await el.get_attribute('type') or 'text'
            if tag in ('radio', 'checkbox'):
                await el.check()
            else:
                await el.triple_click()
                await el.fill(value)
            return True
    except:
        pass
    return False


async def _fill_by_label(page, label_text: str, value: str) -> bool:
    """Try to fill an input by finding its label."""
    try:
        # Try aria-label or placeholder
        selectors = [
            f'input[aria-label*="{label_text}" i]',
            f'input[placeholder*="{label_text}" i]',
            f'textarea[aria-label*="{label_text}" i]',
            f'label:has-text("{label_text}") + input',
            f'label:has-text("{label_text}") ~ input',
        ]
        for sel in selectors:
            el = await page.query_selector(sel)
            if el:
                await el.triple_click()
                await el.fill(value)
                return True
    except:
        pass
    return False


async def _answer_screening_question(page, question_text: str, job_context: str,
                                      resume_type: str, input_el=None) -> str:
    """Get Claude's answer for a screening question and fill it in."""
    answer = await get_answer(question_text, job_context, resume_type)
    if input_el and answer:
        try:
            tag = await input_el.evaluate('el => el.tagName.toLowerCase()')
            if tag == 'textarea' or tag == 'input':
                await input_el.triple_click()
                await input_el.fill(answer)
            elif tag == 'select':
                await input_el.select_option(label=answer)
        except Exception as e:
            logger.debug(f"Could not fill answer: {e}")
    return answer


async def _fill_generic_application_form(page, contact: dict, resume_file: str,
                                          job_context: str, resume_type: str, result: dict):
    """
    Generic form filler that works across most ATS platforms.
    Handles personal info, resume upload, text questions, dropdowns, and radio buttons.
    """
    # -- Resume upload --
    file_inputs = await page.query_selector_all('input[type="file"]')
    for fi in file_inputs:
        try:
            accept = (await fi.get_attribute('accept') or '').lower()
            if not accept or 'pdf' in accept or 'doc' in accept or 'resume' in accept:
                await fi.set_input_files(resume_file)
                await _async_delay(1, 2)
                break
        except:
            continue

    # -- Personal info by label --
    field_pairs = [
        ('first name', contact.get('first_name', '')),
        ('last name', contact.get('last_name', '')),
        ('email', contact.get('email', '')),
        ('phone', contact.get('phone', '')),
        ('city', contact.get('city', '')),
        ('state', contact.get('state_full', '')),
        ('zip', contact.get('zip', '')),
        ('postal', contact.get('zip', '')),
    ]
    for label, value in field_pairs:
        if value:
            await _fill_by_label(page, label, value)

    # -- Text inputs --
    text_inputs = await page.query_selector_all(
        'input[type="text"]:not([readonly]):not([type="hidden"]), textarea:not([readonly])'
    )
    for inp in text_inputs:
        try:
            current_val = await inp.input_value()
            if current_val:
                continue

            # Find label
            inp_id = await inp.get_attribute('id') or ''
            label_el = None
            if inp_id:
                label_el = await page.query_selector(f'label[for="{inp_id}"]')
            if not label_el:
                aria = await inp.get_attribute('aria-label')
                if aria:
                    question = aria.strip()
                else:
                    continue
            else:
                question = (await label_el.inner_text()).strip()

            if not question:
                continue

            answer = _lookup_common_answer(question)
            if not answer:
                answer = await get_answer(question, job_context, resume_type)
            if answer:
                await inp.triple_click()
                await inp.fill(answer)
                result['qa_pairs'].append({'q': question, 'a': answer})
        except Exception as e:
            logger.debug(f"Generic form text input error: {e}")

    # -- Select/dropdown questions --
    selects = await page.query_selector_all('select')
    for sel_el in selects:
        try:
            sel_id = await sel_el.get_attribute('id') or ''
            label_el = await page.query_selector(f'label[for="{sel_id}"]') if sel_id else None
            question = (await label_el.inner_text()).strip() if label_el else ''
            if not question:
                continue

            options = await sel_el.query_selector_all('option')
            option_texts = [await o.inner_text() for o in options]

            answer = _lookup_common_answer(question)
            if not answer:
                answer = await get_answer(
                    question + f'\nOptions: {", ".join(option_texts)}',
                    job_context, resume_type
                )
            if answer:
                try:
                    await sel_el.select_option(label=answer)
                except:
                    for opt in option_texts:
                        if answer.lower() in opt.lower():
                            await sel_el.select_option(label=opt)
                            break
                result['qa_pairs'].append({'q': question, 'a': answer})
        except Exception as e:
            logger.debug(f"Generic form select error: {e}")

    # -- Radio buttons --
    radio_groups = await page.query_selector_all('fieldset')
    for group in radio_groups:
        try:
            legend = await group.query_selector('legend')
            question = (await legend.inner_text()).strip() if legend else ''
            if not question:
                continue

            radios = await group.query_selector_all('input[type="radio"]')
            radio_labels = []
            for r in radios:
                rid = await r.get_attribute('id')
                lbl = await page.query_selector(f'label[for="{rid}"]')
                radio_labels.append((await lbl.inner_text()).strip() if lbl else '')

            answer = _lookup_common_answer(question)
            if not answer:
                answer = await get_answer(
                    question + f'\nOptions: {", ".join(radio_labels)}',
                    job_context, resume_type
                )

            if answer:
                for i, lbl in enumerate(radio_labels):
                    if answer.lower() in lbl.lower():
                        await radios[i].click()
                        result['qa_pairs'].append({'q': question, 'a': lbl})
                        break
        except Exception as e:
            logger.debug(f"Generic form radio error: {e}")


# ─────────────────────────────────────────────────────────
# LINKEDIN EASY APPLY
# ─────────────────────────────────────────────────────────

async def apply_linkedin(page, job: dict, li_session_cookie: str = None) -> dict:
    """
    Apply to a LinkedIn job via Easy Apply.
    page: an already-open Playwright page, logged into LinkedIn.
    Returns {'success': bool, 'qa_pairs': [...], 'error': str}
    """
    result = {'success': False, 'qa_pairs': [], 'error': ''}
    contact = _contact_for_resume(job['resume_type'])
    resume_file = _resume_path(job['resume_type'])
    job_context = f"Title: {job['title']} at {job['company']}\n{job.get('description','')[:2000]}"

    try:
        await page.goto(job['url'], wait_until='domcontentloaded', timeout=30000)
        await _async_delay(2, 4)

        # Check if this is an external apply (redirects to company ATS)
        external_url = await _detect_external_apply(page)
        if external_url:
            logger.info(f"LinkedIn job redirects to external ATS: {external_url}")
            platform = ats_credentials.detect_platform(external_url)
            if platform != 'unknown' and platform != 'linkedin':
                job_copy = {**job, 'url': external_url, 'platform': platform}
                return await _apply_external_ats(page, job_copy)

        # Click Easy Apply button
        easy_apply_btn = await page.query_selector(
            'button.jobs-apply-button, .jobs-apply-button--top-card button, '
            'button[aria-label*="Easy Apply"]'
        )
        if not easy_apply_btn:
            result['error'] = 'No Easy Apply button found - may require external application'
            return result

        await easy_apply_btn.click()
        await _async_delay(1.5, 3)

        # Walk through the multi-step Easy Apply modal
        max_steps = 15
        for step in range(max_steps):
            await _async_delay(0.5, 1.5)

            # -- Phone --
            await _fill_by_label(page, 'phone', contact['phone'])
            await _fill_by_label(page, 'mobile phone', contact['phone'])

            # -- Resume upload --
            file_input = await page.query_selector('input[type="file"]')
            if file_input:
                await file_input.set_input_files(resume_file)
                await _async_delay(1, 2)

            # -- Answer text questions --
            text_inputs = await page.query_selector_all(
                '.jobs-easy-apply-form-element input[type="text"], '
                '.jobs-easy-apply-form-element textarea'
            )
            for inp in text_inputs:
                try:
                    label_el = await page.query_selector(
                        f'label[for="{await inp.get_attribute("id")}"]'
                    )
                    question = (await label_el.inner_text()).strip() if label_el else ''

                    current_val = await inp.input_value()
                    if current_val:  # Already filled
                        continue

                    # Try common answer lookup first
                    answer = _lookup_common_answer(question)
                    if not answer:
                        answer = await _answer_screening_question(
                            page, question, job_context, job['resume_type'], inp
                        )
                        if answer:
                            result['qa_pairs'].append({'q': question, 'a': answer})
                    else:
                        await inp.triple_click()
                        await inp.fill(answer)
                        result['qa_pairs'].append({'q': question, 'a': answer})
                except Exception as e:
                    logger.debug(f"Error filling text input: {e}")

            # -- Answer select/dropdown questions --
            selects = await page.query_selector_all('.jobs-easy-apply-form-element select')
            for sel_el in selects:
                try:
                    label_el = await page.query_selector(
                        f'label[for="{await sel_el.get_attribute("id")}"]'
                    )
                    question = (await label_el.inner_text()).strip() if label_el else ''
                    options = await sel_el.query_selector_all('option')
                    option_texts = [await o.inner_text() for o in options]

                    answer = _lookup_common_answer(question)
                    if not answer:
                        answer = await get_answer(
                            question + f'\nOptions: {", ".join(option_texts)}',
                            job_context, job['resume_type']
                        )
                    if answer:
                        try:
                            await sel_el.select_option(label=answer)
                        except:
                            # Try selecting by value or partial match
                            for opt in option_texts:
                                if answer.lower() in opt.lower():
                                    await sel_el.select_option(label=opt)
                                    break
                        result['qa_pairs'].append({'q': question, 'a': answer})
                except Exception as e:
                    logger.debug(f"Error filling select: {e}")

            # -- Radio buttons --
            radio_groups = await page.query_selector_all('.jobs-easy-apply-form-element fieldset')
            for group in radio_groups:
                try:
                    legend = await group.query_selector('legend')
                    question = (await legend.inner_text()).strip() if legend else ''
                    radios = await group.query_selector_all('input[type="radio"]')
                    radio_labels = []
                    for r in radios:
                        rid = await r.get_attribute('id')
                        lbl = await page.query_selector(f'label[for="{rid}"]')
                        radio_labels.append((await lbl.inner_text()).strip() if lbl else '')

                    answer = _lookup_common_answer(question)
                    if not answer:
                        answer = await get_answer(
                            question + f'\nOptions: {", ".join(radio_labels)}',
                            job_context, job['resume_type']
                        )

                    if answer:
                        for i, lbl in enumerate(radio_labels):
                            if answer.lower() in lbl.lower():
                                await radios[i].click()
                                result['qa_pairs'].append({'q': question, 'a': lbl})
                                break
                except Exception as e:
                    logger.debug(f"Error with radio group: {e}")

            # -- Navigation --
            # Check for Submit button (final step)
            submit_btn = await page.query_selector(
                'button[aria-label*="Submit application"], '
                'button.jobs-easy-apply-content button[type="submit"]'
            )
            if submit_btn:
                await submit_btn.click()
                await _async_delay(2, 4)
                result['success'] = True
                return result

            # Check for Next / Review / Continue button
            next_btn = await page.query_selector(
                'button[aria-label*="Continue"], button[aria-label*="Next"], '
                'button[aria-label*="Review"], .artdeco-button--primary'
            )
            if next_btn:
                btn_text = (await next_btn.inner_text()).strip().lower()
                if 'submit' in btn_text:
                    await next_btn.click()
                    await _async_delay(2, 4)
                    result['success'] = True
                    return result
                await next_btn.click()
                await _async_delay(1, 2.5)
            else:
                break

        result['error'] = 'Reached max steps without submitting'

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"LinkedIn apply error: {e}")

    return result


# ─────────────────────────────────────────────────────────
# WORKDAY APPLICATOR
# ─────────────────────────────────────────────────────────

async def apply_workday(page, job: dict) -> dict:
    """
    Apply via Workday ATS (standard across many companies).
    Handles login/account creation and the multi-step application flow.
    """
    result = {'success': False, 'qa_pairs': [], 'error': ''}
    contact = _contact_for_resume(job['resume_type'])
    resume_file = _resume_path(job['resume_type'])
    job_context = f"Title: {job['title']} at {job['company']}\n{job.get('description','')[:2000]}"

    try:
        await page.goto(job['url'], wait_until='domcontentloaded', timeout=30000)
        await _async_delay(2, 4)

        # Click Apply button
        apply_btn = await page.query_selector(
            'a[data-automation-id="applyNowButton"], '
            'button[data-automation-id="applyNowButton"]'
        )
        if not apply_btn:
            apply_btn = await page.query_selector('a:has-text("Apply"), button:has-text("Apply Now")')

        if not apply_btn:
            result['error'] = 'No Apply button found on Workday page'
            return result

        await apply_btn.click()
        await _async_delay(2, 4)

        # Handle login wall — Workday requires per-company accounts
        if await _detect_login_wall(page):
            logger.info("Workday login wall detected, attempting authentication")
            # Use company-specific credential key (e.g. 'workday_microsoft')
            company_key = ats_credentials.detect_company_platform_key(page.url)
            if not await _handle_ats_auth(page, company_key, contact):
                # Fall back to generic 'workday' credentials
                if company_key != 'workday' and not await _handle_ats_auth(page, 'workday', contact):
                    parsed = urlparse(page.url)
                    result['error'] = (
                        f'Could not authenticate on Workday. '
                        f'Check credentials in Settings for: {parsed.hostname}'
                    )
                    return result

        # Workday multi-step form: My Information -> My Experience -> Application Questions
        max_steps = 20
        for step in range(max_steps):
            await _async_delay(1, 2)

            # -- Resume upload --
            file_inputs = await page.query_selector_all('input[type="file"]')
            for fi in file_inputs:
                try:
                    await fi.set_input_files(resume_file)
                    await _async_delay(1, 2)
                    break
                except:
                    pass

            # -- Personal info fields (Workday-specific data-automation-id) --
            field_map = {
                'firstName': contact['first_name'],
                'lastName': contact['last_name'],
                'email': contact['email'],
                'phone': contact['phone'],
                'city': contact['city'],
                'state': contact['state_full'],
                'postalCode': contact['zip'],
                'addressLine1': '',
                'legalName': contact['full_name'],
            }
            for field_id, value in field_map.items():
                if value:
                    try:
                        el = await page.query_selector(
                            f'input[data-automation-id="{field_id}"]'
                        )
                        if el:
                            current = await el.input_value()
                            if not current:
                                await el.fill(value)
                    except:
                        pass

            # -- Text inputs with labels --
            text_inputs = await page.query_selector_all(
                'input[data-automation-id]:not([type="file"]):not([type="hidden"]), '
                'textarea[data-automation-id]'
            )
            for inp in text_inputs:
                try:
                    automation_id = await inp.get_attribute('data-automation-id') or ''
                    current_val = await inp.input_value()
                    if current_val or not automation_id:
                        continue

                    # Find associated label
                    label_text = ''
                    label_el = await page.query_selector(f'label[for*="{automation_id}"]')
                    if label_el:
                        label_text = (await label_el.inner_text()).strip()

                    if not label_text:
                        continue

                    answer = _lookup_common_answer(label_text)
                    if not answer:
                        answer = await get_answer(label_text, job_context, job['resume_type'])
                    if answer:
                        await inp.fill(answer)
                        result['qa_pairs'].append({'q': label_text, 'a': answer})
                except Exception as e:
                    logger.debug(f"Workday text input error: {e}")

            # -- Dropdowns --
            dropdowns = await page.query_selector_all('[data-automation-id*="select"] button')
            for dd in dropdowns:
                try:
                    label_text = await dd.inner_text()
                    if label_text and 'select' in label_text.lower():
                        # Open dropdown
                        await dd.click()
                        await _async_delay(0.5, 1)
                        options = await page.query_selector_all('li[role="option"]')
                        if options:
                            opt_texts = [await o.inner_text() for o in options]
                            answer = await get_answer(
                                label_text + f'\nOptions: {", ".join(opt_texts[:10])}',
                                job_context, job['resume_type']
                            )
                            if answer:
                                for i, opt in enumerate(opt_texts):
                                    if answer.lower() in opt.lower():
                                        await options[i].click()
                                        result['qa_pairs'].append({'q': label_text, 'a': opt})
                                        break
                                else:
                                    await options[0].click()  # Select first option as fallback
                        await _async_delay(0.5, 1)
                except Exception as e:
                    logger.debug(f"Workday dropdown error: {e}")

            # -- Check for Next / Save and Continue --
            next_btn = await page.query_selector(
                'button[data-automation-id="bottom-navigation-next-btn"], '
                'button[data-automation-id="saveAndContinueButton"]'
            )
            submit_btn = await page.query_selector(
                'button[data-automation-id="bottom-navigation-submit-btn"]'
            )

            if submit_btn:
                await submit_btn.click()
                await _async_delay(3, 5)
                result['success'] = True
                return result

            if next_btn:
                await next_btn.click()
                await _async_delay(1.5, 3)
            else:
                # Try generic Save/Next/Continue buttons
                generic_next = await page.query_selector(
                    'button:has-text("Next"), button:has-text("Continue"), '
                    'button:has-text("Save and Continue")'
                )
                if generic_next:
                    await generic_next.click()
                    await _async_delay(1.5, 3)
                else:
                    break

        result['error'] = 'Could not complete Workday application'

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"Workday apply error: {e}")

    return result


# ─────────────────────────────────────────────────────────
# INDEED APPLICATOR
# ─────────────────────────────────────────────────────────

async def apply_indeed(page, job: dict) -> dict:
    """Apply to an Indeed job (Indeed Apply flow)."""
    result = {'success': False, 'qa_pairs': [], 'error': ''}
    contact = _contact_for_resume(job['resume_type'])
    resume_file = _resume_path(job['resume_type'])
    job_context = f"Title: {job['title']} at {job['company']}\n{job.get('description','')[:2000]}"

    try:
        await page.goto(job['url'], wait_until='domcontentloaded', timeout=30000)
        await _async_delay(2, 4)

        # Check for external apply redirect
        external_url = await _detect_external_apply(page)
        if external_url:
            logger.info(f"Indeed job redirects to external ATS: {external_url}")
            platform = ats_credentials.detect_platform(external_url)
            if platform != 'unknown' and platform != 'indeed':
                job_copy = {**job, 'url': external_url, 'platform': platform}
                return await _apply_external_ats(page, job_copy)

        # Click Apply Now button
        apply_btn = await page.query_selector(
            'button#indeedApplyButton, '
            'button[data-indeed-apply-button], '
            'button:has-text("Apply now"), '
            'a:has-text("Apply now")'
        )
        if not apply_btn:
            result['error'] = 'No Apply button found on Indeed page'
            return result

        await apply_btn.click()
        await _async_delay(2, 4)

        # Indeed Apply is a multi-step modal/page flow
        max_steps = 15
        for step in range(max_steps):
            await _async_delay(0.5, 1.5)

            # -- Resume upload --
            file_input = await page.query_selector('input[type="file"]')
            if file_input:
                try:
                    await file_input.set_input_files(resume_file)
                    await _async_delay(1, 2)
                except:
                    pass

            # -- Contact info fields --
            await _fill_by_label(page, 'First name', contact['first_name'])
            await _fill_by_label(page, 'Last name', contact['last_name'])
            await _fill_by_label(page, 'Email', contact['email'])
            await _fill_by_label(page, 'Phone', contact['phone'])
            await _fill_by_label(page, 'City', contact['city'])

            # -- Text questions --
            text_inputs = await page.query_selector_all(
                'input[type="text"]:not([readonly]), textarea:not([readonly])'
            )
            for inp in text_inputs:
                try:
                    current_val = await inp.input_value()
                    if current_val:
                        continue

                    # Find associated label
                    inp_id = await inp.get_attribute('id') or ''
                    label_el = await page.query_selector(f'label[for="{inp_id}"]') if inp_id else None
                    if not label_el:
                        # Try parent label
                        label_el = await inp.evaluate_handle(
                            'el => el.closest("label") || el.parentElement?.querySelector("label")'
                        )
                    question = ''
                    if label_el:
                        try:
                            question = (await label_el.inner_text()).strip()
                        except:
                            pass

                    if not question:
                        continue

                    answer = _lookup_common_answer(question)
                    if not answer:
                        answer = await _answer_screening_question(
                            page, question, job_context, job['resume_type'], inp
                        )
                    else:
                        await inp.triple_click()
                        await inp.fill(answer)

                    if answer:
                        result['qa_pairs'].append({'q': question, 'a': answer})
                except Exception as e:
                    logger.debug(f"Indeed text input error: {e}")

            # -- Select/dropdown questions --
            selects = await page.query_selector_all('select')
            for sel_el in selects:
                try:
                    sel_id = await sel_el.get_attribute('id') or ''
                    label_el = await page.query_selector(f'label[for="{sel_id}"]') if sel_id else None
                    question = (await label_el.inner_text()).strip() if label_el else ''

                    if not question:
                        continue

                    options = await sel_el.query_selector_all('option')
                    option_texts = [await o.inner_text() for o in options]

                    answer = _lookup_common_answer(question)
                    if not answer:
                        answer = await get_answer(
                            question + f'\nOptions: {", ".join(option_texts)}',
                            job_context, job['resume_type']
                        )

                    if answer:
                        try:
                            await sel_el.select_option(label=answer)
                        except:
                            for opt in option_texts:
                                if answer.lower() in opt.lower():
                                    await sel_el.select_option(label=opt)
                                    break
                        result['qa_pairs'].append({'q': question, 'a': answer})
                except Exception as e:
                    logger.debug(f"Indeed select error: {e}")

            # -- Radio buttons --
            radio_groups = await page.query_selector_all('fieldset')
            for group in radio_groups:
                try:
                    legend = await group.query_selector('legend, .ia-BasePage-heading')
                    question = (await legend.inner_text()).strip() if legend else ''
                    if not question:
                        continue

                    radios = await group.query_selector_all('input[type="radio"]')
                    radio_labels = []
                    for r in radios:
                        rid = await r.get_attribute('id')
                        lbl = await page.query_selector(f'label[for="{rid}"]')
                        radio_labels.append((await lbl.inner_text()).strip() if lbl else '')

                    answer = _lookup_common_answer(question)
                    if not answer:
                        answer = await get_answer(
                            question + f'\nOptions: {", ".join(radio_labels)}',
                            job_context, job['resume_type']
                        )

                    if answer:
                        for i, lbl in enumerate(radio_labels):
                            if answer.lower() in lbl.lower():
                                await radios[i].click()
                                result['qa_pairs'].append({'q': question, 'a': lbl})
                                break
                except Exception as e:
                    logger.debug(f"Indeed radio group error: {e}")

            # -- Navigation --
            submit_btn = await page.query_selector(
                'button[type="submit"]:has-text("Submit"), '
                'button:has-text("Submit your application")'
            )
            if submit_btn:
                await submit_btn.click()
                await _async_delay(2, 4)
                result['success'] = True
                return result

            # Continue / Next button
            next_btn = await page.query_selector(
                'button:has-text("Continue"), '
                'button:has-text("Next"), '
                'button[data-testid="next-button"]'
            )
            if next_btn:
                btn_text = (await next_btn.inner_text()).strip().lower()
                if 'submit' in btn_text:
                    await next_btn.click()
                    await _async_delay(2, 4)
                    result['success'] = True
                    return result
                await next_btn.click()
                await _async_delay(1, 2.5)
            else:
                break

        result['error'] = 'Could not complete Indeed application'

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"Indeed apply error: {e}")

    return result


# ─────────────────────────────────────────────────────────
# TALEO / ORACLE APPLICATOR
# ─────────────────────────────────────────────────────────

async def apply_taleo(page, job: dict) -> dict:
    """
    Apply via Oracle/Taleo ATS.
    Handles the typical Taleo multi-step application flow with login.
    """
    result = {'success': False, 'qa_pairs': [], 'error': ''}
    contact = _contact_for_resume(job['resume_type'])
    resume_file = _resume_path(job['resume_type'])
    job_context = f"Title: {job['title']} at {job['company']}\n{job.get('description','')[:2000]}"

    try:
        await page.goto(job['url'], wait_until='domcontentloaded', timeout=30000)
        await _async_delay(2, 4)

        # Click Apply button
        apply_btn = await page.query_selector(
            'a:has-text("Apply"), button:has-text("Apply"), '
            'a:has-text("Apply Now"), button:has-text("Apply Now"), '
            'a:has-text("Apply for this job"), '
            'a.applyButton, button.applyButton'
        )
        if apply_btn:
            await apply_btn.click()
            await _async_delay(2, 4)

        # Handle login wall
        if await _detect_login_wall(page):
            logger.info("Taleo login wall detected, attempting authentication")
            if not await _handle_ats_auth(page, 'taleo', contact):
                result['error'] = 'Could not authenticate on Taleo. Check credentials in Settings.'
                return result

        # Taleo multi-step form
        max_steps = 20
        for step in range(max_steps):
            await _async_delay(1, 2)
            await _fill_generic_application_form(page, contact, resume_file, job_context, job['resume_type'], result)

            # Navigation
            submit_btn = await page.query_selector(
                'button:has-text("Submit"), input[value="Submit"], '
                'a:has-text("Submit Application")'
            )
            if submit_btn:
                await submit_btn.click()
                await _async_delay(3, 5)
                result['success'] = True
                return result

            next_btn = await page.query_selector(
                'button:has-text("Next"), button:has-text("Continue"), '
                'button:has-text("Save and Continue"), input[value="Next"], '
                'a:has-text("Next")'
            )
            if next_btn:
                btn_text = ''
                try:
                    btn_text = (await next_btn.inner_text()).strip().lower()
                except:
                    pass
                if 'submit' in btn_text:
                    await next_btn.click()
                    await _async_delay(3, 5)
                    result['success'] = True
                    return result
                await next_btn.click()
                await _async_delay(1.5, 3)
            else:
                break

        result['error'] = 'Could not complete Taleo application'

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"Taleo apply error: {e}")

    return result


# ─────────────────────────────────────────────────────────
# SUCCESSFACTORS APPLICATOR
# ─────────────────────────────────────────────────────────

async def apply_successfactors(page, job: dict) -> dict:
    """Apply via SAP SuccessFactors ATS."""
    result = {'success': False, 'qa_pairs': [], 'error': ''}
    contact = _contact_for_resume(job['resume_type'])
    resume_file = _resume_path(job['resume_type'])
    job_context = f"Title: {job['title']} at {job['company']}\n{job.get('description','')[:2000]}"

    try:
        await page.goto(job['url'], wait_until='domcontentloaded', timeout=30000)
        await _async_delay(2, 4)

        # Click Apply
        apply_btn = await page.query_selector(
            'button:has-text("Apply"), a:has-text("Apply"), '
            'button:has-text("Apply Now"), a:has-text("Apply Now"), '
            '[data-key="apply"]'
        )
        if apply_btn:
            await apply_btn.click()
            await _async_delay(2, 4)

        # Handle login
        if await _detect_login_wall(page):
            logger.info("SuccessFactors login wall detected")
            if not await _handle_ats_auth(page, 'successfactors', contact):
                result['error'] = 'Could not authenticate on SuccessFactors. Check credentials in Settings.'
                return result

        # SuccessFactors form flow
        max_steps = 20
        for step in range(max_steps):
            await _async_delay(1, 2)
            await _fill_generic_application_form(page, contact, resume_file, job_context, job['resume_type'], result)

            # Navigation
            submit_btn = await page.query_selector(
                'button:has-text("Submit"), button:has-text("Submit Application"), '
                'input[value="Submit"]'
            )
            if submit_btn:
                await submit_btn.click()
                await _async_delay(3, 5)
                result['success'] = True
                return result

            next_btn = await page.query_selector(
                'button:has-text("Next"), button:has-text("Continue"), '
                'button:has-text("Save"), a:has-text("Next")'
            )
            if next_btn:
                await next_btn.click()
                await _async_delay(1.5, 3)
            else:
                break

        result['error'] = 'Could not complete SuccessFactors application'

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"SuccessFactors apply error: {e}")

    return result


# ─────────────────────────────────────────────────────────
# GREENHOUSE / LEVER / GENERIC ATS
# ─────────────────────────────────────────────────────────

async def apply_greenhouse(page, job: dict) -> dict:
    """Apply via Greenhouse ATS (typically a single-page form, no login required)."""
    result = {'success': False, 'qa_pairs': [], 'error': ''}
    contact = _contact_for_resume(job['resume_type'])
    resume_file = _resume_path(job['resume_type'])
    job_context = f"Title: {job['title']} at {job['company']}\n{job.get('description','')[:2000]}"

    try:
        await page.goto(job['url'], wait_until='domcontentloaded', timeout=30000)
        await _async_delay(2, 4)

        # Greenhouse often has the application form directly on the page
        # or behind an "Apply" button
        apply_btn = await page.query_selector(
            'a:has-text("Apply"), button:has-text("Apply"), '
            'a:has-text("Apply for this job"), '
            '#apply_button, .apply-button'
        )
        if apply_btn:
            await apply_btn.click()
            await _async_delay(2, 3)

        # Fill form — Greenhouse is typically a single long form
        await _fill_generic_application_form(page, contact, resume_file, job_context, job['resume_type'], result)

        # Submit
        submit_btn = await page.query_selector(
            'button[type="submit"]:has-text("Submit"), '
            'input[type="submit"][value*="Submit"], '
            'button:has-text("Submit Application")'
        )
        if submit_btn:
            await submit_btn.click()
            await _async_delay(3, 5)

            # Check for success message
            page_text = (await page.inner_text('body'))[:2000].lower()
            if any(phrase in page_text for phrase in [
                'application submitted', 'thank you', 'successfully',
                'application received', 'we have received',
            ]):
                result['success'] = True
            else:
                result['success'] = True  # Assume success if submit clicked without error
        else:
            result['error'] = 'Could not find Submit button on Greenhouse form'

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"Greenhouse apply error: {e}")

    return result


async def apply_lever(page, job: dict) -> dict:
    """Apply via Lever ATS (typically single-page, no login)."""
    result = {'success': False, 'qa_pairs': [], 'error': ''}
    contact = _contact_for_resume(job['resume_type'])
    resume_file = _resume_path(job['resume_type'])
    job_context = f"Title: {job['title']} at {job['company']}\n{job.get('description','')[:2000]}"

    try:
        # Lever apply pages are usually at /apply suffix
        apply_url = job['url']
        if '/apply' not in apply_url:
            apply_url = apply_url.rstrip('/') + '/apply'

        await page.goto(apply_url, wait_until='domcontentloaded', timeout=30000)
        await _async_delay(2, 4)

        # Lever form fields
        await _fill_by_label(page, 'Full name', contact.get('full_name', ''))
        await _fill_by_label(page, 'Email', contact.get('email', ''))
        await _fill_by_label(page, 'Phone', contact.get('phone', ''))
        await _fill_by_label(page, 'Current company', '')
        await _fill_by_label(page, 'LinkedIn', contact.get('linkedin', ''))

        # Resume upload
        file_input = await page.query_selector('input[type="file"][name*="resume"], input[type="file"]')
        if file_input:
            await file_input.set_input_files(resume_file)
            await _async_delay(1, 2)

        # Fill any additional questions
        await _fill_generic_application_form(page, contact, resume_file, job_context, job['resume_type'], result)

        # Submit
        submit_btn = await page.query_selector(
            'button:has-text("Submit application"), '
            'button:has-text("Submit"), '
            'button[type="submit"]'
        )
        if submit_btn:
            await submit_btn.click()
            await _async_delay(3, 5)
            result['success'] = True
        else:
            result['error'] = 'Could not find Submit button on Lever form'

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"Lever apply error: {e}")

    return result


# ─────────────────────────────────────────────────────────
# GENERIC EXTERNAL ATS (fallback for any detected platform)
# ─────────────────────────────────────────────────────────

async def _apply_external_ats(page, job: dict) -> dict:
    """
    Generic handler for any external ATS redirect.
    Navigates to the URL, handles login if needed, fills forms.
    """
    platform = job.get('platform', 'unknown')
    result = {'success': False, 'qa_pairs': [], 'error': ''}
    contact = _contact_for_resume(job['resume_type'])
    resume_file = _resume_path(job['resume_type'])
    job_context = f"Title: {job['title']} at {job['company']}\n{job.get('description','')[:2000]}"

    try:
        await page.goto(job['url'], wait_until='domcontentloaded', timeout=30000)
        await _async_delay(2, 4)

        # Click Apply if there's a button
        apply_btn = await page.query_selector(
            'a:has-text("Apply"), button:has-text("Apply"), '
            'a:has-text("Apply Now"), button:has-text("Apply Now")'
        )
        if apply_btn:
            await apply_btn.click()
            await _async_delay(2, 4)

        # Handle login wall
        if await _detect_login_wall(page):
            logger.info(f"Login wall detected on {platform}, attempting auth")
            if not await _handle_ats_auth(page, platform, contact):
                result['error'] = f'Could not authenticate on {platform}. Add credentials in Settings.'
                return result

        # Fill forms
        max_steps = 20
        for step in range(max_steps):
            await _async_delay(1, 2)
            await _fill_generic_application_form(page, contact, resume_file, job_context, job['resume_type'], result)

            # Look for submit
            submit_btn = await page.query_selector(
                'button:has-text("Submit"), input[type="submit"], '
                'button:has-text("Submit Application")'
            )
            if submit_btn:
                await submit_btn.click()
                await _async_delay(3, 5)
                result['success'] = True
                return result

            # Next step
            next_btn = await page.query_selector(
                'button:has-text("Next"), button:has-text("Continue"), '
                'button:has-text("Save and Continue")'
            )
            if next_btn:
                btn_text = ''
                try:
                    btn_text = (await next_btn.inner_text()).strip().lower()
                except:
                    pass
                if 'submit' in btn_text:
                    await next_btn.click()
                    await _async_delay(3, 5)
                    result['success'] = True
                    return result
                await next_btn.click()
                await _async_delay(1.5, 3)
            else:
                break

        result['error'] = f'Could not complete {platform} application'

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"{platform} apply error: {e}")

    return result


# ─────────────────────────────────────────────────────────
# MAIN DISPATCHER
# ─────────────────────────────────────────────────────────

# Platform → applicator function mapping
_PLATFORM_HANDLERS = {
    'linkedin': 'apply_linkedin',
    'workday': 'apply_workday',
    'indeed': 'apply_indeed',
    'taleo': 'apply_taleo',
    'successfactors': 'apply_successfactors',
    'greenhouse': 'apply_greenhouse',
    'lever': 'apply_lever',
}


async def apply_to_job(job: dict, settings: dict) -> dict:
    """
    Apply to a job using the appropriate platform handler.
    Auto-detects ATS platform from URL, launches a Playwright browser,
    routes to the correct applicator, and returns the result.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {'success': False, 'qa_pairs': [], 'error': 'Playwright not installed'}

    platform = job.get('platform', 'manual')
    url = job.get('url', '')

    # Auto-detect platform from URL if not set or is 'manual'
    if platform in ('manual', 'unknown', '') and url:
        detected = ats_credentials.detect_platform(url)
        if detected != 'unknown':
            platform = detected
            job['platform'] = platform
            logger.info(f"Auto-detected platform: {platform} from URL: {url}")

    result = {'success': False, 'qa_pairs': [], 'error': ''}

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-infobars',
                '--window-size=1440,900',
            ]
        )
        context = await browser.new_context(
            viewport={'width': 1440, 'height': 900},
            user_agent=(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/122.0.0.0 Safari/537.36'
            ),
            locale='en-US',
            timezone_id='America/Chicago',
        )
        # Remove automation indicators
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
            Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3]});
        """)

        # Add LinkedIn cookie if available
        li_cookie = settings.get('linkedin_session_cookie', '')
        if li_cookie and platform == 'linkedin':
            await context.add_cookies([{
                'name': 'li_at',
                'value': li_cookie,
                'domain': '.linkedin.com',
                'path': '/',
            }])

        page = await context.new_page()

        try:
            if platform == 'linkedin':
                result = await apply_linkedin(page, job, li_cookie)
            elif platform == 'workday':
                result = await apply_workday(page, job)
            elif platform == 'indeed':
                result = await apply_indeed(page, job)
            elif platform == 'taleo':
                result = await apply_taleo(page, job)
            elif platform == 'successfactors':
                result = await apply_successfactors(page, job)
            elif platform == 'greenhouse':
                result = await apply_greenhouse(page, job)
            elif platform == 'lever':
                result = await apply_lever(page, job)
            elif platform != 'manual':
                # Unknown but detected platform — use generic handler
                result = await _apply_external_ats(page, job)
            else:
                result['error'] = f'Unknown platform. Please apply manually at {url}'

            # If the primary handler failed with a redirect, try detecting the new URL
            if not result['success'] and not result['error']:
                current_url = page.url
                new_platform = ats_credentials.detect_platform(current_url)
                if new_platform != 'unknown' and new_platform != platform:
                    logger.info(f"Page redirected to {new_platform}, retrying with that handler")
                    job_copy = {**job, 'url': current_url, 'platform': new_platform}
                    result = await _apply_external_ats(page, job_copy)

        except Exception as e:
            result['error'] = str(e)
            logger.error(f"Application error for {job.get('title', '?')}: {e}")
        finally:
            await browser.close()

    return result
