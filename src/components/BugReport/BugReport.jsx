import React, { useState, useEffect } from 'react';
import { Icons } from '../../Icons';
import './BugReport.css';

const BugReport = ({ darkMode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [issue, setIssue] = useState('');
  const [status, setStatus] = useState('idle'); // idle, submitting, success, error
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => setIsAnimating(true), 10);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  const getSystemInfo = () => {
    const info = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform || (navigator.userAgentData ? navigator.userAgentData.platform : 'unknown'),
      memoryGB: navigator.deviceMemory || 'unknown',
      cpuCores: navigator.hardwareConcurrency || 'unknown',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screen: `${window.screen.width}x${window.screen.height}`,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
    return JSON.stringify(info, null, 2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('submitting');

    const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfV2qSYC33tzPPHfPW_hAASqOpugUkBpO5d-Q35rUhqevGptA/formResponse';

    const formData = new URLSearchParams();
    formData.append('entry.143035136', issue); // Issue Description
    formData.append('entry.1554386175', getSystemInfo()); // System Info

    try {
      await fetch(formUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
      });

      setStatus('success');
      setTimeout(() => {
        setIsOpen(false);
        setIssue('');
        setStatus('idle');
      }, 3000);
    } catch (error) {
      console.error('Bug report submission failed:', error);
      setStatus('error');
    }
  };

  if (!isOpen && status === 'idle') {
    return (
      <button
        className={`bug-report-trigger ${darkMode ? 'dark' : ''}`}
        onClick={() => setIsOpen(true)}
        title="Report a bug"
      >
        <Icons.Bug />
      </button>
    );
  }

  return (
    <div className={`bug-report-overlay ${isAnimating ? 'active' : ''} ${darkMode ? 'dark' : ''}`} onClick={() => setIsOpen(false)}>
      <div
        className={`bug-report-modal ${isAnimating ? 'active' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bug-report-header">
          <h3>Report a Bug</h3>
          <button className="close-btn" onClick={() => setIsOpen(false)}>
            <Icons.Close />
          </button>
        </div>

        {status === 'success' ? (
          <div className="status-message success">
            <div className="check-icon">✓</div>
            <p>Thank you! Your report has been submitted successfully.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="issue-desc">Describe the issue</label>
              <textarea
                id="issue-desc"
                placeholder="What happened? What were you doing?"
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                required
              />
            </div>

            <div className="info-attachment">
              <Icons.Settings />
              <span>System details (OS, Browser, Screen) will be attached automatically.</span>
            </div>

            <div className="bug-report-footer">
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setIsOpen(false)}
                disabled={status === 'submitting'}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="submit-btn"
                disabled={status === 'submitting'}
              >
                {status === 'submitting' ? (
                  <span className="loading-dots">Submitting<span>.</span><span>.</span><span>.</span></span>
                ) : 'Send Report'}
              </button>
            </div>
            {status === 'error' && <p className="status-message error">Network error. Please try again later.</p>}
          </form>
        )}
      </div>
    </div>
  );
};

export default BugReport;
