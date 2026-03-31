"""
Shared job processing pipeline.
Centralizes the analyze → should_apply → upsert flow
that was previously duplicated in main.py and web/app.py.
"""

import logging
from . import database as db
from . import job_analyzer

logger = logging.getLogger(__name__)


def process_job(job_data: dict, min_score: float = 50.0) -> bool:
    """
    Analyze a job, determine if it should be applied to, and save to database.

    Returns True if the job qualifies for application, False otherwise.
    Skips duplicates (returns False).
    """
    # Skip duplicates
    if db.is_duplicate(job_data.get('url', '')):
        return False

    # Run full analysis
    analysis = job_analyzer.analyze_job(
        job_data.get('title', ''),
        job_data.get('company', ''),
        job_data.get('description', ''),
    )
    job_data.update(analysis)

    # Determine application status
    should, reason = job_analyzer.should_apply(analysis, min_score)
    if should:
        job_data['status'] = 'new'
    else:
        job_data['status'] = 'skipped'
        job_data['notes'] = reason

    db.upsert_job(job_data)
    return should


def process_job_batch(jobs: list, min_score: float = 50.0) -> int:
    """
    Process a batch of jobs through the pipeline.
    Returns the count of jobs that qualify for application.
    """
    new_count = 0
    for job_data in jobs:
        try:
            if process_job(job_data, min_score):
                new_count += 1
        except Exception as e:
            logger.error(f"Error processing job {job_data.get('title', '?')}: {e}")
    return new_count
