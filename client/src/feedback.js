import { NATIVE_APP, API_ORIGIN } from './platform.js';

export function createFeedback(state, { showToast }) {
  const sheet = document.getElementById('feedback');
  const form = document.getElementById('feedback-form');
  const message = document.getElementById('feedback-message');
  const send = document.getElementById('feedback-send');
  const error = document.getElementById('feedback-error');

  function closeFeedback() {
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('detail-open');
    document.body.classList.remove('detail-open');
  }

  function openFeedback() {
    error.textContent = '';
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('detail-open');
    document.body.classList.add('detail-open');
    message.focus();
  }

  async function submit(event) {
    event.preventDefault();
    error.textContent = '';
    send.disabled = true;
    try {
      const data = new FormData(form);
      const response = await fetch(`${API_ORIGIN}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: data.get('kind'),
          message: data.get('message'),
          email: data.get('email'),
          port: state.city?.id || '',
          page: NATIVE_APP ? '' : window.location.pathname,
          client: NATIVE_APP ? 'Android app' : 'web',
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not send that. Please try again.');
      form.reset();
      closeFeedback();
      showToast('Thanks, your report was sent');
    } catch (err) {
      error.textContent = err.message;
    } finally {
      send.disabled = message.value.trim().length < 10;
    }
  }

  message.addEventListener('input', () => { send.disabled = message.value.trim().length < 10; });
  form.addEventListener('submit', submit);
  document.getElementById('feedback-backdrop').addEventListener('click', closeFeedback);
  document.getElementById('feedback-cancel').addEventListener('click', closeFeedback);
  document.querySelectorAll('[data-open-feedback]').forEach(button => button.addEventListener('click', openFeedback));

  return { closeFeedback, isFeedbackOpen: () => sheet.classList.contains('open') };
}
