const loginForm = document.querySelector('#loginForm');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const submitButton = loginForm.querySelector('.primary-button');
const formAlert = document.querySelector('#formAlert');
const themeToggle = document.querySelector('#themeToggle');
const loginView = document.querySelector('#loginView');
const signupView = document.querySelector('#signupView');
const signupForm = document.querySelector('#signupForm');
const signupAlert = document.querySelector('#signupAlert');
const signupButton = signupForm.querySelector('.primary-button');
const signupName = document.querySelector('#signupName');
const signupEmail = document.querySelector('#signupEmail');
const signupPassword = document.querySelector('#signupPassword');
const signupConfirm = document.querySelector('#signupConfirm');

function updateAuthView(focusHeading = false) {
  const isSignup = window.location.hash === '#signup';
  loginView.hidden = isSignup;
  signupView.hidden = !isSignup;
  document.title = `${isSignup ? 'Sign up' : 'Log in'} | Stringly`;
  if (focusHeading) (isSignup ? signupView : loginView).querySelector('h2').focus();
}

window.addEventListener('hashchange', () => updateAuthView(true));
updateAuthView();

function updateThemeToggle() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  themeToggle.setAttribute('aria-pressed', isDark.toString());
  themeToggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
  themeToggle.querySelector('.theme-toggle__label').textContent = `${isDark ? 'Light' : 'Dark'} mode`;
}

updateThemeToggle();
themeToggle.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  updateThemeToggle();
  try { localStorage.setItem('stringly-theme', nextTheme); } catch (_) { /* Theme still works for this visit. */ }
});

const messages = {
  emailRequired: 'Enter your email address.',
  emailInvalid: 'Enter a valid email address.',
  passwordRequired: 'Enter your password.',
  loginFailed: 'We couldn\'t log you in. Check your details and try again.',
  serviceUnavailable: 'The server could not complete the request. Please try again.',
  connectionFailed: 'Cannot connect to the Stringly server. Start it with node server.js, then open http://127.0.0.1:3000.',
  wrongLocalPage: 'Open this page at http://127.0.0.1:3000 instead of opening the HTML file or using another local web server.',
};

function serviceErrorMessage(error) {
  const isLocalPage = window.location.protocol === 'file:' ||
    (['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '3000');
  if (isLocalPage) return messages.wrongLocalPage;
  return error.message === 'NETWORK_ERROR' ? messages.connectionFailed : messages.serviceUnavailable;
}

function setFieldError(input, message = '') {
  const field = input.closest('.field');
  const error = field.querySelector('.field-error');
  field.classList.toggle('has-error', Boolean(message));
  input.setAttribute('aria-invalid', Boolean(message).toString());
  error.textContent = message;
}

function validateForm() {
  let isValid = true;
  const email = emailInput.value.trim();
  setFieldError(emailInput);
  setFieldError(passwordInput);

  if (!email) {
    setFieldError(emailInput, messages.emailRequired);
    isValid = false;
  } else if (!emailInput.validity.valid) {
    setFieldError(emailInput, messages.emailInvalid);
    isValid = false;
  }
  if (!passwordInput.value) {
    setFieldError(passwordInput, messages.passwordRequired);
    isValid = false;
  }
  return isValid;
}

async function postAuth(endpoint, details) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(details),
    });
  } catch {
    throw new Error('NETWORK_ERROR');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.code || 'SERVER_ERROR');
  return result;
}

function authenticate(details) {
  return postAuth('/api/login', details);
}

function registerAccount(details) {
  return postAuth('/api/register', details);
}

document.querySelectorAll('.password-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const input = button.dataset.target ? document.getElementById(button.dataset.target) : passwordInput;
    const shouldShow = input.type === 'password';
    input.type = shouldShow ? 'text' : 'password';
    button.setAttribute('aria-pressed', shouldShow.toString());
    button.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
    input.focus();
  });
});

[emailInput, passwordInput].forEach((input) => {
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') setFieldError(input);
    formAlert.hidden = true;
  });
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formAlert.hidden = true;
  if (!validateForm()) {
    loginForm.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.classList.add('is-loading');
  submitButton.setAttribute('aria-label', 'Logging in');

  try {
    await authenticate({
      email: emailInput.value.trim(),
      password: passwordInput.value,
      remember: loginForm.elements.remember.checked,
    });
    window.location.assign('/dashboard');
  } catch (error) {
    formAlert.textContent = ['NETWORK_ERROR', 'SERVER_ERROR', 'NOT_FOUND'].includes(error.message) ? serviceErrorMessage(error) : messages.loginFailed;
    formAlert.hidden = false;
    formAlert.focus?.();
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove('is-loading');
    submitButton.removeAttribute('aria-label');
  }
});

document.querySelector('#googleLogin').addEventListener('click', () => {
  formAlert.textContent = 'Google sign-in will be available when authentication is connected.';
  formAlert.hidden = false;
});

[signupName, signupEmail, signupPassword, signupConfirm].forEach((input) => {
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') setFieldError(input);
    signupAlert.hidden = true;
  });
});

function validateSignup() {
  [signupName, signupEmail, signupPassword, signupConfirm].forEach((input) => setFieldError(input));
  if (!signupName.value.trim()) setFieldError(signupName, 'Enter your name.');
  if (!signupEmail.value.trim()) setFieldError(signupEmail, messages.emailRequired);
  else if (!signupEmail.validity.valid) setFieldError(signupEmail, messages.emailInvalid);
  if (!signupPassword.value) setFieldError(signupPassword, 'Create a password.');
  else if (signupPassword.value.length < 8) setFieldError(signupPassword, 'Use at least 8 characters.');
  if (!signupConfirm.value) setFieldError(signupConfirm, 'Confirm your password.');
  else if (signupConfirm.value !== signupPassword.value) setFieldError(signupConfirm, 'Passwords do not match.');
  return !signupForm.querySelector('[aria-invalid="true"]');
}

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  signupAlert.hidden = true;
  if (!validateSignup()) {
    signupForm.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  signupButton.disabled = true;
  signupButton.classList.add('is-loading');
  signupButton.setAttribute('aria-label', 'Creating account');
  try {
    await registerAccount({
      name: signupName.value.trim(),
      email: signupEmail.value.trim(),
      password: signupPassword.value,
    });
    window.location.assign('/dashboard');
  } catch (error) {
    if (error.message === 'EMAIL_EXISTS') {
      setFieldError(signupEmail, 'An account with this email already exists.');
      signupEmail.focus();
    } else {
      signupAlert.textContent = ['NETWORK_ERROR', 'SERVER_ERROR', 'NOT_FOUND'].includes(error.message) ? serviceErrorMessage(error) : error.message === 'RATE_LIMITED' ? 'Too many attempts. Please try again later.' : 'We could not create your account. Please check your details and try again.';
      signupAlert.hidden = false;
    }
  } finally {
    signupButton.disabled = false;
    signupButton.classList.remove('is-loading');
    signupButton.removeAttribute('aria-label');
  }
});
