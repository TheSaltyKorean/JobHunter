"""
Job searchers for LinkedIn, Indeed, and manual URL ingestion.
Uses Playwright for browser automation with stealth settings.
"""

import asyncio
import hashlib
import json
import logging
import re
import time
import random
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


def _make_job_id(platform: str, url: str) -> str:
    """Create a stable unique ID for a job posting."""
    return platform + '_' + hashlib.md5(url.encode()).hexdigest()[:12]


def _random_delay(min_s=1.5, max_s=4.0):
    """Human-like random pause."""
    time.sleep(random.uniform(min_s, max_s))


# ─────────────────────────────────────────────────────────
# Expired Job Detection
# ─────────────────────────────────────────────────────────

EXPIRED_INDICATORS = [
    'this job has expired',
    'this job is no longer available',
    'no longer accepting applications',
    'this position has been filled',
    'position is no longer available',
    'job is closed',
    'this listing has expired',
    'this job posting has expired',
    'application deadline has passed',
    'we are no longer accepting',
    'this role has been filled',
    'job no longer exists',
    'sorry, this job is no longer',
    'this opportunity is no longer',
]


def is_expired_page(page_text: str) -> bool:
    """Check if page text indicates an expired or closed job listing."""
    text_lower = page_text[:2000].lower()
    return any(indicator in text_lower for indicator in EXPIRED_INDICATORS)


# ─────────────────────────────────────────────────────────
# Playwright stealth setup
# ─────────────────────────────────────────────────────────

async def _get_browser(playwright, headless=False):
    """
    Launch Chromium with stealth settings to reduce bot detection.
    headless=False makes it look more like a real browser.
    """
    browser = await playwright.chromium.launch(
        headless=headless,
        args=[
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-setuid-sandbox',
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
        java_script_enabled=True,
    )
    # Remove automation indicators
    await context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
        Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3]});
    """)
    return browser, context


# ─────────────────────────────────────────────────────────
# LINKEDIN SEARCHER
# ─────────────────────────────────────────────────────────

async def search_linkedin(keywords: list, location: str,
                           max_results: int = 25,
                           li_session_cookie: str = None) -> list:
    """
    Search LinkedIn Jobs for management roles.
    Returns list of raw job dicts ready for analysis.

    NOTE: Requires LinkedIn to be logged in OR a valid li_at session cookie.
    The browser window will be visible so Randy can log in manually if needed.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.error("Playwright not installed. Run: pip install playwright && playwright install chromium")
        return []

    jobs = []
    query = ' '.join(keywords)
    from urllib.parse import quote_plus
    encoded_query = quote_plus(query)
    encoded_location = quote_plus(location)

    # LinkedIn public guest search URL (works without login)
    url = (
        f"https://www.linkedin.com/jobs/search/"
        f"?keywords={encoded_query}"
        f"&location={encoded_location}"
        f"&f_JT=F"           # Full-time
        f"&f_TPR=r604800"    # Posted last 7 days
        f"&sortBy=DD"        # Most recent
        f"&position=1&pageNum=0"
    )

    async with async_playwright() as p:
        browser, context = await _get_browser(p, headless=False)
        page = await context.new_page()

        # Set cookie if provided for authenticated search
        if li_session_cookie:
            await context.add_cookies([{
                'name': 'li_at',
                'value': li_session_cookie,
                'domain': '.linkedin.com',
                'path': '/',
            }])
            logger.info("LinkedIn session cookie set")

        try:
            logger.info(f"Searching LinkedIn: '{query}' in '{location}'")
            logger.info(f"URL: {url}")
            try:
                await page.goto(url, wait_until='domcontentloaded', timeout=30000)
            except Exception as nav_err:
                err_msg = str(nav_err)
                if 'ERR_TOO_MANY_REDIRECTS' in err_msg:
                    logger.error(
                        "LinkedIn session cookie is expired or invalid (redirect loop). "
                        "Go to Settings and update your li_at cookie from Chrome DevTools."
                    )
                    from . import notifier
                    notifier.notify_config_warning(
                        "LinkedIn Cookie Expired",
                        "Your LinkedIn session cookie is invalid. Update it in Settings to resume searching."
                    )
                    return None  # None signals auth failure (vs [] for no results)
                raise  # Re-raise other navigation errors

            await asyncio.sleep(random.uniform(3, 5))

            current_url = page.url
            logger.info(f"Landed on: {current_url}")

            # Check if redirected to auth wall
            if 'authwall' in current_url or 'login' in current_url or 'checkpoint' in current_url:
                logger.warning("LinkedIn requires login. Waiting up to 90s for manual login...")
                for i in range(90):
                    await asyncio.sleep(1)
                    if 'linkedin.com/jobs' in page.url:
                        logger.info("Login detected, continuing search")
                        await asyncio.sleep(2)
                        break
                    if i == 89:
                        logger.error("Login timeout - no login detected after 90s")

            # Scroll to load more results
            for scroll in range(4):
                await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(random.uniform(1.5, 3))
                # Click "See more jobs" button if present
                try:
                    see_more = await page.query_selector('button.infinite-scroller__show-more-button, button[aria-label*="more jobs"]')
                    if see_more:
                        await see_more.click()
                        await asyncio.sleep(2)
                except:
                    pass

            # Try multiple selector strategies (LinkedIn changes these frequently)
            card_selectors = [
                'ul.jobs-search__results-list li',            # Guest/public page
                '.job-search-card',                            # Guest page alt
                '.jobs-search-results__list-item',             # Logged-in page
                'div.job-card-container',                      # Logged-in alt
                '.scaffold-layout__list-item',                 # Newer logged-in layout
                'li[data-occludable-job-id]',                  # Data attribute approach
                '.job-card-list',                              # Another variant
            ]

            job_cards = []
            used_selector = ''
            for sel in card_selectors:
                job_cards = await page.query_selector_all(sel)
                if job_cards:
                    used_selector = sel
                    break

            logger.info(f"Found {len(job_cards)} job cards using selector: '{used_selector}'")

            if not job_cards:
                # Log the page structure to help debug
                page_text = await page.inner_text('body')
                logger.warning(f"No job cards found. Page text preview: {page_text[:500]}")
                # Try a generic fallback: find all job links
                all_links = await page.query_selector_all('a[href*="/jobs/view/"]')
                logger.info(f"Fallback: found {len(all_links)} links containing /jobs/view/")

                # Extract jobs from raw links as last resort
                seen_urls = set()
                for link_el in all_links[:max_results]:
                    try:
                        href = await link_el.get_attribute('href') or ''
                        if '/jobs/view/' not in href:
                            continue
                        clean_href = href.split('?')[0]
                        if clean_href in seen_urls:
                            continue
                        seen_urls.add(clean_href)

                        text = (await link_el.inner_text()).strip()
                        if not text or len(text) < 3:
                            continue

                        if not clean_href.startswith('http'):
                            clean_href = 'https://www.linkedin.com' + clean_href

                        jobs.append({
                            'job_id':    _make_job_id('linkedin', clean_href),
                            'title':     text,
                            'company':   '',
                            'location':  location,
                            'platform':  'linkedin',
                            'url':       clean_href,
                            'description': '',
                            'posted_date': '',
                            'salary':    '',
                            'job_type':  'Full-time',
                        })
                    except Exception as e:
                        logger.debug(f"Error parsing fallback link: {e}")
            else:
                # Standard card-based extraction with multiple selector options
                title_selectors = [
                    '.base-search-card__title',
                    '.job-card-list__title',
                    'a.job-card-container__link span',
                    'a.job-card-list__title--link span',
                    '.artdeco-entity-lockup__title span',
                    'h3',
                ]
                company_selectors = [
                    '.base-search-card__subtitle',
                    '.job-card-container__primary-description',
                    '.job-card-container__company-name',
                    '.artdeco-entity-lockup__subtitle span',
                    'h4 a',
                    'h4',
                ]
                location_selectors = [
                    '.job-search-card__location',
                    '.job-card-container__metadata-item',
                    '.job-card-container__metadata-wrapper li',
                    '.artdeco-entity-lockup__caption span',
                ]
                link_selectors = [
                    'a.base-card__full-link',
                    'a.job-card-list__title',
                    'a.job-card-container__link',
                    'a[href*="/jobs/view/"]',
                    'a',
                ]

                for card in job_cards[:max_results]:
                    try:
                        title = ''
                        company = ''
                        loc = ''
                        link = ''

                        for sel in title_selectors:
                            el = await card.query_selector(sel)
                            if el:
                                title = (await el.inner_text()).strip()
                                if title:
                                    break

                        for sel in company_selectors:
                            el = await card.query_selector(sel)
                            if el:
                                company = (await el.inner_text()).strip()
                                if company:
                                    break

                        for sel in location_selectors:
                            el = await card.query_selector(sel)
                            if el:
                                loc = (await el.inner_text()).strip()
                                if loc:
                                    break

                        for sel in link_selectors:
                            el = await card.query_selector(sel)
                            if el:
                                link = await el.get_attribute('href') or ''
                                if '/jobs/view/' in link:
                                    break
                                link = ''  # Reset if not a job link

                        if not title or not link:
                            continue

                        # Clean up the URL
                        if not link.startswith('http'):
                            link = 'https://www.linkedin.com' + link
                        link = link.split('?')[0]
                        job_id = _make_job_id('linkedin', link)

                        jobs.append({
                            'job_id':    job_id,
                            'title':     title,
                            'company':   company,
                            'location':  loc or location,
                            'platform':  'linkedin',
                            'url':       link,
                            'description': '',
                            'posted_date': '',
                            'salary':    '',
                            'job_type':  'Full-time',
                        })

                    except Exception as e:
                        logger.debug(f"Error parsing LinkedIn card: {e}")
                        continue

        except Exception as e:
            logger.error(f"LinkedIn search error: {e}", exc_info=True)
        finally:
            await browser.close()

    logger.info(f"LinkedIn search found {len(jobs)} jobs")
    return jobs


async def fetch_linkedin_description(url: str, li_session_cookie: str = None) -> str:
    """Fetch full job description from a LinkedIn job URL."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return ''

    async with async_playwright() as p:
        browser, context = await _get_browser(p, headless=True)
        if li_session_cookie:
            await context.add_cookies([{
                'name': 'li_at', 'value': li_session_cookie,
                'domain': '.linkedin.com', 'path': '/',
            }])
        page = await context.new_page()
        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=20000)
            await asyncio.sleep(2)
            # Try to click "Show more" to expand description
            try:
                btn = await page.query_selector('.show-more-less-html__button--more')
                if btn:
                    await btn.click()
                    await asyncio.sleep(1)
            except:
                pass
            desc_el = await page.query_selector('.show-more-less-html__markup, .description__text')
            desc = await desc_el.inner_text() if desc_el else ''
            return desc.strip()
        except Exception as e:
            logger.debug(f"Could not fetch LinkedIn description: {e}")
            return ''
        finally:
            await browser.close()


# ─────────────────────────────────────────────────────────
# INDEED SEARCHER
# ─────────────────────────────────────────────────────────

async def search_indeed(keywords: list, location: str, max_results: int = 25) -> list:
    """Search Indeed for management roles."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.error("Playwright not installed.")
        return []

    jobs = []
    query = ' '.join(keywords)

    url = (
        f"https://www.indeed.com/jobs"
        f"?q={query.replace(' ', '+')}"
        f"&l={location.replace(' ', '+').replace(',', '%2C')}"
        f"&fromage=7"         # Posted in last 7 days
        f"&sort=date"
        f"&sc=0kf%3Ajt%28fulltime%29%3B"  # Full-time
    )

    async with async_playwright() as p:
        browser, context = await _get_browser(p, headless=False)
        page = await context.new_page()

        try:
            logger.info(f"Searching Indeed: {query} in {location}")
            await page.goto(url, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(random.uniform(2, 4))

            # Handle cookie/consent dialogs
            try:
                accept_btn = await page.query_selector('[id*="accept"], button[data-tn-component="accept"]')
                if accept_btn:
                    await accept_btn.click()
                    await asyncio.sleep(1)
            except:
                pass

            # Scroll to load all results
            for _ in range(3):
                await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(random.uniform(1.5, 2.5))

            # Try multiple card selectors (Indeed changes these)
            card_selectors = [
                '.job_seen_beacon',
                '.jobCard_mainContent',
                '.resultContent',
                'div.cardOutline',
                'td.resultContent',
                'li[data-jk]',
                '.tapItem',
            ]

            job_cards = []
            used_selector = ''
            for sel in card_selectors:
                job_cards = await page.query_selector_all(sel)
                if job_cards:
                    used_selector = sel
                    break

            logger.info(f"Indeed: found {len(job_cards)} cards using '{used_selector}'")

            if not job_cards:
                # Fallback: find all Indeed job links
                page_text = await page.inner_text('body')
                logger.warning(f"No Indeed cards found. Page preview: {page_text[:500]}")
                all_links = await page.query_selector_all('a[href*="jk="], a[data-jk]')
                logger.info(f"Indeed fallback: found {len(all_links)} job links")

                seen_jks = set()
                for link_el in all_links[:max_results]:
                    try:
                        href = await link_el.get_attribute('href') or ''
                        jk = await link_el.get_attribute('data-jk') or ''
                        if not jk:
                            jk_match = re.search(r'jk=([a-f0-9]+)', href)
                            jk = jk_match.group(1) if jk_match else ''
                        if not jk or jk in seen_jks:
                            continue
                        seen_jks.add(jk)

                        text = (await link_el.inner_text()).strip()
                        if not text or len(text) < 3:
                            continue

                        full_url = f'https://www.indeed.com/viewjob?jk={jk}'
                        jobs.append({
                            'job_id': f'indeed_{jk}',
                            'title': text,
                            'company': '',
                            'location': location,
                            'platform': 'indeed',
                            'url': full_url,
                            'description': '',
                            'posted_date': '',
                            'salary': '',
                            'job_type': 'Full-time',
                        })
                    except Exception as e:
                        logger.debug(f"Error parsing Indeed fallback link: {e}")
            else:
                for card in job_cards[:max_results]:
                    try:
                        title_sels = ['h2.jobTitle a span', '.jobTitle span[title]', 'h2.jobTitle span', 'h2 a span', '.jobTitle a']
                        company_sels = ['[data-testid="company-name"]', '.companyName', '.company_location .companyName', 'span.companyName']
                        location_sels = ['[data-testid="text-location"]', '.companyLocation', '.company_location .companyLocation']
                        link_sels = ['h2.jobTitle a', 'a.jcs-JobTitle', 'a[data-jk]', 'a[href*="jk="]']
                        salary_sels = ['.salary-snippet-container', '.estimated-salary', '[data-testid="attribute_snippet_testid"]', '.salaryOnly']

                        title = ''
                        for sel in title_sels:
                            el = await card.query_selector(sel)
                            if el:
                                title = (await el.inner_text()).strip()
                                if title:
                                    break

                        company = ''
                        for sel in company_sels:
                            el = await card.query_selector(sel)
                            if el:
                                company = (await el.inner_text()).strip()
                                if company:
                                    break

                        loc = ''
                        for sel in location_sels:
                            el = await card.query_selector(sel)
                            if el:
                                loc = (await el.inner_text()).strip()
                                if loc:
                                    break

                        salary = ''
                        for sel in salary_sels:
                            el = await card.query_selector(sel)
                            if el:
                                salary = (await el.inner_text()).strip()
                                if salary:
                                    break

                        href = ''
                        for sel in link_sels:
                            el = await card.query_selector(sel)
                            if el:
                                href = await el.get_attribute('href') or ''
                                if href:
                                    break
                        if href and not href.startswith('http'):
                            href = 'https://www.indeed.com' + href

                        if not title or not href:
                            continue

                        jk_match = re.search(r'jk=([a-f0-9]+)', href)
                        job_id = 'indeed_' + (jk_match.group(1) if jk_match else _make_job_id('indeed', href)[-12:])

                        jobs.append({
                            'job_id':      job_id,
                            'title':       title,
                            'company':     company,
                            'location':    loc or location,
                            'platform':    'indeed',
                            'url':         href,
                            'description': '',
                            'posted_date': '',
                            'salary':      salary,
                            'job_type':    'Full-time',
                        })

                    except Exception as e:
                        logger.debug(f"Error parsing Indeed card: {e}")
                        continue

        except Exception as e:
            logger.error(f"Indeed search error: {e}", exc_info=True)
        finally:
            await browser.close()

    logger.info(f"Indeed search found {len(jobs)} jobs")
    return jobs


async def fetch_indeed_description(url: str) -> str:
    """Fetch full job description from Indeed."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return ''

    async with async_playwright() as p:
        browser, context = await _get_browser(p, headless=True)
        page = await context.new_page()
        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=20000)
            await asyncio.sleep(2)
            desc_el = await page.query_selector('#jobDescriptionText, .jobsearch-jobDescriptionText')
            desc = await desc_el.inner_text() if desc_el else ''
            return desc.strip()
        except Exception as e:
            logger.debug(f"Could not fetch Indeed description: {e}")
            return ''
        finally:
            await browser.close()


# ─────────────────────────────────────────────────────────
# MANUAL URL INGESTION
# ─────────────────────────────────────────────────────────

async def fetch_job_from_url(url: str) -> Optional[dict]:
    """
    Parse a job from any URL (LinkedIn, Indeed, Workday, or generic).
    Returns a raw job dict.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return None

    platform = 'manual'
    if 'linkedin.com' in url:
        platform = 'linkedin'
    elif 'indeed.com' in url:
        platform = 'indeed'
    elif 'myworkdayjobs.com' in url or 'workday.com' in url:
        platform = 'workday'

    async with async_playwright() as p:
        browser, context = await _get_browser(p, headless=False)
        page = await context.new_page()
        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(3)

            # Check for expired listings
            page_text = await page.inner_text('body')
            if is_expired_page(page_text):
                logger.info(f"Expired listing: {url}")
                return {
                    'job_id': _make_job_id(platform, url),
                    'title': 'EXPIRED',
                    'company': '',
                    'location': '',
                    'platform': platform,
                    'url': url,
                    'description': '',
                    'status': 'skipped',
                    'notes': 'Job listing expired or no longer available',
                    'posted_date': '', 'salary': '', 'job_type': '',
                }

            title = ''
            company = ''
            description = ''
            location = ''
            salary = ''

            if platform == 'linkedin':
                try:
                    title = await page.locator('h1.top-card-layout__title').inner_text(timeout=5000)
                    company = await page.locator('.topcard__org-name-link').inner_text(timeout=5000)
                    location = await page.locator('.topcard__flavor--bullet').inner_text(timeout=5000)
                    try:
                        btn = await page.query_selector('.show-more-less-html__button--more')
                        if btn: await btn.click(); await asyncio.sleep(1)
                    except: pass
                    desc_el = await page.query_selector('.show-more-less-html__markup')
                    description = await desc_el.inner_text() if desc_el else ''
                except: pass

            elif platform == 'indeed':
                try:
                    title = await page.locator('h1.jobsearch-JobInfoHeader-title').inner_text(timeout=5000)
                    company = await page.locator('[data-testid="inlineHeader-companyName"]').inner_text(timeout=5000)
                    location = await page.locator('[data-testid="inlineHeader-companyLocation"]').inner_text(timeout=5000)
                    desc_el = await page.query_selector('#jobDescriptionText')
                    description = await desc_el.inner_text() if desc_el else ''
                except: pass

            elif platform == 'workday':
                try:
                    title = await page.locator('[data-automation-id="jobPostingHeader"]').inner_text(timeout=5000)
                    company = url.split('.')[0].replace('https://', '').title()
                    location = await page.locator('[data-automation-id="locations"]').inner_text(timeout=5000)
                    desc_el = await page.query_selector('[data-automation-id="jobPostingDescription"]')
                    description = await desc_el.inner_text() if desc_el else ''
                except: pass

            else:
                # Generic fallback: try to grab title and page text
                try:
                    title = await page.title()
                    description = await page.inner_text('body')
                    description = description[:5000]  # Cap at 5k chars
                except: pass

            if not title:
                title = await page.title()

            return {
                'job_id':      _make_job_id(platform, url),
                'title':       title.strip(),
                'company':     company.strip(),
                'location':    location.strip(),
                'platform':    platform,
                'url':         url,
                'description': description.strip(),
                'posted_date': '',
                'salary':      salary,
                'job_type':    '',
            }

        except Exception as e:
            logger.error(f"Error fetching job from URL {url}: {e}")
            return None
        finally:
            await browser.close()


# ─────────────────────────────────────────────────────────
# EMAIL ALERT PARSER
# ─────────────────────────────────────────────────────────

def parse_job_alert_email(subject: str, body: str) -> list:
    """
    Extract job links from a LinkedIn or Indeed job alert email.
    Returns list of URLs.
    """
    urls = []

    # LinkedIn job alert links
    li_links = re.findall(
        r'https://www\.linkedin\.com/jobs/view/\d+[^\s<"\']*',
        body
    )
    urls.extend(li_links)

    # Indeed job alert links
    indeed_links = re.findall(
        r'https://(?:www\.)?indeed\.com/(?:rc/clk\?jk=[a-f0-9]+|viewjob\?jk=[a-f0-9]+)[^\s<"\']*',
        body
    )
    urls.extend(indeed_links)

    # Generic job board links
    generic = re.findall(
        r'https?://[^\s<>"\']+(?:jobs|careers|position|opening|requisition)[^\s<>"\']*',
        body, re.IGNORECASE
    )
    urls.extend(generic)

    # Deduplicate
    seen = set()
    unique = []
    for u in urls:
        clean = u.split('?')[0].rstrip('/')
        if clean not in seen:
            seen.add(clean)
            unique.append(u)

    return unique
